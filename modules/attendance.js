// ============================================================
// modules/attendance.js — Attendance tracking (ZKTeco checador + home office)
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { DB } from '../lib/db.js'
import { CONFIG } from '../lib/auth.js'

function sbClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

// 9:10 AM CDMX in minutes from local midnight
var LATE_LIMIT = 9 * 60 + 10

// Convert UTC timestamp to CDMX minutes-since-midnight (UTC-6)
function toCdmxMins(utcTs) {
  var cdmx = new Date(new Date(utcTs).getTime() - 6 * 3600 * 1000)
  return cdmx.getUTCHours() * 60 + cdmx.getUTCMinutes()
}

// Get CDMX date string from UTC timestamp
function toCdmxDate(utcTs) {
  return new Date(new Date(utcTs).getTime() - 6 * 3600 * 1000).toISOString().split('T')[0]
}

function todayCdmx() {
  return toCdmxDate(new Date().toISOString())
}

function toStatus(checkInUtc, dateStr) {
  if (!checkInUtc) {
    if (dateStr !== todayCdmx()) return 'ausente'
    return toCdmxMins(new Date().toISOString()) < LATE_LIMIT ? 'pendiente' : 'ausente'
  }
  return toCdmxMins(checkInUtc) <= LATE_LIMIT ? 'a_tiempo' : 'retardo'
}

// Given an array of punches for one employee, return first and last UTC timestamps
function firstLast(punches) {
  if (!punches || punches.length === 0) return { checkIn: null, checkOut: null }
  var sorted = punches.slice().sort(function(a, b) {
    return a.punched_at.localeCompare(b.punched_at)
  })
  return {
    checkIn:  sorted[0].punched_at,
    checkOut: sorted.length > 1 ? sorted[sorted.length - 1].punched_at : null
  }
}

export var AttendanceModule = {

  // Admin/HR → all employees for a date; everyone else → own record for a date
  async getDay(data, user) {
    var date = data.date || todayCdmx()
    if (user.isAdmin || user.isHR) return _getAllDay(date)
    return _getEmployeeDay(user.id, date)
  },

  // Return punch history (last N days) for an employee
  async getHistory(data, user) {
    var employeeId = data.employeeId || user.id
    if (employeeId !== user.id && !user.isAdmin && !user.isHR) {
      throw new Error('Acceso denegado.')
    }
    var days = Math.min(parseInt(data.days) || 30, 90)
    return _getHistory(employeeId, days)
  },

  // Monthly summary — employee sees own record, admin/HR sees all employees
  async getMonth(data, user) {
    var todayParts = todayCdmx().split('-')
    var year  = parseInt(data.year)  || parseInt(todayParts[0])
    var month = parseInt(data.month) || parseInt(todayParts[1])
    if (!data.personal && (user.isAdmin || user.isHR)) return _getAllMonth(year, month)
    return _getEmployeeMonth(user.id, year, month)
  }
}

async function _getAllDay(date) {
  var sb = client()
  var dayStart = date + 'T00:00:00-06:00'
  var dayEnd   = date + 'T23:59:59-06:00'

  var [employees, punchRes] = await Promise.all([
    DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' }),
    sb.from('attendance_punches')
      .select('employee_id, punched_at, source')
      .gte('punched_at', dayStart)
      .lte('punched_at', dayEnd)
  ])

  if (punchRes.error) throw new Error('Error obteniendo checadas: ' + punchRes.error.message)

  // Group punches by employee_id
  var byEmp = {}
  ;(punchRes.data || []).forEach(function(p) {
    if (!p.employee_id) return
    if (!byEmp[p.employee_id]) byEmp[p.employee_id] = []
    byEmp[p.employee_id].push(p)
  })

  return employees.map(function(emp) {
    var punches = byEmp[emp.id] || []
    var fl      = firstLast(punches)
    return {
      employeeId:  emp.id,
      firstName:   emp.firstName || '',
      lastName:    emp.lastName  || '',
      department:  emp.department || '',
      checadorPin: emp.checadorPin || '',
      isRemote:    emp.isRemote === true || emp.isRemote === 'true',
      checkIn:     fl.checkIn,
      checkOut:    fl.checkOut,
      status:      toStatus(fl.checkIn, date),
      source:      punches.length > 0 ? punches[0].source : null,
      punchCount:  punches.length
    }
  })
}

