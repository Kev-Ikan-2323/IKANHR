// ============================================================
// modules/employees.js — Employee management (port of GAS Employees.js)
// ============================================================

import { DB } from '../lib/db.js'
import { CONFIG, requireLogin, requireRole, canAccessEmployee, isManagerOf } from '../lib/auth.js'

export var EmployeeModule = {

  async list(params, user) {
    params = params || {}

    var all = await DB.getAll(CONFIG.SHEETS.EMPLOYEES)

    // If not admin/HR, only see own team/reports
    if (!user.isAdmin && !user.isHR) {
      all = all.filter(function(emp) {
        if (emp.id === user.id) return true
        if (emp.managerId === user.id) return true
        if (user.ledTeams.indexOf(emp.teamId) > -1) return true
        if (user.coledTeams.indexOf(emp.teamId) > -1) return true
        return false
      })
    }

    if (params.department) all = all.filter(function(e) { return e.department === params.department })
    if (params.teamId)     all = all.filter(function(e) { return e.teamId === params.teamId })
    if (params.status)     all = all.filter(function(e) { return e.status === params.status })
    if (params.roleId)     all = all.filter(function(e) { return e.roleId === params.roleId })
    if (params.managerId)  all = all.filter(function(e) { return e.managerId === params.managerId })

    if (params.search) {
      var q = params.search.toLowerCase()
      all = all.filter(function(e) {
        return ((e.firstName || '') + ' ' + (e.lastName || '')).toLowerCase().indexOf(q) > -1 ||
               (e.email || '').toLowerCase().indexOf(q) > -1 ||
               (e.employeeNumber || '').toLowerCase().indexOf(q) > -1
      })
    }

    return all.map(function(e) { return _sanitize(e, user) })
  },

  async get(id, user) {
    var ok = await canAccessEmployee(user, id)
    if (!ok) throw new Error('Acceso denegado a este empleado.')

    var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, id)
    if (!emp) throw new Error('Empleado no encontrado: ' + id)

    var enriched = await _enrich(emp)
    return _sanitize(enriched, user)
  },

  async create(data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere uno de los roles: admin, hr')

    _validate(data)

    if (!data.employeeNumber) {
      data.employeeNumber = await _nextEmployeeNumber()
    }

    if (data.hireDate && !data.vacationDaysPerYear) {
      data.vacationDaysPerYear = _calcVacationDays(data.hireDate)
    }

    data.status = data.status || 'activo'
    var emp = await DB.insert(CONFIG.SHEETS.EMPLOYEES, data)

    await _createInitialVacationBalance(emp.id, emp.vacationDaysPerYear)

    if (emp.managerId) {
      await _updateOrgChart(emp.id, emp.managerId, emp.teamId)
    }

    return emp
  },

  async update(id, changes, user) {
    if (user.id !== id) {
      if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere uno de los roles: admin, hr')
    } else {
      // Employee can only edit non-sensitive fields
      var allowed = ['phone', 'personalEmail', 'address', 'emergencyContact', 'emergencyPhone', 'photoUrl']
      var filtered = {}
      allowed.forEach(function(k) { if (changes[k] !== undefined) filtered[k] = changes[k] })
      changes = filtered
    }

    if (changes.hireDate) {
      changes.vacationDaysPerYear = _calcVacationDays(changes.hireDate)
    }

    var updated = await DB.update(CONFIG.SHEETS.EMPLOYEES, id, changes)

    if (changes.managerId || changes.teamId) {
      var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, id)
      await _updateOrgChart(id, emp.managerId, emp.teamId)
    }

    return updated
  },

  async deactivate(id, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere uno de los roles: admin, hr')
    return DB.update(CONFIG.SHEETS.EMPLOYEES, id, {
      status:          'inactivo',
      terminationDate: new Date().toISOString().split('T')[0]
    })
  },

  async getDirectory(user) {
    var all = await DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' })
    return all.map(function(e) {
      return {
        id:        e.id,
        fullName:  (e.firstName || '') + ' ' + (e.lastName || ''),
        jobTitle:  e.jobTitle,
        department: e.department,
        email:     e.email,
        phone:     e.phone,
        teamId:    e.teamId,
        managerId: e.managerId,
        photoUrl:  e.photoUrl,
        birthDate: e.birthDate
      }
    })
  },

  async getDirectReports(managerId, user) {
    return DB.query(CONFIG.SHEETS.EMPLOYEES, { managerId: managerId, status: 'activo' })
  },

  async getAnniversaryInfo(employeeId, user) {
    var emp = await this.get(employeeId, user)
    if (!emp || !emp.hireDate) return null

    var hire  = new Date(emp.hireDate)
    var today = new Date()
    var years  = today.getFullYear() - hire.getFullYear()
    var months = today.getMonth() - hire.getMonth()
    if (months < 0) { years--; months += 12 }

    var nextAnniversary = new Date(today.getFullYear(), hire.getMonth(), hire.getDate())
    if (nextAnniversary < today) nextAnniversary.setFullYear(nextAnniversary.getFullYear() + 1)
    var daysToAnniversary = Math.ceil((nextAnniversary - today) / (1000 * 60 * 60 * 24))

    return {
      hireDate:             emp.hireDate,
      yearsOfService:       years,
      monthsOfService:      months,
      totalMonths:          years * 12 + months,
      nextAnniversary:      nextAnniversary.toISOString().split('T')[0],
      daysToAnniversary:    daysToAnniversary,
      vacationDaysEntitled: _calcVacationDays(emp.hireDate)
    }
  }
}

