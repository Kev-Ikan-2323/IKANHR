// ============================================================
// modules/remote-checkin.js — Remote check-in & justified absences
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

function todayCdmx() {
  return new Date(new Date().getTime() - 6 * 3600 * 1000).toISOString().split('T')[0]
}

function appUrl() {
  var url = process.env.APP_URL || process.env.VERCEL_URL || ''
  if (url && !url.startsWith('http')) url = 'https://' + url
  return url.replace(/\/$/, '')
}

export var REASONS_REMOTO = [
  'Visita a cliente',
  'Trámite personal / médico',
  'Trabajo desde casa',
  'Evento o capacitación externa',
  'Otro'
]

export var RemoteCheckinModule = {

  // Employee submits a remote check-in or justified absence
  async request(data, user) {
    var type = data.type
    var today = todayCdmx()
    if (!type || !['remoto', 'falta_justificada'].includes(type)) {
      throw new Error('Tipo inválido.')
    }

    var sb = sbClient()
    var { data: existing } = await sb.from('remote_checkins')
      .select('id, status')
      .eq('employee_id', user.id)
      .eq('date', today)
      .eq('type', type)
    if (existing && existing.length > 0 && existing[0].status !== 'denegado') {
      throw new Error('Ya tienes una solicitud activa de ' +
        (type === 'remoto' ? 'check-in remoto' : 'falta justificada') + ' para hoy.')
    }

    var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, user.id)
    if (!emp) throw new Error('Empleado no encontrado.')

    var isRemoteEmp = emp.isRemote === true || emp.isRemote === 'true'
    var remoteDays = Array.isArray(emp.remoteDays) ? emp.remoteDays : []
    var cdmxNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
    var todayDow = cdmxNow.getDay()
    var isAuthorizedDay = remoteDays.length === 0 || remoteDays.indexOf(todayDow) > -1
    var autoApprove = type === 'remoto' && isAuthorizedDay && (isRemoteEmp || remoteDays.length > 0)
    var now = new Date().toISOString()

    var { data: inserted, error } = await sb.from('remote_checkins').insert({
      employee_id:    user.id,
      date:           today,
      type:           type,
      reason:         data.reason || '',
      photo_self_url: data.photoSelfUrl || null,
      photo_env_url:  data.photoEnvUrl  || null,
      document_url:   data.documentUrl  || null,
      status:         autoApprove ? 'aprobado' : 'pendiente',
      requested_at:   now,
      created_at:     now,
      updated_at:     now
    }).select().single()

    if (error) throw new Error('Error al registrar: ' + error.message)

    if (!autoApprove) {
      await _sendRequestEmail(inserted, emp, type).catch(function(e) {
        console.error('[RemoteCheckin] Email error:', e.message)
      })
    }

    return { ok: true, id: inserted.id, status: inserted.status }
  },

  // Manager or HR reviews (approves/denies) a pending request
  async review(data, user) {
    var sb = sbClient()
    var { data: rec, error } = await sb.from('remote_checkins')
      .select('*').eq('id', data.id).single()
    if (error || !rec) throw new Error('Solicitud no encontrada.')
    if (rec.status !== 'pendiente') throw new Error('Esta solicitud ya fue procesada.')

    if (rec.type === 'remoto') {
      if (!user.isAdmin) {
        var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, rec.employee_id)
        if (!emp || emp.managerId !== user.id) {
          throw new Error('No eres el manager de este empleado.')
        }
      }
    } else {
      if (!user.isAdmin && !user.isHR) throw new Error('Solo RH puede aprobar faltas justificadas.')
    }

    var approved = data.action === 'aprobar'
    var now = new Date().toISOString()
    var { error: updErr } = await sb.from('remote_checkins').update({
      status:       approved ? 'aprobado' : 'denegado',
      reviewed_by:  user.id,
      reviewed_at:  now,
      review_notes: data.notes || '',
      updated_at:   now
    }).eq('id', data.id)
    if (updErr) throw new Error('Error: ' + updErr.message)

    var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, rec.employee_id)
    if (emp && emp.email) {
      await _sendReviewEmail(rec, emp, approved, data.notes || '').catch(function(e) {
        console.error('[RemoteCheckin] Review email error:', e.message)
      })
    }

    return { ok: true, status: approved ? 'aprobado' : 'denegado' }
  },

  // Return pending requests that this user can review
  async getPending(data, user) {
    var today = todayCdmx()
    var sb = sbClient()
    var { data: records, error } = await sb.from('remote_checkins')
      .select('*').eq('date', today).eq('status', 'pendiente')
    if (error) throw new Error('Error: ' + error.message)

    var all = records || []
    var reviewable

    if (user.isAdmin) {
      reviewable = all
    } else if (user.isHR) {
      reviewable = all.filter(function(r) { return r.type === 'falta_justificada' })
    } else {
      var directReports = await DB.query(CONFIG.SHEETS.EMPLOYEES, { managerId: user.id })
      var drIds = new Set(directReports.map(function(e) { return e.id }))
      reviewable = all.filter(function(r) { return r.type === 'remoto' && drIds.has(r.employee_id) })
    }

    if (reviewable.length === 0) return []

    var employees = await DB.query(CONFIG.SHEETS.EMPLOYEES, {})
    var empMap = {}
    employees.forEach(function(e) { empMap[e.id] = e })

    return reviewable.map(function(r) {
      var e = empMap[r.employee_id] || {}
      return {
        id:           r.id,
        employeeId:   r.employee_id,
        firstName:    e.firstName || '',
        lastName:     e.lastName  || '',
        date:         r.date,
        type:         r.type,
        reason:       r.reason || '',
        photoSelfUrl: r.photo_self_url,
        photoEnvUrl:  r.photo_env_url,
        documentUrl:  r.document_url,
        requestedAt:  r.requested_at
      }
    })
  },

  // HR/Admin overrides a denied/auto-closed absence (requires written justification)
  async override(data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Solo RH o administradores pueden hacer esto.')
    if (!data.notes || !data.notes.trim()) throw new Error('Debes proporcionar una justificación escrita.')

    var sb  = sbClient()
    var now = new Date().toISOString()

    if (data.id) {
      // Update an existing record (auto-denied or manually denied)
      var { error } = await sb.from('remote_checkins').update({
        status:         'aprobado',
        override_by:    user.id,
        override_at:    now,
        override_notes: data.notes.trim(),
        updated_at:     now
      }).eq('id', data.id)
      if (error) throw new Error('Error: ' + error.message)
    } else {
      // No prior record — employee never submitted anything; create an approved entry
      if (!data.employeeId || !data.date) throw new Error('Faltan datos para la corrección.')
      var { error: insErr } = await sb.from('remote_checkins').insert({
        employee_id:    data.employeeId,
        date:           data.date,
        type:           'remoto',
        reason:         'Corrección manual por RH/Administrador',
        status:         'aprobado',
        override_by:    user.id,
        override_at:    now,
        override_notes: data.notes.trim(),
        requested_at:   now,
        created_at:     now,
        updated_at:     now
      })
      if (insErr) throw new Error('Error: ' + insErr.message)
    }

    return { ok: true }
  },

  // Send reminder emails for pending check-ins (called by cron at 4 PM and 7 PM)
  async sendReminders() {
    var today = todayCdmx()
    var sb = sbClient()
    var { data: pending } = await sb.from('remote_checkins')
      .select('*').eq('date', today).eq('status', 'pendiente')

    if (!pending || pending.length === 0) return { sent: 0 }

    var employees = await DB.query(CONFIG.SHEETS.EMPLOYEES, {})
    var empMap = {}
    employees.forEach(function(e) { empMap[e.id] = e })

    var hrUsers = employees.filter(function(e) { return e.isHR === true || e.isHR === 'true' })
    var sent = 0

    for (var i = 0; i < pending.length; i++) {
      var rec = pending[i]
      var emp = empMap[rec.employee_id]
      if (!emp) continue

      try {
        if (rec.type === 'remoto') {
          var manager = emp.managerId ? empMap[emp.managerId] : null
          if (manager && manager.email) {
            await _sendReminderEmail(rec, emp, manager.email)
            sent++
          }
        } else {
          for (var j = 0; j < hrUsers.length; j++) {
            if (hrUsers[j].email) {
              await _sendReminderEmail(rec, emp, hrUsers[j].email)
              sent++
            }
          }
        }
      } catch (e) {
        console.error('[RemoteCheckin] Reminder error:', e.message)
      }
    }

    return { sent: sent }
  },

  // Auto-close pending requests from past days (called at midnight)
  async autoClose() {
    var today = todayCdmx()
    var sb = sbClient()
    var now = new Date().toISOString()
    var { data: closed } = await sb.from('remote_checkins').update({
      status:       'denegado',
      review_notes: 'Auto-cerrado: no autorizado antes del fin del día.',
      updated_at:   now
    }).lt('date', today).eq('status', 'pendiente').select('id')

    return { closed: (closed || []).length }
  },

  // Returns config data (reasons list) for the frontend
  async getConfig() {
    return { reasons: REASONS_REMOTO }
  },

  // At 9:10 AM CDMX: email each manager listing their absent employees
  async absentAlert() {
    var today         = todayCdmx()
    var sb            = sbClient()
    var todayUtcStart = today + 'T06:00:00.000Z'
    var todayUtcEnd   = new Date(new Date(today + 'T06:00:00Z').getTime() + 24 * 3600 * 1000).toISOString()

    // Who punched in today?
    var { data: punches } = await sb.from('attendance_punches')
      .select('employee_id')
      .gte('punched_at', todayUtcStart)
      .lt('punched_at',  todayUtcEnd)
    var punchedSet = new Set((punches || []).map(function(p) { return p.employee_id }))

    // Who already has an approved or pending remote check-in today?
    var { data: remotes } = await sb.from('remote_checkins')
      .select('employee_id')
      .eq('date', today)
      .in('status', ['aprobado', 'pendiente'])
    var remoteSet = new Set((remotes || []).map(function(r) { return r.employee_id }))

    var employees = await DB.query(CONFIG.SHEETS.EMPLOYEES, {})

    // Only employees tracked in attendance (have checadorPin or are isRemote)
    var absent = employees.filter(function(e) {
      var tracked = e.checadorPin || e.isRemote === true || e.isRemote === 'true'
      return tracked && !punchedSet.has(e.id) && !remoteSet.has(e.id)
    })

    if (absent.length === 0) return { sent: 0, absentCount: 0 }

    var empMap = {}
    employees.forEach(function(e) { empMap[e.id] = e })

    // Group absent employees by their direct manager
    var byManager = {}
    absent.forEach(function(e) {
      if (!e.managerId) return
      if (!byManager[e.managerId]) byManager[e.managerId] = []
      byManager[e.managerId].push(e)
    })

    var sent = 0
    for (var mgrId in byManager) {
      var mgr = empMap[mgrId]
      if (!mgr || !mgr.email) continue
      try {
        await _sendAbsentAlertEmail(mgr, byManager[mgrId], today)
        sent++
      } catch (e) {
        console.error('[RemoteCheckin] AbsentAlert error:', e.message)
      }
    }

    return { sent: sent, absentCount: absent.length }
  },

  // At 9:05 AM CDMX: remind isRemote employees who haven't checked in yet
  async remoteReminder() {
    var today         = todayCdmx()
    var sb            = sbClient()
    var todayUtcStart = today + 'T06:00:00.000Z'
    var todayUtcEnd   = new Date(new Date(today + 'T06:00:00Z').getTime() + 24 * 3600 * 1000).toISOString()

    var employees  = await DB.query(CONFIG.SHEETS.EMPLOYEES, {})
    var remoteEmps = employees.filter(function(e) {
      return (e.isRemote === true || e.isRemote === 'true') && e.email
    })
    if (remoteEmps.length === 0) return { sent: 0 }

    // Exclude those who already punched or submitted/approved remote check-in
    var { data: punches } = await sb.from('attendance_punches')
      .select('employee_id')
      .gte('punched_at', todayUtcStart)
      .lt('punched_at',  todayUtcEnd)
    var punchedSet = new Set((punches || []).map(function(p) { return p.employee_id }))

    var { data: remotes } = await sb.from('remote_checkins')
      .select('employee_id')
      .eq('date', today)
      .in('status', ['aprobado', 'pendiente'])
    var checkedSet = new Set((remotes || []).map(function(r) { return r.employee_id }))

    var toRemind = remoteEmps.filter(function(e) {
      return !punchedSet.has(e.id) && !checkedSet.has(e.id)
    })

    var sent = 0
    for (var i = 0; i < toRemind.length; i++) {
      try {
        await _sendRemoteDailyReminderEmail(toRemind[i], today)
        sent++
      } catch (e) {
        console.error('[RemoteCheckin] RemoteReminder error:', e.message)
      }
    }

    return { sent: sent }
  }
}

