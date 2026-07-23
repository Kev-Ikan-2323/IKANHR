// ============================================================
// modules/vacations.js — Vacation management (port of GAS Vacations.js)
// Two-step approval: HR first → designated manager second
// ============================================================

import { DB } from '../lib/db.js'
import { CONFIG, isManagerOf } from '../lib/auth.js'
import { MailService } from '../lib/email.js'

export var VacationsModule = {

  async createRequest(data, user) {
    var employeeId = data.employeeId || user.id

    if (employeeId !== user.id && !user.isAdmin && !user.isHR) {
      throw new Error('Solo puedes solicitar vacaciones para ti mismo.')
    }

    await _validateRequest(data, employeeId)

    var emp       = await DB.getById(CONFIG.SHEETS.EMPLOYEES, employeeId)
    var managerId = emp ? emp.managerId : ''
    var country   = (emp && emp.country) ? emp.country : (user.country || 'MX')
    var workDays  = await this.calculateWorkingDays(data.startDate, data.endDate, country)

    var balance = await _getOrCreateBalance(employeeId)
    if (workDays > (parseInt(balance.daysRemaining) || 0)) {
      throw new Error('Saldo insuficiente. Días disponibles: ' + balance.daysRemaining + ', días solicitados: ' + workDays + '.')
    }

    var start     = new Date(data.startDate)
    var end       = new Date(data.endDate)
    var totalDays = Math.ceil((end - start) / 86400000) + 1

    var request = await DB.insert(CONFIG.SHEETS.VACATION_REQUESTS, {
      employeeId:  employeeId,
      managerId:   managerId,
      startDate:   data.startDate,
      endDate:     data.endDate,
      totalDays:   totalDays,
      workingDays: workDays,
      reason:      data.reason || '',
      status:      CONFIG.STATUS.PENDING,
      requestedAt: new Date().toISOString()
    })

    await DB.update(CONFIG.SHEETS.VACATION_BALANCE, balance.id, {
      daysPending:   (parseInt(balance.daysPending)   || 0) + workDays,
      daysRemaining: (parseInt(balance.daysRemaining) || 0) - workDays
    })

    if (managerId) await _notifyManagerRequest(managerId, emp, request)

    return request
  },

  async approve(requestId, notes, user) {
    var request = await _getRequestOrFail(requestId)

    if (user.isAdmin || user.isHR) {
      if (request.status !== CONFIG.STATUS.PENDING) {
        throw new Error('Solo se pueden aprobar solicitudes en estado Pendiente.')
      }
      var approvingMgr = await _findApprovingManager(request.employeeId)
      if (approvingMgr) {
        await DB.update(CONFIG.SHEETS.VACATION_REQUESTS, requestId, {
          status:            CONFIG.STATUS.PENDING_MANAGER,
          approverManagerId: approvingMgr.id,
          approverNotes:     notes || '',
          reviewedAt:        new Date().toISOString()
        })
        await _notifyManagerApproval(approvingMgr.id, request)
        return { status: CONFIG.STATUS.PENDING_MANAGER }
      } else {
        var updated = await DB.update(CONFIG.SHEETS.VACATION_REQUESTS, requestId, {
          status:        CONFIG.STATUS.APPROVED,
          approverNotes: notes || '',
          managerId:     user.id,
          reviewedAt:    new Date().toISOString()
        })
        await _updateBalanceOnApproval(request)
        await _notifyEmployeeDecision(request.employeeId, request, true, notes)
        return updated
      }
    } else {
      if (request.status !== CONFIG.STATUS.PENDING_MANAGER) {
        throw new Error('Esta solicitud no está pendiente de tu aprobación.')
      }
      if (request.approverManagerId !== user.id) {
        throw new Error('No eres el manager designado para aprobar esta solicitud.')
      }
      var approver = await DB.getById(CONFIG.SHEETS.EMPLOYEES, user.id)
      var canApprove = !approver || approver.canApproveVacations === undefined || approver.canApproveVacations === ''
        ? true : String(approver.canApproveVacations) === 'true'
      if (!canApprove) throw new Error('No tienes permiso para autorizar vacaciones. Contacta a RRHH.')

      var updated = await DB.update(CONFIG.SHEETS.VACATION_REQUESTS, requestId, {
        status:        CONFIG.STATUS.APPROVED,
        approverNotes: notes || '',
        managerId:     user.id,
        reviewedAt:    new Date().toISOString()
      })
      await _updateBalanceOnApproval(request)
      await _notifyEmployeeDecision(request.employeeId, request, true, notes)
      return updated
    }
  },

  async reject(requestId, notes, user) {
    var request = await _getRequestOrFail(requestId)

    var allowedStatuses = [CONFIG.STATUS.PENDING, CONFIG.STATUS.PENDING_MANAGER]
    if (allowedStatuses.indexOf(request.status) === -1) {
      throw new Error('Solo se pueden rechazar solicitudes pendientes.')
    }

    if (request.status === CONFIG.STATUS.PENDING) {
      if (!user.isAdmin && !user.isHR) {
        throw new Error('Solo RH puede rechazar solicitudes en revisión inicial.')
      }
    } else {
      if (!user.isAdmin && !user.isHR) {
        if (request.approverManagerId !== user.id) {
          throw new Error('No eres el manager designado para esta solicitud.')
        }
        var approver = await DB.getById(CONFIG.SHEETS.EMPLOYEES, user.id)
        var canApprove = !approver || approver.canApproveVacations === undefined || approver.canApproveVacations === ''
          ? true : String(approver.canApproveVacations) === 'true'
        if (!canApprove) throw new Error('No tienes permiso para rechazar vacaciones. Contacta a RRHH.')
      }
    }

    var updated = await DB.update(CONFIG.SHEETS.VACATION_REQUESTS, requestId, {
      status:        CONFIG.STATUS.REJECTED,
      approverNotes: notes || '',
      managerId:     user.id,
      reviewedAt:    new Date().toISOString()
    })

    var balance = await _getOrCreateBalance(request.employeeId)
    await DB.update(CONFIG.SHEETS.VACATION_BALANCE, balance.id, {
      daysPending:   (parseInt(balance.daysPending)   || 0) - parseInt(request.workingDays),
      daysRemaining: (parseInt(balance.daysRemaining) || 0) + parseInt(request.workingDays)
    })

    await _notifyEmployeeDecision(request.employeeId, request, false, notes)
    return updated
  },

  async cancelRequest(requestId, user) {
    var request = await _getRequestOrFail(requestId)

    if (request.employeeId !== user.id && !user.isAdmin && !user.isHR) {
      throw new Error('Solo puedes cancelar tus propias solicitudes.')
    }
    if (request.status === CONFIG.STATUS.APPROVED && new Date(request.startDate) <= new Date()) {
      throw new Error('No se puede cancelar una solicitud aprobada que ya inició.')
    }

    await DB.update(CONFIG.SHEETS.VACATION_REQUESTS, requestId, {
      status:    'Cancelado',
      reviewedAt: new Date().toISOString()
    })

    var pendingStatuses = [CONFIG.STATUS.PENDING, CONFIG.STATUS.PENDING_MANAGER]
    if (pendingStatuses.indexOf(request.status) > -1 || request.status === CONFIG.STATUS.APPROVED) {
      var balance = await _getOrCreateBalance(request.employeeId)
      var field   = request.status === CONFIG.STATUS.APPROVED ? 'daysUsed' : 'daysPending'
      var upd     = { daysRemaining: (parseInt(balance.daysRemaining) || 0) + parseInt(request.workingDays) }
      upd[field]  = (parseInt(balance[field]) || 0) - parseInt(request.workingDays)
      await DB.update(CONFIG.SHEETS.VACATION_BALANCE, balance.id, upd)
    }

    return { ok: true }
  },

  async myRequests(employeeId, user) {
    var empId = employeeId || user.id

    var managerOk = await isManagerOf(user, empId)
    if (empId !== user.id && !user.isAdmin && !user.isHR && !managerOk) {
      throw new Error('Acceso denegado.')
    }

    var requests = await DB.query(CONFIG.SHEETS.VACATION_REQUESTS, { employeeId: empId })
    var enriched = await Promise.all(requests.map(_enrichRequest))
    return enriched.sort(function(a, b) {
      return new Date(b.requestedAt) - new Date(a.requestedAt)
    })
  },

  async teamRequests(params, user) {
    params = params || {}
    var all = await DB.getAll(CONFIG.SHEETS.VACATION_REQUESTS)

    if (user.isAdmin || user.isHR) {
      all = all.filter(function(r) { return r.status === CONFIG.STATUS.PENDING })
    } else {
      var approverRec = await DB.getById(CONFIG.SHEETS.EMPLOYEES, user.id)
      var canApprove = !approverRec || approverRec.canApproveVacations === undefined || approverRec.canApproveVacations === ''
        ? true : String(approverRec.canApproveVacations) === 'true'
      if (!canApprove) return []
      all = all.filter(function(r) {
        return r.status === CONFIG.STATUS.PENDING_MANAGER && r.approverManagerId === user.id
      })
    }

    if (params.startDate) all = all.filter(function(r) { return r.startDate >= params.startDate })
    if (params.endDate)   all = all.filter(function(r) { return r.endDate   <= params.endDate })

    var enriched = await Promise.all(all.map(_enrichRequest))
    return enriched.sort(function(a, b) {
      return new Date(b.requestedAt) - new Date(a.requestedAt)
    })
  },

  async getBalance(employeeId, user) {
    var empId = employeeId || user.id
    var managerOk = await isManagerOf(user, empId)
    if (empId !== user.id && !user.isAdmin && !user.isHR && !managerOk) {
      throw new Error('Acceso denegado.')
    }

    var emp     = await DB.getById(CONFIG.SHEETS.EMPLOYEES, empId)
    var balance = await _getOrCreateBalance(empId)

    var entitled = emp ? _calcVacationEntitlement(emp.hireDate) : 12
    if (parseInt(balance.daysEntitled) !== entitled) {
      await DB.update(CONFIG.SHEETS.VACATION_BALANCE, balance.id, { daysEntitled: entitled })
      balance.daysEntitled = entitled
    }

    return {
      employeeId:    empId,
      year:          balance.year,
      daysEntitled:  parseInt(balance.daysEntitled)  || 12,
      daysUsed:      parseInt(balance.daysUsed)      || 0,
      daysPending:   parseInt(balance.daysPending)   || 0,
      daysRemaining: parseInt(balance.daysRemaining) || 0,
      yearsOfService: emp ? Math.floor((new Date() - new Date(emp.hireDate)) / (365.25 * 86400000)) : 0
    }
  },

  async calculateWorkingDays(startDate, endDate, country) {
    var start    = new Date(startDate)
    var end      = new Date(endDate)
    var holidays = await _getHolidayDates(start.getFullYear(), country)

    if (end.getFullYear() !== start.getFullYear()) {
      var nextHolidays = await _getHolidayDates(end.getFullYear(), country)
      nextHolidays.forEach(function(d) { if (holidays.indexOf(d) === -1) holidays.push(d) })
    }

    var workDays = 0
    var current  = new Date(start)
    while (current <= end) {
      var dow     = current.getDay()
      var dateStr = current.toISOString().split('T')[0]
      if (dow !== 0 && dow !== 6 && holidays.indexOf(dateStr) === -1) {
        workDays++
      }
      current.setDate(current.getDate() + 1)
    }
    return workDays
  },

  async getHolidays(year, user) {
    year = year || new Date().getFullYear()
    var all = await DB.getAll(CONFIG.SHEETS.HOLIDAYS)
    return all
      .filter(function(h) {
        return !h.year || String(h.year) === String(year) || h.isRecurring === 'true' || h.isRecurring === true
      })
      .sort(function(a, b) { return (a.date || '').localeCompare(b.date || '') })
  },

  async addHoliday(data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    if (!data.date || !data.name) throw new Error('Fecha y nombre son requeridos.')
    data.year = data.date.split('-')[0]
    return DB.insert(CONFIG.SHEETS.HOLIDAYS, data)
  },

  async removeHoliday(id, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    return DB.softDelete(CONFIG.SHEETS.HOLIDAYS, id)
  },

  async getCalendarMonth(year, month, user) {
    var y = parseInt(year)  || new Date().getFullYear()
    var m = parseInt(month) || new Date().getMonth() + 1

    var startStr = y + '-' + String(m).padStart(2, '0') + '-01'
    var endDate  = new Date(y, m, 0)
    var endStr   = endDate.toISOString().split('T')[0]

    var allReqs = await DB.getAll(CONFIG.SHEETS.VACATION_REQUESTS)
    var requests = allReqs.filter(function(r) {
      return r.status === CONFIG.STATUS.APPROVED &&
             r.startDate <= endStr && r.endDate >= startStr
    })

    var holidays = await this.getHolidays(y, user)
    holidays = holidays.filter(function(h) {
      return h.date >= startStr && h.date <= endStr
    })

    var enrichedReqs = await Promise.all(requests.map(_enrichRequest))
    return {
      year:     y,
      month:    m,
      requests: enrichedReqs,
      holidays: holidays
    }
  },

  async isWorkingDay(dateStr, user) {
    var date     = new Date(dateStr)
    var dow      = date.getDay()
    if (dow === 0 || dow === 6) return false
    var country  = user ? (user.country || 'MX') : 'MX'
    var holidays = await _getHolidayDates(date.getFullYear(), country)
    return holidays.indexOf(dateStr) === -1
  },

  async getUpcomingAbsences(days, user) {
    days = days || 30
    var today  = new Date()
    var future = new Date()
    future.setDate(future.getDate() + days)

    var todayStr  = today.toISOString().split('T')[0]
    var futureStr = future.toISOString().split('T')[0]

    var allReqs = await DB.getAll(CONFIG.SHEETS.VACATION_REQUESTS)
    var requests = allReqs.filter(function(r) {
      return r.status === CONFIG.STATUS.APPROVED &&
             r.endDate >= todayStr &&
             r.startDate <= futureStr
    })

    if (!user.isAdmin && !user.isHR) {
      var checks = await Promise.all(requests.map(function(r) {
        if (r.employeeId === user.id) return Promise.resolve(true)
        return isManagerOf(user, r.employeeId)
      }))
      requests = requests.filter(function(_, i) { return checks[i] })
    }

    var enriched = await Promise.all(requests.map(_enrichRequest))
    return enriched.sort(function(a, b) { return (a.startDate || '').localeCompare(b.startDate || '') })
  },

  async recalculateAnnualBalances(user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    var year      = new Date().getFullYear()
    var employees = await DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' })

    for (var i = 0; i < employees.length; i++) {
      var emp      = employees[i]
      var entitled = _calcVacationEntitlement(emp.hireDate)
      var existing = await DB.query(CONFIG.SHEETS.VACATION_BALANCE, { employeeId: emp.id, year: String(year) })

      if (existing.length > 0) {
        await DB.update(CONFIG.SHEETS.VACATION_BALANCE, existing[0].id, {
          daysEntitled:  entitled,
          daysRemaining: entitled - (parseInt(existing[0].daysUsed) || 0) - (parseInt(existing[0].daysPending) || 0)
        })
      } else {
        await DB.insert(CONFIG.SHEETS.VACATION_BALANCE, {
          employeeId:    emp.id,
          year:          year,
          daysEntitled:  entitled,
          daysUsed:      0,
          daysPending:   0,
          daysRemaining: entitled
        })
      }
    }

    return { updated: employees.length, year: year }
  }
}

