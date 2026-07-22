// ============================================================
// modules/kpi-schedules.js — KPI Schedule automation (port of GAS KPISchedules.js)
// ============================================================

import { DB } from '../lib/db.js'
import { CONFIG } from '../lib/auth.js'
import { MailService } from '../lib/email.js'

export var KPISchedulesModule = {

  async list(user) {
    return DB.getAll(CONFIG.SHEETS.KPI_SCHEDULES)
  },

  async create(data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    return DB.insert(CONFIG.SHEETS.KPI_SCHEDULES, {
      name:               data.name,
      roleId:             data.roleId || '',
      department:         data.department || '',
      periodType:         data.periodType || 'Mensual',
      dayOfMonth:         parseInt(data.dayOfMonth) || 1,
      selfAssessmentDays: parseInt(data.selfAssessmentDays) || 25,
      managerReviewDays:  parseInt(data.managerReviewDays)  || 30,
      kpiDefinitionIds:   JSON.stringify(Array.isArray(data.kpiDefinitionIds) ? data.kpiDefinitionIds : []),
      isActive:           true,
      lastActivatedAt:    '',
      createdBy:          user ? user.id : ''
    })
  },

  async update(id, data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    var changes = {
      name:               data.name,
      roleId:             data.roleId || '',
      department:         data.department || '',
      periodType:         data.periodType || 'Mensual',
      dayOfMonth:         parseInt(data.dayOfMonth) || 1,
      selfAssessmentDays: parseInt(data.selfAssessmentDays) || 25,
      managerReviewDays:  parseInt(data.managerReviewDays)  || 30,
      isActive:           data.isActive === true || data.isActive === 'true'
    }
    if (data.kpiDefinitionIds !== undefined) {
      changes.kpiDefinitionIds = JSON.stringify(data.kpiDefinitionIds || [])
    }
    return DB.update(CONFIG.SHEETS.KPI_SCHEDULES, id, changes)
  },

  async remove(id, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    return DB.update(CONFIG.SHEETS.KPI_SCHEDULES, id, { isActive: false })
  },

  // Called by daily cron job
  async processSchedules() {
    var schedules = await DB.getAll(CONFIG.SHEETS.KPI_SCHEDULES)
    var today     = new Date()
    var results   = { activated: [], skipped: [] }

    for (var i = 0; i < schedules.length; i++) {
      var schedule = schedules[i]
      if (String(schedule.isActive) !== 'true') {
        results.skipped.push(schedule.name + ' (inactiva)')
        continue
      }
      if (!_isActivationDay(schedule, today)) {
        results.skipped.push(schedule.name + ' (no es el día ' + schedule.dayOfMonth + ')')
        continue
      }
      if (_alreadyActivatedInCycle(schedule, today)) {
        results.skipped.push(schedule.name + ' (ya activada en este ciclo)')
        continue
      }
      try {
        var result = await _activateSchedule(schedule, today)
        await DB.update(CONFIG.SHEETS.KPI_SCHEDULES, schedule.id, { lastActivatedAt: today.toISOString() })
        results.activated.push(schedule.name + ' (' + result.employees + ' empleados, ' + result.kpis + ' KPIs)')
      } catch (e) {
        console.error('Error activando programación "' + schedule.name + '":', e.message)
        results.skipped.push(schedule.name + ' (error: ' + e.message + ')')
      }
    }

    console.log('KPI Schedules — activadas:', results.activated.length, ', omitidas:', results.skipped.length)
    return results
  },

  async runNow(id, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    var schedule = await DB.getById(CONFIG.SHEETS.KPI_SCHEDULES, id)
    if (!schedule) throw new Error('Programación no encontrada: ' + id)
    var result = await _activateSchedule(schedule, new Date())
    await DB.update(CONFIG.SHEETS.KPI_SCHEDULES, id, { lastActivatedAt: new Date().toISOString() })
    return { ok: true, name: schedule.name, employees: result.employees, kpis: result.kpis }
  }
}

// ── Private helpers ───────────────────────────────────────────

function _isActivationDay(schedule, today) {
  var day     = parseInt(schedule.dayOfMonth) || 1
  var lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  return today.getDate() === Math.min(day, lastDay)
}

function _alreadyActivatedInCycle(schedule, today) {
  if (!schedule.lastActivatedAt) return false
  var last = new Date(schedule.lastActivatedAt)
  if (isNaN(last.getTime())) return false
  var windowDays = { 'Mensual': 27, 'Bimestral': 54, 'Semestral': 170 }
  var windowMs   = (windowDays[schedule.periodType] || 27) * 24 * 60 * 60 * 1000
  return (today.getTime() - last.getTime()) < windowMs
}

