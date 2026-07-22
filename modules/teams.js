// ============================================================
// modules/teams.js — Team management (port of GAS Teams.js)
// ============================================================

import { DB } from '../lib/db.js'
import { CONFIG } from '../lib/auth.js'

export var TeamsModule = {

  async list(user) {
    var teams = await DB.getAll(CONFIG.SHEETS.TEAMS)
    return Promise.all(teams.map(_enrich))
  },

  async get(id, user) {
    var team = await DB.getById(CONFIG.SHEETS.TEAMS, id)
    if (!team) throw new Error('Equipo no encontrado: ' + id)
    return _enrich(team)
  },

  async create(data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    await _validate(data)
    data.status = data.status || 'activo'
    var team = await DB.insert(CONFIG.SHEETS.TEAMS, data)

    if (data.memberIds && data.memberIds.length > 0) {
      await Promise.all(data.memberIds.map(function(empId) {
        return DB.update(CONFIG.SHEETS.EMPLOYEES, empId, { teamId: team.id })
      }))
    }
    return _enrich(team)
  },

  async update(id, changes, user) {
    if (!user.isAdmin && !user.isHR && !user.isManager) {
      throw new Error('Acceso denegado.')
    }

    if (!user.isAdmin && !user.isHR) {
      var team = await DB.getById(CONFIG.SHEETS.TEAMS, id)
      if (team.leaderId !== user.id && team.coLeaderId !== user.id) {
        throw new Error('Solo el líder o co-líder puede editar este equipo.')
      }
      delete changes.leaderId
    }

    var updated = await DB.update(CONFIG.SHEETS.TEAMS, id, changes)
    return _enrich(updated)
  },

  async getMembers(teamId, user) {
    var members = await DB.query(CONFIG.SHEETS.EMPLOYEES, { teamId: teamId, status: 'activo' })
    var team    = await DB.getById(CONFIG.SHEETS.TEAMS, teamId)
    return members.map(function(emp) {
      return {
        id:         emp.id,
        fullName:   (emp.firstName || '') + ' ' + (emp.lastName || ''),
        email:      emp.email,
        jobTitle:   emp.jobTitle,
        department: emp.department,
        photoUrl:   emp.photoUrl,
        isLeader:   team && team.leaderId   === emp.id,
        isCoLeader: team && team.coLeaderId === emp.id,
        hireDate:   emp.hireDate
      }
    })
  },

  async addMember(teamId, employeeId, user) {
    var team = await DB.getById(CONFIG.SHEETS.TEAMS, teamId)
    if (!team) throw new Error('Equipo no encontrado.')

    if (!user.isAdmin && !user.isHR && team.leaderId !== user.id && team.coLeaderId !== user.id) {
      throw new Error('Solo el líder o co-líder puede agregar miembros.')
    }

    return DB.update(CONFIG.SHEETS.EMPLOYEES, employeeId, { teamId: teamId })
  },

  async removeMember(teamId, employeeId, user) {
    var team = await DB.getById(CONFIG.SHEETS.TEAMS, teamId)
    if (!team) throw new Error('Equipo no encontrado.')

    if (!user.isAdmin && !user.isHR && team.leaderId !== user.id) {
      throw new Error('Solo el líder principal puede remover miembros.')
    }

    if (team.leaderId === employeeId) throw new Error('No puedes remover al líder sin reasignar el liderazgo.')

    return DB.update(CONFIG.SHEETS.EMPLOYEES, employeeId, { teamId: '' })
  },

  async assignCoLeader(teamId, employeeId, user) {
    if (!user.isAdmin && !user.isHR && !user.isManager) {
      throw new Error('Acceso denegado.')
    }
    var team = await DB.getById(CONFIG.SHEETS.TEAMS, teamId)
    if (!user.isAdmin && !user.isHR && team.leaderId !== user.id) {
      throw new Error('Solo el líder principal puede asignar co-líderes.')
    }

    var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, employeeId)
    if (!emp || emp.teamId !== teamId) throw new Error('El empleado debe pertenecer al equipo.')

    var updated = await DB.update(CONFIG.SHEETS.TEAMS, teamId, { coLeaderId: employeeId })
    return _enrich(updated)
  },

  async getMyTeams(user) {
    var all = await DB.getAll(CONFIG.SHEETS.TEAMS)
    var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, user.id)

    var myTeams = all.filter(function(t) {
      return (emp && emp.teamId === t.id) ||
             t.leaderId === user.id ||
             t.coLeaderId === user.id
    })

    return Promise.all(myTeams.map(_enrich))
  }
}

async function _validate(data) {
  if (!data.name)     throw new Error('El nombre del equipo es requerido.')
  if (!data.leaderId) throw new Error('El líder del equipo es requerido.')

  var existing = await DB.getBy(CONFIG.SHEETS.TEAMS, 'name', data.name)
  if (existing.length > 0 && existing[0].id !== data.id) {
    throw new Error('Ya existe un equipo con ese nombre.')
  }
}

async function _enrich(team) {
  var leader   = team.leaderId   ? await DB.getById(CONFIG.SHEETS.EMPLOYEES, team.leaderId)   : null
  var coLeader = team.coLeaderId ? await DB.getById(CONFIG.SHEETS.EMPLOYEES, team.coLeaderId) : null
  var members  = await DB.query(CONFIG.SHEETS.EMPLOYEES, { teamId: team.id, status: 'activo' })

  team.leaderName   = leader   ? (leader.firstName   || '') + ' ' + (leader.lastName   || '') : ''
  team.coLeaderName = coLeader ? (coLeader.firstName || '') + ' ' + (coLeader.lastName || '') : ''
  team.memberCount  = members.length
  return team
}
