// ============================================================
// modules/payroll-report.js — Quincena attendance report for accounting
// Runs the day before each quincena cutoff (day 14 and penultimate day).
// Sends a CSV attachment to the configured contabilidad email.
// ============================================================

import { AttendanceModule }      from './attendance.js'
import { TardinessPolicyModule } from './tardiness-policy.js'
import { MailService }           from '../lib/email.js'
import { buildEmail }            from '../lib/email-template.js'
import { DB }                    from '../lib/db.js'

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio',
                   'Agosto','Septiembre','Octubre','Noviembre','Diciembre']

// Returns today's date parts in CDMX time (UTC-6, permanent since 2023)
function cdmxToday() {
  var d = new Date(Date.now() - 6 * 3600 * 1000)
  return {
    year:  d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,   // 1-12
    day:   d.getUTCDate()
  }
}

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

// Which quincena to report, or null if today is not a send day.
// Quincena 1 (days 1-15): send on day 14
// Quincena 2 (days 16-end): send on penultimate day of month
function getQuincenaToReport() {
  var { year, month, day } = cdmxToday()
  var last = lastDayOfMonth(year, month)
  if (day === 14)        return { year, month, quincena: 1 }
  if (day === last - 1)  return { year, month, quincena: 2 }
  return null
}

function buildCsv(employees, tardMap) {
  var header = [
    'Empleado', 'Departamento', 'Días Laborables', 'A Tiempo',
    'Retardos', 'Ausencias', 'Retardos acum. (6m)',
    'Días a descontar esta quincena', '% Puntualidad'
  ]

  var filtered = employees.filter(function(e) {
    return e.retardo > 0 || e.ausente > 0
  })

  var dataRows = filtered.map(function(e) {
    var pct  = e.workdays > 0 ? Math.round((e.aTime / e.workdays) * 100) : 0
    var tard = tardMap[e.employeeId] || null
    return [
      ((e.firstName || '') + ' ' + (e.lastName || '')).trim(),
      e.department || '',
      e.workdays,
      e.aTime,
      e.retardo,
      e.ausente,
      tard ? tard.count        : '',
      tard ? tard.daysToDeduct : '',
      pct + '%'
    ]
  })

  var totalDesc = Object.values(tardMap).reduce(function(a, t) {
    return a + (t.daysToDeduct || 0)
  }, 0)
  var totalRetPeriod  = filtered.reduce(function(a, e) { return a + e.retardo }, 0)
  var totalAusPeriod  = filtered.reduce(function(a, e) { return a + e.ausente }, 0)
  var totalATime      = filtered.reduce(function(a, e) { return a + e.aTime   }, 0)
  var n = (employees[0] ? employees[0].workdays : 0) * (filtered.length || 1)
  var pctTotal = n > 0 ? Math.round(totalATime / n * 100) : 0

  var totalsRow = [
    'TOTAL', filtered.length + ' empleados', '', '',
    totalRetPeriod, totalAusPeriod, '', totalDesc + ' días', pctTotal + '%'
  ]

  var allRows = [header, ...dataRows, totalsRow]
  return '﻿' + allRows.map(function(row) {
    return row.map(function(v) {
      var s = String(v == null ? '' : v)
      return s.includes(',') || s.includes('"') ? '"' + s.replace(/"/g, '""') + '"' : s
    }).join(',')
  }).join('\r\n')
}

export var PayrollReportModule = {

  async generateAndSend() {
    var target = getQuincenaToReport()
    if (!target) return { skipped: true, reason: 'No es día de reporte de quincena' }

    var { year, month, quincena } = target
    var q1Label = quincena === 1
      ? '1ª quincena (días 1–15)'
      : '2ª quincena (días 16–fin)'
    var periodLabel = q1Label + ' · ' + MONTHS_ES[month - 1] + ' ' + year
    var filename    = 'asistencia-' + (quincena === 1 ? '1q' : '2q') + '-' +
                      MONTHS_ES[month - 1].toLowerCase() + '-' + year + '.csv'

    // Contabilidad recipient
    var configRows  = await DB.getBy('Config', 'key', 'contabilidadEmail')
    var recipient   = configRows.length > 0 ? configRows[0].value : null
    if (!recipient) return { skipped: true, reason: 'No hay correo de contabilidad configurado (Config: contabilidadEmail)' }

    // Fake admin user context for module calls
    var sysUser = { isAdmin: true, isHR: true, id: 'system' }

    // Fetch attendance + tardiness in parallel
    var [attData, tardData] = await Promise.all([
      AttendanceModule.getMonth({ year, month, quincena }, sysUser),
      TardinessPolicyModule.getAllStatus({}, sysUser)
    ])

    var employees = attData.employees || []
    var tardMap   = {}
    ;(tardData.items || []).forEach(function(t) { tardMap[t.employeeId] = t })

    var csvContent = buildCsv(employees, tardMap)
    var totalDesc  = Object.values(tardMap).reduce(function(a, t) { return a + (t.daysToDeduct || 0) }, 0)
    var filtered   = employees.filter(function(e) { return e.retardo > 0 || e.ausente > 0 })

    var htmlBody = buildEmail({
      icon:  '📊',
      title: 'Reporte de asistencia — ' + periodLabel,
      bodyHTML:
        '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Hola,</p>' +
        '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Se adjunta el reporte de asistencia de la <strong>' + periodLabel + '</strong>. Solo se incluyen empleados con retardos o ausencias en el período.</p>' +
        '<p style="margin:0;color:#475569;font-size:15px;line-height:1.6">Días a descontar por retardos acumulados (6 meses): <strong>' + totalDesc + ' día' + (totalDesc !== 1 ? 's' : '') + '</strong>.</p>',
      details: [
        { label: 'Período',               value: periodLabel },
        { label: 'Días laborables',        value: String(attData.workdays || '') },
        { label: 'Empleados en reporte',   value: filtered.length + ' de ' + employees.length },
        { label: 'Total días a descontar', value: totalDesc + ' día' + (totalDesc !== 1 ? 's' : ''), highlight: totalDesc > 0 ? '#dc2626' : undefined }
      ]
    })

    await MailService.send({
      to:          recipient,
      subject:     '[IKAN HR] Reporte de asistencia — ' + periodLabel,
      htmlBody,
      attachments: [{ filename, content: Buffer.from(csvContent).toString('base64') }]
    })

    return {
      ok:         true,
      period:     periodLabel,
      sentTo:     recipient,
      filename,
      employees:  filtered.length,
      totalDesc
    }
  }
}