async function _activateSchedule(schedule, today) {
  var monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

  var startDate    = _fmtDate(today)
  var endDate      = _periodEndDate(today, schedule.periodType)
  var selfDeadline = _fmtDate(_addDays(today, parseInt(schedule.selfAssessmentDays) || 25))
  var mgrDeadline  = _fmtDate(_addDays(today, parseInt(schedule.managerReviewDays)  || 30))
  var periodName   = schedule.name + ' — ' + monthNames[today.getMonth()] + ' ' + today.getFullYear()

  var period = await DB.insert(CONFIG.SHEETS.KPI_PERIODS, {
    name:                   periodName,
    roleId:                 schedule.roleId || '',
    periodType:             schedule.periodType,
    startDate:              startDate,
    endDate:                endDate,
    selfAssessmentDeadline: selfDeadline,
    managerReviewDeadline:  mgrDeadline,
    status:                 'activo'
  })

  var employees = await _getTargetEmployees(schedule)

  var kpiIds = []
  try {
    kpiIds = JSON.parse(schedule.kpiDefinitionIds || '[]')
  } catch (e) {
    kpiIds = []
  }
  if (!kpiIds.length) {
    var allKpis = await DB.getAll(CONFIG.SHEETS.KPI_DEFINITIONS)
    kpiIds = allKpis
      .filter(function(k) {
        return String(k.isActive) === 'true' &&
               (!k.roleId || !schedule.roleId || k.roleId === schedule.roleId)
      })
      .map(function(k) { return k.id })
  }

  for (var i = 0; i < employees.length; i++) {
    var emp = employees[i]
    for (var j = 0; j < kpiIds.length; j++) {
      await DB.insert(CONFIG.SHEETS.KPI_REVIEWS, {
        periodId:          period.id,
        kpiDefinitionId:   kpiIds[j],
        employeeId:        emp.id,
        managerId:         emp.managerId || '',
        selfScore:         '',
        selfComments:      '',
        selfSubmittedAt:   '',
        managerScore:      '',
        managerComments:   '',
        managerReviewedAt: '',
        finalScore:        '',
        status:            'Borrador'
      })
    }
    await _notifyEmployee(emp, periodName, selfDeadline)
  }

  console.log('Período creado: "' + periodName + '" |', employees.length, 'empleados |', kpiIds.length, 'KPIs')
  return { period: period, employees: employees.length, kpis: kpiIds.length }
}

async function _getTargetEmployees(schedule) {
  var all = await DB.getAll(CONFIG.SHEETS.EMPLOYEES)
  var activos = all.filter(function(e) { return e.status === 'activo' })
  if (schedule.roleId) {
    return activos.filter(function(e) { return e.roleId === schedule.roleId })
  }
  if (schedule.department) {
    return activos.filter(function(e) { return e.department === schedule.department })
  }
  return activos
}

async function _notifyEmployee(emp, periodName, deadline) {
  if (!emp.email || emp.email.indexOf('@demo.com') > -1) return
  try {
    await MailService.send({
      to:       emp.email,
      subject:  'Nueva evaluación de KPIs disponible: ' + periodName,
      htmlBody: '<p>Hola <strong>' + emp.firstName + '</strong>,</p>' +
                '<p>Se abrió un nuevo período de evaluación: <strong>' + periodName + '</strong>.</p>' +
                '<p>Completa tu autocalificación antes del <strong>' + deadline + '</strong>.</p>' +
                '<p style="color:#999;font-size:12px;margin-top:24px">Mensaje automático de HR Platform.</p>'
    })
  } catch (e) {
    console.error('Email error (' + emp.email + '):', e.message)
  }
}

function _fmtDate(d) {
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0')
}

function _addDays(date, days) {
  var d = new Date(date.getTime())
  d.setDate(d.getDate() + days)
  return d
}

function _periodEndDate(startDate, periodType) {
  var d = new Date(startDate.getTime())
  if (periodType === 'Mensual')       { d.setMonth(d.getMonth() + 1); d.setDate(d.getDate() - 1) }
  else if (periodType === 'Bimestral') { d.setMonth(d.getMonth() + 2); d.setDate(d.getDate() - 1) }
  else if (periodType === 'Semestral') { d.setMonth(d.getMonth() + 6); d.setDate(d.getDate() - 1) }
  return _fmtDate(d)
}
