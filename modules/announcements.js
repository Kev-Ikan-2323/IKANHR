// ============================================================
// modules/announcements.js — Internal announcements (port of GAS Announcements)
// ============================================================

import { DB } from '../lib/db.js'
import { CONFIG } from '../lib/auth.js'
import { MailService } from '../lib/email.js'
import { buildEmail } from '../lib/email-template.js'

export var AnnouncementsModule = {

  async list(params, user) {
    params = params || {}
    var all = await DB.getAll(CONFIG.SHEETS.ANNOUNCEMENTS)

    all = all.filter(function(a) {
      if (a.status !== 'publicado') return false
      if (a.expiresAt && a.expiresAt < new Date().toISOString()) return false
      if (!a.targetAudience || a.targetAudience === 'all') return true
      if (a.targetAudience === 'team:' + user.teamId) return true
      if (a.targetAudience === 'role:' + user.roleId) return true
      return false
    })

    if (params.pinned !== undefined) {
      all = all.filter(function(a) { return String(a.pinned) === String(params.pinned) })
    }

    if (params.limit) all = all.slice(0, parseInt(params.limit))

    all = all.sort(function(a, b) {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      return (b.publishedAt || b.createdAt || '').localeCompare(a.publishedAt || a.createdAt || '')
    })

    return Promise.all(all.map(_enrichAnnouncement))
  },

  async create(data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    if (!data.title || !data.body) throw new Error('Título y contenido son requeridos.')

    data.authorId       = user.id
    data.status         = data.status || 'publicado'
    data.targetAudience = data.targetAudience || 'all'
    data.pinned         = data.pinned || false
    data.publishedAt    = data.status === 'publicado' ? new Date().toISOString() : ''

    var announcement = await DB.insert(CONFIG.SHEETS.ANNOUNCEMENTS, data)
    if (data.status === 'publicado') _notifyEmployees(announcement, user)
    return announcement
  },

  async update(id, changes, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    if (changes.status === 'publicado' && !changes.publishedAt) {
      changes.publishedAt = new Date().toISOString()
    }
    return DB.update(CONFIG.SHEETS.ANNOUNCEMENTS, id, changes)
  },

  async remove(id, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    return DB.update(CONFIG.SHEETS.ANNOUNCEMENTS, id, { status: 'archivado' })
  }
}

async function _enrichAnnouncement(a) {
  var author = a.authorId ? await DB.getById(CONFIG.SHEETS.EMPLOYEES, a.authorId) : null
  a.authorName = author ? (author.firstName || '') + ' ' + (author.lastName || '') : 'HR'
  return a
}

async function _notifyEmployees(announcement, author) {
  try {
    var allEmps = await DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' })
    var audience = announcement.targetAudience || 'all'

    var recipients = allEmps.filter(function(e) {
      if (!e.email) return false
      if (audience === 'all') return true
      if (audience.startsWith('team:')) return e.teamId === audience.replace('team:', '')
      if (audience.startsWith('role:')) return e.roleId === audience.replace('role:', '')
      return false
    })

    var authorName = author ? (author.firstName || '') + ' ' + (author.lastName || '') : 'IKAN HR'
    var date       = new Date().toLocaleDateString('es-MX', { day:'numeric', month:'long', year:'numeric' })
    var bodyText   = (announcement.body || '').replace(/<[^>]+>/g, ' ').trim()

    for (var i = 0; i < recipients.length; i++) {
      var emp = recipients[i]
      try {
        await MailService.send({
          to:      emp.email,
          subject: '📢 Comunicado: ' + announcement.title,
          htmlBody: buildEmail({
            icon:  '📢',
            title: announcement.title,
            bodyHTML:
              '<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6">Hola <strong style="color:#1E293B">' + (emp.firstName || '') + '</strong>,</p>' +
              '<div style="color:#334155;font-size:15px;line-height:1.7;border-top:1px solid #E2E8F0;padding-top:16px">' + (announcement.body || bodyText) + '</div>',
            details: [
              { label: 'Publicado por', value: authorName },
              { label: 'Fecha',         value: date }
            ]
          })
        })
      } catch (e) {
        console.error('[Announcements] Error notifying ' + emp.email + ':', e.message)
      }
    }
    console.log('[Announcements] Notified ' + recipients.length + ' employees for: ' + announcement.title)
  } catch (e) {
    console.error('[Announcements] _notifyEmployees error:', e.message)
  }
}