// ── Private helpers ───────────────────────────────────────────

async function _validateRequest(data, employeeId) {
  if (!data.startDate) throw new Error('La fecha de inicio es requerida.')
  if (!data.endDate)   throw new Error('La fecha de fin es requerida.')

  var start = new Date(data.startDate)
  var end   = new Date(data.endDate)
  var today = new Date(); today.setHours(0, 0, 0, 0)

  if (start < today) throw new Error('No puedes solicitar vacaciones para fechas pasadas.')
  if (end < start)   throw new Error('La fecha de fin debe ser posterior a la de inicio.')

  var calDays = Math.ceil((end - start) / 86400000) + 1
  if (calDays < 7) {
    throw new Error('El mínimo para solicitar vacaciones es 1 semana (7 días calendario). Días seleccionados: ' + calDays + '.')
  }

  // Minimum advance notice (from config or default 3)
  var configRows = await DB.getBy(CONFIG.SHEETS.CONFIG, 'key', 'vacation_request_days')
  var minDays = parseInt((configRows.length > 0 ? configRows[0].value : '') || '3')
  var diffDays = Math.ceil((start - today) / 86400000)
  if (diffDays < minDays) {
    throw new Error('Las vacaciones deben solicitarse con al menos ' + minDays + ' días de anticipación.')
  }

  var existing = await DB.query(CONFIG.SHEETS.VACATION_REQUESTS, { employeeId: employeeId })
  var overlap = existing.filter(function(r) {
    if (r.status === 'Cancelado' || r.status === CONFIG.STATUS.REJECTED) return false
    return !(r.endDate < data.startDate || r.startDate > data.endDate)
  })
  if (overlap.length > 0) throw new Error('Ya tienes una solicitud de vacaciones que se empalma con esas fechas.')

  var workDays = await VacationsModule.calculateWorkingDays(data.startDate, data.endDate)
  if (workDays === 0) throw new Error('El rango seleccionado no contiene días hábiles (puede ser fin de semana o puente).')
}

