// ============================================================
// modules/tardiness-policy.js — Tardiness policy & consequences
// Retardos only count from POLICY_START (October 2026).
// Rolling 6-month window. Approved appeals are excluded.
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { DB } from '../lib/db.js'
import { CONFIG } from '../lib/auth.js'

const POLICY_START  = '2026-10-01'
const LATE_LIMIT    = 9 * 60 + 10  // 9:10 AM in minutes
const ABSENT_LIMIT  = 10 * 60      // 10:00 AM — at or after = ausente, not retardo

const TIERS = [
  { min: 17, label: 'Rescisión de la relación laboral',              severity: 'rescision', bg: '#450a0a', fg: '#fca5a5' },
  { min: 16, label: 'Suspensión 3 días sin goce de sueldo',          severity: 'critical',  bg: '#7f1d1d', fg: '#fecaca' },
  { min: 15, label: 'Suspensión hasta 3 días + instrucción formal',  severity: 'critical',  bg: '#991b1b', fg: '#fecaca' },
  { min: 12, label: 'Descuento 1 día + exhorto por escrito',         severity: 'high',      bg: '#dc2626', fg: '#fff' },
  { min:  9, label: 'Descuento 3 días + llamada de atención formal', severity: 'high',      bg: '#ea580c', fg: '#fff' },
  { min:  6, label: 'Descuento 2 días de salario',                   severity: 'medium',    bg: '#f97316', fg: '#fff' },
  { min:  3, label: 'Descuento 1 día de salario',                    severity: 'low',       bg: '#f59e0b', fg: '#fff' },
  { min:  0, label: 'Sin consecuencias',                             severity: 'ok',        bg: '#16a34a', fg: '#fff' }
]

function sbClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

function getTier(count) {
  for (var i = 0; i < TIERS.length; i++) {
    if (count >= TIERS[i].min) return { ...TIERS[i], count }
  }
  return { ...TIERS[TIERS.length - 1], count }
}

function windowStart() {
  var sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  var sixStr = sixMonthsAgo.toISOString().split('T')[0]
  return sixStr > POLICY_START ? sixStr : POLICY_START
}

function isLate(punchedAt) {
  var d = new Date(punchedAt)
  var cdmxMin = ((d.getUTCHours() - 6 + 24) % 24) * 60 + d.getUTCMinutes()
  // Only 9:10–9:59 counts as retardo; 10:00+ is ausente per company policy
  return cdmxMin > LATE_LIMIT && cdmxMin < ABSENT_LIMIT
}

function getDaysToDeduct(count) {
  if (count >= 17) return 0   // rescisión — not a payroll deduction
  if (count >= 16) return 3
  if (count >= 15) return 3
  if (count >= 12) return 1
  if (count >=  9) return 3
  if (count >=  6) return 2
  if (count >=  3) return 1
  return 0
}

async function countRetardos(employeeId, sb) {
  var start = windowStart()
  var today = new Date().toISOString().split('T')[0]

  var dayStart = start + 'T00:00:00-06:00'
  var dayEnd   = today + 'T23:59:59-06:00'

  var [punchRes, appealRes] = await Promise.all([
    sb.from('attendance_punches')
      .select('punched_at')
      .eq('employee_id', employeeId)
      .gte('punched_at', dayStart)
      .lte('punched_at', dayEnd)
      .order('punched_at'),
    sb.from('tardiness_appeals')
      .select('date')
      .eq('employee_id', employeeId)
      .eq('status', 'aprobado')
      .gte('date', start)
      .lte('date', today)
  ])

  var punches = punchRes.data || []
  var appealedDates = new Set((appealRes.data || []).map(function(a) { return a.date }))

  // First punch per day
  var firstByDate = {}
  punches.forEach(function(p) {
    var date = new Date(p.punched_at).toISOString().split('T')[0]
    // Adjust to CDMX date
    var cdmxD = new Date(new Date(p.punched_at).getTime() - 6 * 3600 * 1000)
    var cdmxDate = cdmxD.toISOString().split('T')[0]
    if (!firstByDate[cdmxDate]) firstByDate[cdmxDate] = p.punched_at
  })

  var count = 0
  Object.keys(firstByDate).forEach(function(date) {
    if (date < POLICY_START) return
    if (appealedDates.has(date)) return
    if (isLate(firstByDate[date])) count++
  })

  return count
}