// ── Private helpers ──────────────────────────────────────────

async function _sendRequestEmail(rec, emp, type) {
  var isRemoto = type === 'remoto'
  var empName  = ((emp.firstName || '') + ' ' + (emp.lastName || '')).trim()

  var recipients = []
  if (isRemoto) {
    if (!emp.managerId) return
    var manager = await DB.getById(CONFIG.SHEETS.EMPLOYEES, emp.managerId)
    if (manager && manager.email) recipients.push(manager.email)
  } else {
    var all = await DB.query(CONFIG.SHEETS.EMPLOYEES, {})
    all.forEach(function(e) {
      if ((e.isHR === true || e.isHR === 'true') && e.email) recipients.push(e.email)
    })
  }
  if (recipients.length === 0) return

  var photosHtml = ''
  if (isRemoto && rec.photo_self_url) {
    photosHtml += '<p style="margin:12px 0 4px;font-size:12px;color:#64748b;font-family:Arial,sans-serif"><strong>Foto personal</strong></p>' +
      '<img src="' + rec.photo_self_url + '" style="max-width:180px;border-radius:8px;border:1px solid #e2e8f0" />'
  }
  if (isRemoto && rec.photo_env_url) {
    photosHtml += '<p style="margin:12px 0 4px;font-size:12px;color:#64748b;font-family:Arial,sans-serif"><strong>Foto de entorno</strong></p>' +
      '<img src="' + rec.photo_env_url + '" style="max-width:180px;border-radius:8px;border:1px solid #e2e8f0" />'
  }
  if (!isRemoto && rec.document_url) {
    photosHtml += '<p style="margin:12px 0 4px;font-size:12px;color:#64748b;font-family:Arial,sans-serif"><strong>Justificante</strong></p>' +
      '<img src="' + rec.document_url + '" style="max-width:180px;border-radius:8px;border:1px solid #e2e8f0" />'
  }

  var typeLabel = isRemoto ? 'check-in remoto' : 'falta justificada'
  var htmlBody  = buildEmail({
    icon:    isRemoto ? '🏠' : '📋',
    title:   empName + ' solicita ' + typeLabel,
    bodyHTML: '<p style="font-size:14px;color:#374151;font-family:Arial,sans-serif">' +
      '<strong>' + empName + '</strong> está solicitando un ' + typeLabel + ' para hoy.' +
      ' Entra a la aplicación para <strong>autorizar o denegar</strong>.' +
      ' En caso de no autorizar se le marcará como <strong>ausente</strong>.</p>' +
      (photosHtml ? '<div style="margin-top:8px">' + photosHtml + '</div>' : ''),
    details: [
      { label: 'Fecha',  value: rec.date },
      { label: 'Motivo', value: rec.reason || '—' }
    ],
    actions: [{ label: 'Revisar en la app →', url: appUrl() }]
  })

  for (var k = 0; k < recipients.length; k++) {
    await MailService.send({
      to:       recipients[k],
      subject:  '[IKAN HR] ' + empName + ' solicita ' + typeLabel + ' · ' + rec.date,
      htmlBody: htmlBody
    })
  }
}