async function _getOrCreateBalance(employeeId) {
  var year = new Date().getFullYear()
  var existing = await DB.query(CONFIG.SHEETS.VACATION_BALANCE, {
    employeeId: employeeId,
    year:       String(year)
  })
  if (existing.length > 0) return existing[0]

  var emp      = await DB.getById(CONFIG.SHEETS.EMPLOYEES, employeeId)
  var entitled = emp ? _calcVacationEntitlement(emp.hireDate) : 12
  return DB.insert(CONFIG.SHEETS.VACATION_BALANCE, {
    employeeId:    employeeId,
    year:          year,
    daysEntitled:  entitled,
    daysUsed:      0,
    daysPending:   0,
    daysRemaining: entitled
  })
}

async function _getHolidayDates(year, country) {
  var holidays = await DB.getAll(CONFIG.SHEETS.HOLIDAYS)
  return holidays
    .filter(function(h) {
      if (h.status === 'inactivo') return false
      if (!h.date) return false
      if (country && h.type && h.type !== country) return false
      var hYear = h.date.split('-')[0]
      return String(hYear) === String(year) || h.isRecurring === 'true' || h.isRecurring === true
    })
    .map(function(h) {
      if ((h.isRecurring === 'true' || h.isRecurring === true) && h.date.split('-')[0] !== String(year)) {
        return String(year) + '-' + h.date.split('-').slice(1).join('-')
      }
      return h.date
    })
}

