// ============================================================
// modules/tardiness-appeal.js — Tardiness appeal flow
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { DB } from '../lib/db.js'
import { CONFIG } from '../lib/auth.js'
import { MailService } from '../lib/email.js'
import { buildEmail } from '../lib/email-template.js'

function sbClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

function appUrl() {
  var url = process.env.APP_URL || process.env.VERCEL_URL || ''
  if (url && !url.startsWith('http')) url = 'https://' + url
  return url.replace(/\/$/, '')
}

export var TardinessAppealModule = {

  // Employee submits an appeal for a retardo on a given date
  async request(data, user) {
    if (!data.date) throw new Error('Fecha requerida.')
    if (!data.reason || !data.reason.trim()) throw new Error('Justificación requerida.')

    var sb = sbClient()

    // Check no active (non-denied) appeal already exists
    var { data: existing } = await sb.from('tardiness_appeals')
      .select('id, status')
      .eq('employee_id', user.id)
      .eq('date', data.date)
    var active = (existing || []).filter(function(a) { return a.status !== 'denegado' })
    if (active.length > 0) throw new Error('Ya existe una apelación activa para este día.')

    var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, user.id)
    if (!emp) throw new Error('Empleado no encontrado.')

    var now = new Date().toISOString()
    var { data: inserted, error } = await sb.from('tardiness_appeals').insert({
      id:           crypto.randomUUID(),
      employee_id:  user.id,
      date:         data.date,
      reason:       data.reason.trim(),
      document_url: data.documentUrl || null,
      status:       'pendiente',
      requested_at: now,
      created_at:   now,
      updated_at:   now
    }).select().single()

    if (error) throw new Error('Error al registrar apelación: ' + error.message)

    await _sendRequestEmail(inserted, emp).catch(function(e) {
      console.error('[TardinessAppeal] Email error:', e.message)
    })

    return { ok: true, id: inserted.id }
  },

  // Manager / HR / Admin reviews an appeal
  async review(data, user) {
    if (!data.id) throw new Error('ID de apelación requerido.')
    var approved = data.action === 'approve'
    if (!['approve', 'deny'].includes(data.action)) throw new Error('Acción inválida.')

    var sb = sbClient()
    var { data: rec, error: fetchErr } = await sb.from('tardiness_appeals')
      .select('*').eq('id', data.id).maybeSingle()
    if (fetchErr || !rec) throw new Error('Apelación no encontrada.')
    if (rec.status !== 'pendiente') throw new Error('Esta apelación ya fue procesada.')

    var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, rec.employee_id)

    // Only manager of this employee, HR, or admin may review
    if (!user.isAdmin && !user.isHR && emp.managerId !== user.id) {
      throw new Error('Sin permiso para revisar esta apelación.')
    }

    var now = new Date().toISOString()
    var { error: updErr } = await sb.from('tardiness_appeals').update({
      status:       approved ? 'aprobado' : 'denegado',
      reviewed_by:  user.id,
      reviewed_at:  now,
      review_notes: data.notes || null,
      updated_at:   now
    }).eq('id', data.id)

    if (updErr) throw new Error('Error al actualizar apelación: ' + updErr.message)

    await _sendResultEmail(rec, emp, approved, data.notes).catch(function(e) {
      console.error('[TardinessAppeal] Result email error:', e.message)
    })

    return { ok: true, status: approved ? 'aprobado' : 'denegado' }
  },

  // Get pending appeals for the current user's direct reports (or all if HR/admin)
  async getPending(data, user) {
    var sb = sbClient()
    var { data: appeals, error } = await sb.from('tardiness_appeals')
      .select('*')
      .eq('status', 'pendiente')
      .order('requested_at', { ascending: true })

    if (error) throw new Error('Error al obtener apelaciones: ' + error.message)
    if (!appeals || appeals.length === 0) return { items: [] }

    var empIds = [...new Set(appeals.map(function(a) { return a.employee_id }))]
    var emps = await Promise.all(empIds.map(function(id) { return DB.getById(CONFIG.SHEETS.EMPLOYEES, id) }))
    var empMap = {}
    emps.forEach(function(e) { if (e) empMap[e.id] = e })

    var filtered = appeals.filter(function(a) {
      var emp = empMap[a.employee_id]
      if (!emp) return false
      if (user.isAdmin || user.isHR) return true
      return emp.managerId === user.id
    })

    var items = filtered.map(function(a) {
      var emp = empMap[a.employee_id] || {}
      return {
        id:          a.id,
        date:        a.date,
        reason:      a.reason,
        documentUrl: a.document_url,
        requestedAt: a.requested_at,
        employeeId:  a.employee_id,
        employeeName: (emp.firstName || '') + ' ' + (emp.lastName || ''),
        department:  emp.department || ''
      }
    })

    return { items: items }
  }
}

async function _sendRequestEmail(appeal, emp) {
  if (!emp.managerId) return
  var manager = await DB.getById(CONFIG.SHEETS.EMPLOYEES, emp.managerId)
  if (!manager || !manager.email) return

  var empName    = (emp.firstName || '') + ' ' + (emp.lastName || '')
  var dateLabel  = appeal.date
  var url        = appUrl()

  var htmlBody = buildEmail({
    title:    'Apelación de tardanza',
    subtitle: empName + ' · ' + dateLabel,
    intro:    empName + ' solicita apelar su retardo del <strong>' + dateLabel + '</strong>.',
    items:    [{ label: 'Justificación', value: appeal.reason }],
    cta:      { label: 'Revisar en IKAN HR', url: url },
    footer:   'Puedes aprobar o rechazar desde la plataforma.'
  })

  await MailService.send({
    to:      manager.email,
    subject: '[IKAN HR] Apelación de tardanza — ' + empName + ' (' + dateLabel + ')',
    html:    htmlBody
  })
}

async function _sendResultEmail(appeal, emp, approved, notes) {
  if (!emp.email) return

  var htmlBody = buildEmail({
    title:    'Tu apelación fue ' + (approved ? 'aprobada ✅' : 'rechazada ❌'),
    subtitle: 'Día: ' + appeal.date,
    intro:    'Tu apelación de tardanza del <strong>' + appeal.date + '</strong> fue ' +
              (approved ? '<strong>aprobada</strong>.' : '<strong>rechazada</strong>.'),
    items:    notes ? [{ label: 'Notas del revisor', value: notes }] : [],
    footer:   'IKAN HR'
  })

  await MailService.send({
    to:      emp.email,
    subject: '[IKAN HR] Apelación ' + (approved ? 'aprobada ✅' : 'rechazada ❌') + ' — ' + appeal.date,
    html:    htmlBody
  })
}