async function _sendReminderEmail(rec, emp, toEmail) {
  var typeLabel = rec.type === 'remoto' ? 'check-in remoto' : 'falta justificada'
  var empName   = ((emp.firstName || '') + ' ' + (emp.lastName || '')).trim()
  var reqTime   = rec.requested_at
    ? new Date(rec.requested_at).toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' })
    : '—'

  var htmlBody = buildEmail({
    icon:    '⏰',
    title:   'Recordatorio — ' + empName + ' espera autorización',
    bodyHTML: '<p style="font-size:14px;color:#374151;font-family:Arial,sans-serif">' +
      '<strong>' + empName + '</strong> sigue esperando autorización para su ' + typeLabel + ' de hoy.' +
      ' Si no autorizas antes de que termine el día, quedará registrado como <strong>ausente</strong>.</p>',
    details: [
      { label: 'Motivo',      value: rec.reason || '—' },
      { label: 'Solicitó a',  value: reqTime }
    ],
    actions: [{ label: 'Autorizar ahora →', url: appUrl() }]
  })

  await MailService.send({
    to:       toEmail,
    subject:  '[IKAN HR] ⏰ Pendiente: ' + typeLabel + ' de ' + empName + ' · ' + rec.date,
    htmlBody: htmlBody
  })
}