function _calcVacationEntitlement(hireDate) {
  if (!hireDate) return 12
  var years = Math.floor((new Date() - new Date(hireDate)) / (365.25 * 86400000))
  var table = CONFIG.VACATION_DAYS
  if (years < 1) return table[1]
  if (years >= 6) return 20 + Math.floor((years - 5) / 5) * 2
  return table[Math.min(years, 5)] || table[1]
}

function _getRequestOrFail(requestId) {
  return DB.getById(CONFIG.SHEETS.VACATION_REQUESTS, requestId).then(function(r) {
    if (!r) throw new Error('Solicitud no encontrada: ' + requestId)
    return r
  })
}

async function _enrichRequest(req) {
  var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, req.employeeId)
  var mgr = req.managerId ? await DB.getById(CONFIG.SHEETS.EMPLOYEES, req.managerId) : null
  req.employeeName = emp ? (emp.firstName || '') + ' ' + (emp.lastName || '') : ''
  req.managerName  = mgr ? (mgr.firstName || '') + ' ' + (mgr.lastName || '') : ''
  req.department   = emp ? emp.department : ''
  var today = new Date(); today.setHours(0, 0, 0, 0)
  var start = new Date(req.startDate)
  req.daysUntilStart = Math.ceil((start - today) / 86400000)
  return req
}

