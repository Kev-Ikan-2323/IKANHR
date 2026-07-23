// ============================================================
// auth.js — Authentication & role-based access control
// Mirrors GAS Auth.js logic, adapted for Supabase + Next.js
// ============================================================

import { getUserFromToken } from './supabase.js'
import { DB } from './db.js'

var SHEETS = {
  EMPLOYEES: 'Employees',
  ROLES:     'Roles',
  TEAMS:     'Teams'
}

var SYSTEM_ROLES = {
  ADMIN:    'admin',
  HR:       'hr',
  MANAGER:  'manager',
  EMPLOYEE: 'employee'
}

// Get the current authenticated user from the Bearer token,
// then load their employee record and build the user object.
export async function getCurrentUser(req, res) {
  var authHeader = req.headers['authorization'] || ''
  var token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  var authUser = await getUserFromToken(token)

  var email = authUser ? authUser.email : null
  if (!email) return null

  var results = await DB.getBy(SHEETS.EMPLOYEES, 'email', email)
  if (!results.length) return null

  var emp = results[0]

  // Load role and permissions
  var roleData = emp.roleId ? await DB.getById(SHEETS.ROLES, emp.roleId) : null
  var permissions = []
  if (roleData && roleData.permissions) {
    try {
      permissions = typeof roleData.permissions === 'string'
        ? JSON.parse(roleData.permissions)
        : roleData.permissions
    } catch (e) {
      permissions = []
    }
  }

  // Determine team leadership
  var ledTeams   = await DB.getBy(SHEETS.TEAMS, 'leaderId',   emp.id)
  var coledTeams = await DB.getBy(SHEETS.TEAMS, 'coLeaderId', emp.id)

  var canApproveVacations = emp.canApproveVacations === undefined || emp.canApproveVacations === ''
    ? true : String(emp.canApproveVacations) === 'true'

  return {
    id:                  emp.id,
    email:               email,
    firstName:           emp.firstName,
    lastName:            emp.lastName,
    fullName:            (emp.firstName || '') + ' ' + (emp.lastName || ''),
    roleId:              emp.roleId,
    roleName:            roleData ? roleData.name : '',
    teamId:              emp.teamId,
    managerId:           emp.managerId,
    department:          emp.department,
    permissions:         permissions,
    isAdmin:             permissions.indexOf('admin') > -1,
    isHR:                permissions.indexOf('hr') > -1,
    isManager:           permissions.indexOf('manager') > -1 || ledTeams.length > 0 || coledTeams.length > 0,
    ledTeams:            ledTeams.map(function(t) { return t.id }),
    coledTeams:          coledTeams.map(function(t) { return t.id }),
    canApproveVacations: canApproveVacations,
    country:             emp.country || 'MX'
  }
}

// Throw if not authenticated; return user if authenticated.
export async function requireLogin(req, res) {
  var user = await getCurrentUser(req, res)
  if (!user) throw new Error('No autenticado. Por favor inicia sesión con tu cuenta corporativa.')
  return user
}

// Throw if user lacks any of the required roles.
export async function requireRole(req, res, roles) {
  var user = await requireLogin(req, res)
  if (user.isAdmin) return user // admin has access to everything

  var hasRole = roles.some(function(role) {
    switch (role) {
      case SYSTEM_ROLES.ADMIN:    return user.isAdmin
      case SYSTEM_ROLES.HR:       return user.isHR
      case SYSTEM_ROLES.MANAGER:  return user.isManager
      case SYSTEM_ROLES.EMPLOYEE: return true
      default: return user.permissions.indexOf(role) > -1
    }
  })

  if (!hasRole) {
    throw new Error('Acceso denegado. Se requiere uno de los roles: ' + roles.join(', '))
  }
  return user
}

// Check if a user can read/write data for a given employee.
export async function canAccessEmployee(user, targetEmployeeId) {
  if (user.isAdmin || user.isHR) return true
  if (user.id === targetEmployeeId) return true

  var target = await DB.getById(SHEETS.EMPLOYEES, targetEmployeeId)
  if (target && target.managerId === user.id) return true

  var targetTeam = target ? target.teamId : null
  if (targetTeam) {
    if (user.ledTeams.indexOf(targetTeam) > -1)   return true
    if (user.coledTeams.indexOf(targetTeam) > -1) return true
  }
  return false
}

// Check if a user is manager of a given employee.
export async function isManagerOf(user, targetEmployeeId) {
  if (user.isAdmin || user.isHR) return true

  var target = await DB.getById(SHEETS.EMPLOYEES, targetEmployeeId)
  if (!target) return false

  if (target.managerId === user.id) return true

  if (target.teamId) {
    if (user.coledTeams.indexOf(target.teamId) > -1) return true
  }
  return false
}

export var CONFIG = {
  SHEETS: {
    EMPLOYEES:         'Employees',
    ROLES:             'Roles',
    POSITIONS:         'Positions',
    TEAMS:             'Teams',
    ORG_CHART:         'OrgChart',
    KPI_DEFINITIONS:   'KPIDefinitions',
    KPI_PERIODS:       'KPIPeriods',
    KPI_REVIEWS:       'KPIReviews',
    VACATION_BALANCE:  'VacationBalance',
    VACATION_REQUESTS: 'VacationRequests',
    HOLIDAYS:          'MexicanHolidays',
    ANNOUNCEMENTS:     'Announcements',
    AUDIT_LOG:         'AuditLog',
    CONFIG:            'Config',
    KPI_SCHEDULES:     'KPISchedules'
  },
  SYSTEM_ROLES: SYSTEM_ROLES,
  STATUS: {
    PENDING:         'Pendiente',
    PENDING_MANAGER: 'Pendiente Manager',
    APPROVED:        'Aprobado',
    REJECTED:        'Rechazado',
    COMPLETED:       'Completado',
    IN_REVIEW:       'En Revisión',
    DRAFT:           'Borrador'
  },
  KPI_TYPES: {
    NUMERIC:    'Numérico',
    PERCENTAGE: 'Porcentaje',
    BOOLEAN:    'Sí/No',
    QUALITATIVE:'Cualitativo'
  },
  KPI_PERIODS: {
    MONTHLY:    'Mensual',
    BIMONTHLY:  'Bimestral',
    QUARTERLY:  'Trimestral',
    SEMIANNUAL: 'Semestral',
    ANNUAL:     'Anual'
  },
  VACATION_DAYS: { 1: 12, 2: 14, 3: 16, 4: 18, 5: 20 }
}