async function _sendReviewEmail(rec, emp, approved, notes) {
  var typeLabel = rec.type === 'remoto' ? 'check-in remoto' : 'falta justificada'
  var htmlBody  = buildEmail({
    icon:    approved ? '✅' : '❌',
    title:   'Tu ' + typeLabel + ' fue ' + (approved ? 'aprobado' : 'rechazado'),
    bodyHTML: '<p style="font-size:14px;color:#374151;font-family:Arial,sans-serif">' +
      (approved
        ? 'Tu solicitud fue <strong>aprobada</strong>. Tu asistencia del ' + rec.date + ' queda registrada como ' + typeLabel + '.'
        : 'Tu solicitud fue <strong>rechazada</strong>. El día ' + rec.date + ' quedará registrado como ausente.' +
          (notes ? ' <em>Nota: ' + notes + '</em>' : '')) +
      '</p>',
    details: [
      { label: 'Fecha',  value: rec.date },
      { label: 'Motivo', value: rec.reason || '—' }
    ]
  })

  await MailService.send({
    to:       emp.email,
    subject:  '[IKAN HR] Tu ' + typeLabel + ' del ' + rec.date + ' fue ' + (approved ? 'aprobado ✅' : 'rechazado ❌'),
    htmlBody: htmlBody
  })
}