async function _updateBalanceOnApproval(request) {
  var balance = await _getOrCreateBalance(request.employeeId)
  await DB.update(CONFIG.SHEETS.VACATION_BALANCE, balance.id, {
    daysUsed:    (parseInt(balance.daysUsed)    || 0) + parseInt(request.workingDays),
    daysPending: (parseInt(balance.daysPending) || 0) - parseInt(request.workingDays)
  })
}

async function _findApprovingManager(employeeId) {
  var visited = []
  var current = await DB.getById(CONFIG.SHEETS.EMPLOYEES, employeeId)
  while (current && current.managerId) {
    if (visited.indexOf(current.managerId) > -1) break
    visited.push(current.managerId)
    var mgr = await DB.getById(CONFIG.SHEETS.EMPLOYEES, current.managerId)
    if (!mgr) break
    var canApprove = mgr.canApproveVacations === undefined || mgr.canApproveVacations === ''
      ? true : String(mgr.canApproveVacations) === 'true'
    if (canApprove) return mgr
    current = mgr
  }
  return null
}

async function _notifyManagerApproval(managerId, request) {
  try {
    var mgr = await DB.getById(CONFIG.SHEETS.EMPLOYEES, managerId)
    var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, request.employeeId)
    if (!mgr || !emp) return
    await MailService.send({
      to:       mgr.email,
      subject:  '[HR Platform] Aprobación requerida — Vacaciones de ' + emp.firstName + ' ' + emp.lastName,
      htmlBody: '<p>Hola ' + mgr.firstName + ',</p>' +
                '<p>RH ha revisado y aprobado la solicitud de vacaciones de <strong>' + emp.firstName + ' ' + emp.lastName + '</strong>. Ahora requiere tu autorización final:</p>' +
                '<ul><li>Del: <strong>' + request.startDate + '</strong></li>' +
                '<li>Al: <strong>' + request.endDate + '</strong></li>' +
                '<li>Días hábiles: <strong>' + request.workingDays + '</strong></li></ul>' +
                '<p>Ingresa a HR Platform para aprobar o rechazar.</p>'
    })
  } catch (e) { console.error('Notificación error:', e.message) }
}