// ── Private helpers ───────────────────────────────────────────

function _validate(data) {
  if (!data.firstName) throw new Error('El nombre es requerido.')
  if (!data.lastName)  throw new Error('El apellido es requerido.')
  if (!data.email)     throw new Error('El email corporativo es requerido.')
  if (!data.roleId)    throw new Error('El rol es requerido.')
}

async function _enrich(emp) {
  var role = emp.roleId   ? await DB.getById(CONFIG.SHEETS.ROLES, emp.roleId) : null
  var team = emp.teamId   ? await DB.getById(CONFIG.SHEETS.TEAMS, emp.teamId) : null
  var mgr  = emp.managerId ? await DB.getById(CONFIG.SHEETS.EMPLOYEES, emp.managerId) : null

  emp.fullName    = (emp.firstName || '') + ' ' + (emp.lastName || '')
  emp.roleName    = role ? role.name : ''
  emp.teamName    = team ? team.name : ''
  emp.managerName = mgr  ? (mgr.firstName || '') + ' ' + (mgr.lastName || '') : ''
  emp.yearsOfService = emp.hireDate
    ? Math.floor((new Date() - new Date(emp.hireDate)) / (365.25 * 86400000))
    : 0
  return emp
}

function _sanitize(emp, user) {
  if (user.isAdmin || user.isHR) return emp
  if (emp.id !== user.id) {
    delete emp.personalEmail
    delete emp.address
    delete emp.emergencyContact
    delete emp.emergencyPhone
    delete emp.salary
  }
  return emp
}

async function _nextEmployeeNumber() {
  var all = await DB.getAll(CONFIG.SHEETS.EMPLOYEES)
  var nums = all
    .map(function(e) { return parseInt((e.employeeNumber || '').replace(/\D/g, ''), 10) })
    .filter(function(n) { return !isNaN(n) })
  var max = nums.length > 0 ? Math.max.apply(null, nums) : 0
  return 'E' + String(max + 1).padStart(3, '0')
}

function _calcVacationDays(hireDate) {
  var years = Math.floor((new Date() - new Date(hireDate)) / (365.25 * 86400000))
  var table = CONFIG.VACATION_DAYS
  if (years < 1) return table[1]
  if (years >= 6) return 20 + Math.floor((years - 5) / 5) * 2
  return table[years] || table[1]
}

async function _createInitialVacationBalance(employeeId, daysEntitled) {
  var year = new Date().getFullYear()
  var entitled = daysEntitled || 12
  await DB.insert(CONFIG.SHEETS.VACATION_BALANCE, {
    employeeId:    employeeId,
    year:          year,
    daysEntitled:  entitled,
    daysUsed:      0,
    daysPending:   0,
    daysRemaining: entitled
  })
}

async function _updateOrgChart(employeeId, managerId, teamId) {
  var existing = await DB.query(CONFIG.SHEETS.ORG_CHART, { employeeId: employeeId })
  var active = existing.filter(function(r) { return !r.endDate })

  if (active.length > 0) {
    await DB.update(CONFIG.SHEETS.ORG_CHART, active[0].id, {
      endDate: new Date().toISOString().split('T')[0]
    })
  }

  // Calculate hierarchy level
  var level = 0
  var currentId = managerId
  while (currentId && level < 10) {
    var mgr = await DB.getById(CONFIG.SHEETS.EMPLOYEES, currentId)
    if (!mgr || !mgr.managerId) break
    currentId = mgr.managerId
    level++
  }

  await DB.insert(CONFIG.SHEETS.ORG_CHART, {
    employeeId:       employeeId,
    parentEmployeeId: managerId || '',
    teamId:           teamId || '',
    level:            level,
    effectiveDate:    new Date().toISOString().split('T')[0],
    endDate:          ''
  })
}