async function _getEmployeeDay(employeeId, date) {
  var sb = client()
  var dayStart = date + 'T00:00:00-06:00'
  var dayEnd   = date + 'T23:59:59-06:00'

  var { data: punches, error } = await sb
    .from('attendance_punches')
    .select('punched_at, source')
    .eq('employee_id', employeeId)
    .gte('punched_at', dayStart)
    .lte('punched_at', dayEnd)

  if (error) throw new Error('Error: ' + error.message)

  var fl = firstLast(punches)
  return [{
    checkIn:    fl.checkIn,
    checkOut:   fl.checkOut,
    status:     toStatus(fl.checkIn, date),
    source:     punches && punches[0] ? punches[0].source : null,
    punchCount: (punches || []).length
  }]
}

async function _getHistory(employeeId, days) {
  var sb = client()
  var since = new Date()
  since.setDate(since.getDate() - days)
  var sinceStr = toCdmxDate(since.toISOString()) + 'T00:00:00-06:00'

  var { data: punches, error } = await sb
    .from('attendance_punches')
    .select('punched_at, source')
    .eq('employee_id', employeeId)
    .gte('punched_at', sinceStr)
    .order('punched_at', { ascending: true })

  if (error) throw new Error('Error: ' + error.message)

  // Group by CDMX date
  var byDate = {}
  ;(punches || []).forEach(function(p) {
    var d = toCdmxDate(p.punched_at)
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(p)
  })

  return Object.keys(byDate).sort().reverse().map(function(dateStr) {
    var fl = firstLast(byDate[dateStr])
    return {
      date:       dateStr,
      checkIn:    fl.checkIn,
      checkOut:   fl.checkOut,
      status:     toStatus(fl.checkIn, dateStr),
      source:     byDate[dateStr][0].source,
      punchCount: byDate[dateStr].length
    }
  })
}

// Build Set of vacation dates (YYYY-MM-DD) for a given month from an array of approved requests
function _buildVacationSet(requests, year, month) {
  var mon        = String(month).padStart(2, '0')
  var monthStart = year + '-' + mon + '-01'
  var monthEnd   = year + '-' + mon + '-' + String(new Date(year, month, 0).getDate()).padStart(2, '0')
  var dates      = new Set()
  requests.forEach(function(req) {
    var s = req.startDate, e = req.endDate
    if (!s || !e || e < monthStart || s > monthEnd) return
    var curr = new Date((s >= monthStart ? s : monthStart) + 'T12:00:00')
    var end  = new Date((e <= monthEnd   ? e : monthEnd)   + 'T12:00:00')
    while (curr <= end) {
      dates.add(curr.toISOString().split('T')[0])
      curr.setDate(curr.getDate() + 1)
    }
  })
  return dates
}

// Weekdays (Mon–Fri) in a month up to today in CDMX
function workdaysInMonth(year, month) {
  var today   = todayCdmx()
  var lastDay = new Date(year, month, 0).getDate()
  var mon     = String(month).padStart(2, '0')
  var days    = []
  for (var d = 1; d <= lastDay; d++) {
    var dateStr = year + '-' + mon + '-' + String(d).padStart(2, '0')
    var dow     = new Date(dateStr + 'T12:00:00').getDay()
    if (dow === 0 || dow === 6) continue
    if (dateStr > today) continue
    days.push(dateStr)
  }
  return days
}

async function _getEmployeeMonth(employeeId, year, month) {
  var sb      = sbClient()
  var mon     = String(month).padStart(2, '0')
  var lastDay = new Date(year, month, 0).getDate()
  var dayStart = year + '-' + mon + '-01T00:00:00-06:00'
  var dayEnd   = year + '-' + mon + '-' + String(lastDay).padStart(2, '0') + 'T23:59:59-06:00'

  var [punchRes, vacRequests] = await Promise.all([
    sb.from('attendance_punches')
      .select('punched_at, source')
      .eq('employee_id', employeeId)
      .gte('punched_at', dayStart)
      .lte('punched_at', dayEnd),
    DB.query(CONFIG.SHEETS.VACATION_REQUESTS, { employeeId: employeeId, status: 'Aprobado' })
  ])

  if (punchRes.error) throw new Error('Error: ' + punchRes.error.message)

  var byDate = {}
  ;(punchRes.data || []).forEach(function(p) {
    var d = toCdmxDate(p.punched_at)
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(p)
  })

  var vacDates = _buildVacationSet(vacRequests, year, month)

  var wdays   = workdaysInMonth(year, month)
  var summary = { aTime: 0, retardo: 0, ausente: 0, vacaciones: 0, workdays: wdays.length }
  var records = wdays.slice().reverse().map(function(dateStr) {
    var fl  = firstLast(byDate[dateStr] || [])
    var status
    if (!fl.checkIn && vacDates.has(dateStr)) {
      status = 'vacaciones'
    } else {
      status = toStatus(fl.checkIn, dateStr)
    }
    if (status === 'a_tiempo')  summary.aTime++
    else if (status === 'retardo')    summary.retardo++
    else if (status === 'ausente')    summary.ausente++
    else if (status === 'vacaciones') summary.vacaciones++
    return {
      date:     dateStr,
      checkIn:  fl.checkIn,
      checkOut: fl.checkOut,
      status:   status,
      source:   byDate[dateStr] && byDate[dateStr][0] ? byDate[dateStr][0].source : null
    }
  })

  return { year: year, month: month, summary: summary, days: records }
}