async function _notifyManagerRequest(managerId, emp, request) {
  try {
    var mgr = await DB.getById(CONFIG.SHEETS.EMPLOYEES, managerId)
    if (!mgr) return
    await MailService.send({
      to:       mgr.email,
      subject:  '[HR Platform] Solicitud de vacaciones — ' + emp.firstName + ' ' + emp.lastName,
      htmlBody: '<p>Hola ' + mgr.firstName + ',</p>' +
                '<p><strong>' + emp.firstName + ' ' + emp.lastName + '</strong> ha solicitado vacaciones:</p>' +
                '<ul><li>Del: <strong>' + request.startDate + '</strong></li>' +
                '<li>Al: <strong>' + request.endDate + '</strong></li>' +
                '<li>Días hábiles: <strong>' + request.workingDays + '</strong></li></ul>' +
                '<p>Ingresa a HR Platform para aprobar o rechazar la solicitud.</p>'
    })
  } catch (e) { console.error('Notificación error:', e.message) }
}

async function _notifyEmployeeDecision(employeeId, request, approved, notes) {
  try {
    var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, employeeId)
    if (!emp) return
    var status = approved ? 'Aprobada' : 'Rechazada'
    await MailService.send({
      to:       emp.email,
      subject:  '[HR Platform] Tu solicitud de vacaciones fue ' + (approved ? 'aprobada' : 'rechazada'),
      htmlBody: '<p>Hola ' + emp.firstName + ',</p>' +
                '<p>Tu solicitud de vacaciones del <strong>' + request.startDate + '</strong> al <strong>' + request.endDate + '</strong> fue: <strong>' + status + '</strong></p>' +
                (notes ? '<p>Comentario: ' + notes + '</p>' : '') +
                '<p>Puedes ver el detalle en tu perfil de HR Platform.</p>'
    })
  } catch (e) { console.error('Notificación error:', e.message) }
}
