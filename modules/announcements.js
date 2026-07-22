// ============================================================
// modules/announcements.js — Internal announcements (port of GAS Announcements)
// ============================================================

import { DB } from '../lib/db.js'
import { CONFIG } from '../lib/auth.js'

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

    return DB.insert(CONFIG.SHEETS.ANNOUNCEMENTS, data)
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