async function _sendAbsentAlertEmail(manager, absentList, date) {
  var mgrName = ((manager.firstName || '') + ' ' + (manager.lastName || '')).trim()

  var listHtml = absentList.map(function(e) {
    var name    = ((e.firstName || '') + ' ' + (e.lastName || '')).trim()
    var isRem   = e.isRemote === true || e.isRemote === 'true'
    var typeTag = isRem ? ' <span style="font-size:11px;color:#2563eb">(Remoto)</span>' : ''
    return '<li style="padding:4px 0;font-size:13px;color:#374151;font-family:Arial,sans-serif"><strong>' + name + '</strong>' + typeTag + '</li>'
  }).join('')

  var htmlBody = buildEmail({
    icon:    '⚠️',
    title:   absentList.length + ' empleado' + (absentList.length !== 1 ? 's' : '') + ' sin registro a las 9:10',
    bodyHTML: '<p style="font-size:14px;color:#374151;font-family:Arial,sans-serif">Buenos días <strong>' + mgrName + '</strong>, los siguientes empleados de tu equipo no tienen registro de asistencia al corte de las 9:10 AM:</p>' +
      '<ul style="margin:12px 0;padding-left:20px">' + listHtml + '</ul>' +
      '<p style="font-size:13px;color:#64748b;font-family:Arial,sans-serif">Si tienen una razón válida, pueden solicitar su check-in remoto o falta justificada desde la aplicación. De lo contrario quedarán marcados como <strong>ausentes</strong> al final del día.</p>',
    details: [
      { label: 'Fecha',    value: date },
      { label: 'Ausentes', value: String(absentList.length) }
    ],
    actions: [{ label: 'Ver asistencia →', url: appUrl() }]
  })

  await MailService.send({
    to:       manager.email,
    subject:  '[IKAN HR] ⚠️ ' + absentList.length + ' empleado' + (absentList.length !== 1 ? 's' : '') + ' sin registro · ' + date,
    htmlBody: htmlBody
  })
}

async function _sendRemoteDailyReminderEmail(emp, date) {
  var empName = ((emp.firstName || '') + ' ' + (emp.lastName || '')).trim()

  var htmlBody = buildEmail({
    icon:    '🏠',
    title:   'Recuerda registrar tu check-in remoto',
    bodyHTML: '<p style="font-size:14px;color:#374151;font-family:Arial,sans-serif">Buenos días <strong>' + empName + '</strong>, recuerda que debes registrar tu check-in remoto diario antes de las 9:10 AM.</p>' +
      '<p style="font-size:13px;color:#64748b;font-family:Arial,sans-serif">Ve a la sección de <strong>Asistencia</strong> y usa el botón <em>"Check-in remoto"</em> en la tarjeta de Hoy.</p>',
    details: [
      { label: 'Fecha', value: date }
    ],
    actions: [{ label: 'Ir a la app →', url: appUrl() }]
  })

  await MailService.send({
    to:       emp.email,
    subject:  '[IKAN HR] 🏠 Recuerda tu check-in remoto · ' + date,
    htmlBody: htmlBody
  })
}