export var TardinessPolicyModule = {

  // Get tardiness status for a single employee
  async getStatus(data, user) {
    var employeeId = data.employeeId || user.id
    if (employeeId !== user.id && !user.isAdmin && !user.isHR) {
      var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, employeeId)
      if (!emp || emp.managerId !== user.id) throw new Error('Sin permiso.')
    }

    var sb = sbClient()
    var count = await countRetardos(employeeId, sb)
    return { ...getTier(count), daysToDeduct: getDaysToDeduct(count) }
  },

  // Get tardiness status for all tracked employees (HR/admin only)
  async getAllStatus(data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Solo RH o admin.')

    var sb = sbClient()
    var start = windowStart()
    var today = new Date().toISOString().split('T')[0]

    // All active employees with a checadorPin (physical punch tracking)
    var employees = await DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' })
    var tracked = employees.filter(function(e) { return !!e.checadorPin })
    if (tracked.length === 0) return { items: [], windowStart: start }

    var ids = tracked.map(function(e) { return e.id })
    var dayStart = start + 'T00:00:00-06:00'
    var dayEnd   = today + 'T23:59:59-06:00'

    var [punchRes, appealRes] = await Promise.all([
      sb.from('attendance_punches')
        .select('employee_id, punched_at')
        .in('employee_id', ids)
        .gte('punched_at', dayStart)
        .lte('punched_at', dayEnd)
        .order('punched_at'),
      sb.from('tardiness_appeals')
        .select('employee_id, date')
        .in('employee_id', ids)
        .eq('status', 'aprobado')
        .gte('date', start)
        .lte('date', today)
    ])

    var punches  = punchRes.data  || []
    var appeals  = appealRes.data || []

    // First punch per employee per CDMX date
    var firstByEmpDate = {}
    punches.forEach(function(p) {
      var cdmxD = new Date(new Date(p.punched_at).getTime() - 6 * 3600 * 1000)
      var cdmxDate = cdmxD.toISOString().split('T')[0]
      var key = p.employee_id + '|' + cdmxDate
      if (!firstByEmpDate[key]) firstByEmpDate[key] = p.punched_at
    })

    // Approved appeals set
    var appealSet = new Set(appeals.map(function(a) { return a.employee_id + '|' + a.date }))

    // Count retardos per employee
    var countByEmp = {}
    Object.keys(firstByEmpDate).forEach(function(key) {
      var parts = key.split('|')
      var empId = parts[0], date = parts[1]
      if (date < POLICY_START) return
      if (appealSet.has(key)) return
      if (isLate(firstByEmpDate[key])) {
        countByEmp[empId] = (countByEmp[empId] || 0) + 1
      }
    })

    var empMap = {}
    tracked.forEach(function(e) { empMap[e.id] = e })

    var items = tracked.map(function(e) {
      var count = countByEmp[e.id] || 0
      var tier  = getTier(count)
      return {
        employeeId:    e.id,
        name:          (e.firstName || '') + ' ' + (e.lastName || ''),
        department:    e.department || '',
        count:         count,
        daysToDeduct:  getDaysToDeduct(count),
        severity:      tier.severity,
        label:         tier.label,
        bg:            tier.bg,
        fg:            tier.fg
      }
    })

    // Sort: most critical first, then by name
    var severityOrder = { rescision: 0, critical: 1, high: 2, medium: 3, low: 4, ok: 5 }
    items.sort(function(a, b) {
      var so = (severityOrder[a.severity] || 9) - (severityOrder[b.severity] || 9)
      if (so !== 0) return so
      return a.name.localeCompare(b.name)
    })

    return { items: items, windowStart: start, tiers: TIERS }
  }
}
