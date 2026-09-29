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

function client() { return sbClient() }
