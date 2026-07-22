// ============================================================
// modules/orgchart.js — Org chart (port of GAS OrgChart.js)
// ============================================================

import { DB } from '../lib/db.js'
import { CONFIG } from '../lib/auth.js'

export var OrgChartModule = {

  async get(user) {
    var employees = await DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' })
    var teams     = await DB.getAll(CONFIG.SHEETS.TEAMS)

    var empMap = {}
    employees.forEach(function(e) {
      empMap[e.id] = {
        id:         e.id,
        fullName:   (e.firstName || '') + ' ' + (e.lastName || ''),
        jobTitle:   e.jobTitle,
        department: e.department,
        email:      e.email,
        photoUrl:   e.photoUrl,
        teamId:     e.teamId,
        managerId:  e.managerId,
        hireDate:   e.hireDate,
        children:   [],
        isLeader:   false,
        isCoLeader: false
      }
    })

    teams.forEach(function(t) {
      if (t.leaderId   && empMap[t.leaderId])   empMap[t.leaderId].isLeader     = true
      if (t.coLeaderId && empMap[t.coLeaderId]) empMap[t.coLeaderId].isCoLeader = true
    })

    var roots = []
    Object.keys(empMap).forEach(function(id) {
      var node = empMap[id]
      if (!node.managerId || !empMap[node.managerId]) {
        roots.push(node)
      } else {
        empMap[node.managerId].children.push(node)
      }
    })

    _sortTree(roots)

    return {
      nodes: roots,
      total: employees.length,
      teams: teams.map(function(t) {
        return {
          id:          t.id,
          name:        t.name,
          department:  t.department,
          leaderId:    t.leaderId,
          coLeaderId:  t.coLeaderId,
          memberCount: employees.filter(function(e) { return e.teamId === t.id }).length
        }
      })
    }
  },

  async getFlat(user) {
    var employees = await DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' })
    var teams     = await DB.getAll(CONFIG.SHEETS.TEAMS)

    var teamMap = {}
    teams.forEach(function(t) { teamMap[t.id] = t.name })

    var empNameMap = {}
    employees.forEach(function(e) { empNameMap[e.id] = (e.firstName || '') + ' ' + (e.lastName || '') })

    return employees.map(function(e) {
      return {
        id:          e.id,
        fullName:    (e.firstName || '') + ' ' + (e.lastName || ''),
        jobTitle:    e.jobTitle,
        department:  e.department,
        teamId:      e.teamId,
        teamName:    teamMap[e.teamId] || '',
        managerId:   e.managerId,
        managerName: empNameMap[e.managerId] || '',
        level:       _getLevel(e, employees),
        photoUrl:    e.photoUrl
      }
    })
  },

  async updateRelation(data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    if (!data.employeeId) throw new Error('employeeId es requerido.')

    if (data.managerId) {
      await _checkNoCycle(data.employeeId, data.managerId)
    }

    var changes = {}
    if (data.managerId !== undefined) changes.managerId = data.managerId
    if (data.teamId    !== undefined) changes.teamId    = data.teamId

    return DB.update(CONFIG.SHEETS.EMPLOYEES, data.employeeId, changes)
  },

  async getChainOfCommand(employeeId, user) {
    var chain   = []
    var currentId = employeeId
    var visited   = {}

    while (currentId && !visited[currentId]) {
      visited[currentId] = true
      var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, currentId)
      if (!emp) break
      chain.push({
        id:       emp.id,
        fullName: (emp.firstName || '') + ' ' + (emp.lastName || ''),
        jobTitle: emp.jobTitle,
        photoUrl: emp.photoUrl
      })
      currentId = emp.managerId
    }

    return chain
  },

  async getAllReports(managerId, user) {
    var all    = await DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' })
    var result = []
    _collectReports(managerId, all, result, {})
    return result
  }
}

function _sortTree(nodes) {
  nodes.sort(function(a, b) {
    if (a.department !== b.department) return (a.department || '').localeCompare(b.department || '')
    return (a.fullName || '').localeCompare(b.fullName || '')
  })
  nodes.forEach(function(n) {
    if (n.children && n.children.length > 0) _sortTree(n.children)
  })
}

function _getLevel(emp, allEmployees) {
  var level   = 0
  var current = emp
  var visited = {}
  var empMap  = {}
  allEmployees.forEach(function(e) { empMap[e.id] = e })

  while (current && current.managerId && !visited[current.id] && level < 15) {
    visited[current.id] = true
    current = empMap[current.managerId]
    level++
  }
  return level
}

async function _checkNoCycle(employeeId, newManagerId) {
  var currentId = newManagerId
  var visited   = {}

  while (currentId) {
    if (currentId === employeeId) {
      throw new Error('No se puede asignar este manager: crearía un ciclo en el organigrama.')
    }
    if (visited[currentId]) break
    visited[currentId] = true

    var mgr = await DB.getById(CONFIG.SHEETS.EMPLOYEES, currentId)
    currentId = mgr ? mgr.managerId : null
  }
}

function _collectReports(managerId, allEmployees, result, visited) {
  if (visited[managerId]) return
  visited[managerId] = true

  var directs = allEmployees.filter(function(e) { return e.managerId === managerId })
  directs.forEach(function(emp) {
    result.push(emp)
    _collectReports(emp.id, allEmployees, result, visited)
  })
}