async function _getAllMonth(year, month) {
  var sb      = sbClient()
  var mon     = String(month).padStart(2, '0')
  var lastDay = new Date(year, month, 0).getDate()
  var dayStart = year + '-' + mon + '-01T00:00:00-06:00'
  var dayEnd   = year + '-' + mon + '-' + String(lastDay).padStart(2, '0') + 'T23:59:59-06:00'

  var wdays = workdaysInMonth(year, month)

  var [employees, punchRes, vacAll] = await Promise.all([
    DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' }),
    sb.from('attendance_punches')
      .select('employee_id, punched_at')
      .gte('punched_at', dayStart)
      .lte('punched_at', dayEnd),
    DB.query(CONFIG.SHEETS.VACATION_REQUESTS, { status: 'Aprobado' })
  ])

  if (punchRes.error) throw new Error('Error: ' + punchRes.error.message)

  // Build vacation set per employee for this month
  var vacRawByEmp = {}
  vacAll.forEach(function(req) {
    if (!req.employeeId) return
    if (!vacRawByEmp[req.employeeId]) vacRawByEmp[req.employeeId] = []
    vacRawByEmp[req.employeeId].push(req)
  })
  var vacByEmp = {}
  Object.keys(vacRawByEmp).forEach(function(empId) {
    vacByEmp[empId] = _buildVacationSet(vacRawByEmp[empId], year, month)
  })

  var byEmpDate = {}
  ;(punchRes.data || []).forEach(function(p) {
    if (!p.employee_id) return
    var d = toCdmxDate(p.punched_at)
    if (!byEmpDate[p.employee_id]) byEmpDate[p.employee_id] = {}
    if (!byEmpDate[p.employee_id][d]) byEmpDate[p.employee_id][d] = []
    byEmpDate[p.employee_id][d].push(p)
  })

  var withPin = employees.filter(function(e) {
    return e.checadorPin && !(e.isRemote === true || e.isRemote === 'true')
  })

  var empStats = withPin.map(function(emp) {
    var empDays   = byEmpDate[emp.id] || {}
    var empVacSet = vacByEmp[emp.id]  || new Set()
    var stats     = { aTime: 0, retardo: 0, ausente: 0, vacaciones: 0 }
    wdays.forEach(function(dateStr) {
      var fl = firstLast(empDays[dateStr] || [])
      var s
      if (!fl.checkIn && empVacSet.has(dateStr)) {
        s = 'vacaciones'
      } else {
        s = toStatus(fl.checkIn, dateStr)
      }
      if (s === 'a_tiempo')       stats.aTime++
      else if (s === 'retardo')   stats.retardo++
      else if (s === 'ausente')   stats.ausente++
      else if (s === 'vacaciones') stats.vacaciones++
    })
    return {
      employeeId:  emp.id,
      firstName:   emp.firstName  || '',
      lastName:    emp.lastName   || '',
      department:  emp.department || '',
      aTime:       stats.aTime,
      retardo:     stats.retardo,
      ausente:     stats.ausente,
      vacaciones:  stats.vacaciones,
      workdays:    wdays.length
    }
  })

  empStats.sort(function(a, b) {
    if (b.retardo !== a.retardo) return b.retardo - a.retardo
    return b.ausente - a.ausente
  })

  var totals = empStats.reduce(function(acc, e) {
    acc.aTime      += e.aTime
    acc.retardo    += e.retardo
    acc.ausente    += e.ausente
    acc.vacaciones += e.vacaciones
    return acc
  }, { aTime: 0, retardo: 0, ausente: 0, vacaciones: 0 })

  var n = wdays.length * (empStats.length || 1)

  return {
    year:     year,
    month:    month,
    workdays: wdays.length,
    employees: empStats,
    summary: {
      total:      empStats.length,
      aTime:      totals.aTime,
      retardo:    totals.retardo,
      ausente:    totals.ausente,
      vacaciones: totals.vacaciones,
      pct:        n > 0 ? Math.round((totals.aTime / n) * 100) : 0
    }
  }
}

function client() { return sbClient() }
