// ============================================================
// modules/dashboard.js — Dashboard (port of GAS Dashboard.js)
// ============================================================

import { DB } from '../lib/db.js'
import { CONFIG, isManagerOf } from '../lib/auth.js'
import { KPIModule } from './kpis.js'
import { VacationsModule } from './vacations.js'
import { BirthdaysModule } from './birthdays.js'
import { EmployeeModule } from './employees.js'
import { AnnouncementsModule } from './announcements.js'
import { TeamsModule } from './teams.js'

export var DashboardModule = {

  async getMyData(user) {
    var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, user.id)
    if (!emp) throw new Error('Empleado no encontrado.')

    var kpiData         = await KPIModule.getDashboard(user.id, user)
    var vacBalance      = await VacationsModule.getBalance(user.id, user)
    var allMyRequests   = await VacationsModule.myRequests(user.id, user)
    var today           = new Date().toISOString().split('T')[0]
    var upcomingVac     = allMyRequests.filter(function(r) {
      return r.status === CONFIG.STATUS.APPROVED && r.endDate >= today
    }).slice(0, 3)
    var pendingVacReq   = allMyRequests.filter(function(r) {
      return r.status === CONFIG.STATUS.PENDING
    })
    var birthdays       = await BirthdaysModule.getUpcoming(14, user)
    var anniversaryInfo = await EmployeeModule.getAnniversaryInfo(user.id, user)
    var announcements   = await AnnouncementsModule.list({ limit: 5 }, user)
    var pendingKPIs     = await KPIModule.myPendingSelfAssessments(user)
    var pendingReviews  = user.isManager ? await KPIModule.myPendingManagerReviews(user) : []
    var upcomingAbsences = user.isManager ? await VacationsModule.getUpcomingAbsences(14, user) : []
    var myTeams         = await TeamsModule.getMyTeams(user)

    var teamPendingVac = 0
    if (user.isManager) {
      var teamReqs = await VacationsModule.teamRequests({}, user)
      teamPendingVac = teamReqs.length
    }

    var alerts = _buildAlerts({
      pendingKPIs:     pendingKPIs,
      pendingReviews:  pendingReviews,
      pendingVacReq:   pendingVacReq,
      vacBalance:      vacBalance,
      anniversaryInfo: anniversaryInfo
    })

    return {
      employee:         _buildEmployeeCard(emp, user),
      kpi:              kpiData,
      vacation: {
        balance:         vacBalance,
        upcoming:        upcomingVac,
        pendingRequests: pendingVacReq.length
      },
      team: {
        myTeams:            myTeams,
        upcomingAbsences:   upcomingAbsences,
        pendingVacApproval: teamPendingVac
      },
      birthdays:        birthdays.slice(0, 5),
      todaysBirthdays:  await BirthdaysModule.getToday(user),
      announcements:    announcements,
      pendingKPIs:      pendingKPIs,
      pendingReviews:   pendingReviews,
      anniversaryInfo:  anniversaryInfo,
      alerts:           alerts,
      generatedAt:      new Date().toISOString()
    }
  },

  async getTeamData(teamId, user) {
    var team = await DB.getById(CONFIG.SHEETS.TEAMS, teamId)
    if (!team) throw new Error('Equipo no encontrado.')

    if (!user.isAdmin && !user.isHR && team.leaderId !== user.id && team.coLeaderId !== user.id) {
      throw new Error('Solo el líder o co-líder puede ver el dashboard del equipo.')
    }

    var members          = await TeamsModule.getMembers(teamId, user)
    var kpiTeam          = await KPIModule.getTeamDashboard(teamId, user)
    var pendingVacReqs   = await VacationsModule.teamRequests({}, user)
    var upcomingAbsences = await VacationsModule.getUpcomingAbsences(30, user)
    var pendingKPIReviews = await KPIModule.myPendingManagerReviews(user)
    var allBirthdays     = await BirthdaysModule.getUpcoming(30, user)
    var memberIds        = members.map(function(m) { return m.id })
    var birthdays        = allBirthdays.filter(function(b) { return memberIds.indexOf(b.id) > -1 })

    var stats = await _buildTeamStats(members, teamId)

    return {
      team:             { id: team.id, name: team.name, department: team.department, description: team.description },
      members:          members,
      stats:            stats,
      kpi:              kpiTeam,
      vacation: {
        pendingRequests:  pendingVacReqs,
        upcomingAbsences: upcomingAbsences
      },
      pendingKPIReviews: pendingKPIReviews,
      birthdays:        birthdays,
      generatedAt:      new Date().toISOString()
    }
  },

  async getCompanyData(user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')

    var allEmployees  = await DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' })
    var allTeams      = await DB.getAll(CONFIG.SHEETS.TEAMS)
    var allReviews    = await DB.getAll(CONFIG.SHEETS.KPI_REVIEWS)
    var allRequests   = await DB.getAll(CONFIG.SHEETS.VACATION_REQUESTS)
    var activePeriods = await DB.query(CONFIG.SHEETS.KPI_PERIODS, { status: 'activo' })

    // Distribution by department
    var byDept = {}
    allEmployees.forEach(function(e) {
      byDept[e.department] = (byDept[e.department] || 0) + 1
    })

    // Distribution by seniority
    var seniority = { '< 1 año': 0, '1-2 años': 0, '3-5 años': 0, '> 5 años': 0 }
    allEmployees.forEach(function(e) {
      if (!e.hireDate) return
      var years = Math.floor((new Date() - new Date(e.hireDate)) / (365.25 * 86400000))
      if (years < 1)       seniority['< 1 año']++
      else if (years <= 2) seniority['1-2 años']++
      else if (years <= 5) seniority['3-5 años']++
      else                 seniority['> 5 años']++
    })

    // KPI completion rate for active period
    var kpiCompletion = null
    if (activePeriods.length > 0) {
      var periodId      = activePeriods[0].id
      var periodReviews = allReviews.filter(function(r) { return r.periodId === periodId })
      var completed     = periodReviews.filter(function(r) { return r.status === CONFIG.STATUS.COMPLETED })
      kpiCompletion     = periodReviews.length > 0
        ? Math.round((completed.length / periodReviews.length) * 100)
        : 0
    }

    var pendingVac = allRequests.filter(function(r) { return r.status === CONFIG.STATUS.PENDING })

    var monthBirthdays = await BirthdaysModule.getByMonth(new Date().getMonth() + 1, user)
    var anniversaries  = _getMonthAnniversaries(allEmployees)

    var now = new Date()
    return {
      headcount: {
        total:       allEmployees.length,
        byDept:      byDept,
        bySeniority: seniority,
        teamCount:   allTeams.filter(function(t) { return t.status === 'activo' }).length
      },
      kpi: {
        activePeriods:  activePeriods.length,
        completionRate: kpiCompletion,
        pendingReviews: allReviews.filter(function(r) { return r.status === CONFIG.STATUS.IN_REVIEW }).length
      },
      vacation: {
        pendingApproval: pendingVac.length,
        approvedThisMonth: allRequests.filter(function(r) {
          return r.status === CONFIG.STATUS.APPROVED &&
                 r.reviewedAt && r.reviewedAt.startsWith(
                   now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
                 )
        }).length
      },
      birthdays:    monthBirthdays,
      anniversaries: anniversaries,
      generatedAt:  new Date().toISOString()
    }
  }
}

// ── Private helpers ───────────────────────────────────────────

async function _buildEmployeeCard(emp, user) {
  var role = emp.roleId   ? await DB.getById(CONFIG.SHEETS.ROLES, emp.roleId) : null
  var team = emp.teamId   ? await DB.getById(CONFIG.SHEETS.TEAMS, emp.teamId) : null
  var mgr  = emp.managerId ? await DB.getById(CONFIG.SHEETS.EMPLOYEES, emp.managerId) : null

  return {
    id:             emp.id,
    fullName:       (emp.firstName || '') + ' ' + (emp.lastName || ''),
    firstName:      emp.firstName,
    jobTitle:       emp.jobTitle,
    department:     emp.department,
    email:          emp.email,
    phone:          emp.phone,
    photoUrl:       emp.photoUrl,
    hireDate:       emp.hireDate,
    employeeNumber: emp.employeeNumber,
    roleName:       role ? role.name : '',
    teamName:       team ? team.name : '',
    managerName:    mgr  ? (mgr.firstName || '') + ' ' + (mgr.lastName || '') : '',
    managerEmail:   mgr  ? mgr.email : '',
    yearsOfService: emp.hireDate
      ? Math.floor((new Date() - new Date(emp.hireDate)) / (365.25 * 86400000))
      : 0
  }
}

function _buildAlerts(data) {
  var alerts = []

  if (data.pendingKPIs && data.pendingKPIs.length > 0) {
    alerts.push({
      type:    'warning',
      icon:    '📊',
      message: 'Tienes ' + data.pendingKPIs.length + ' autocalificación(es) pendiente(s) de KPI.',
      action:  'kpis'
    })
  }

  if (data.pendingReviews && data.pendingReviews.length > 0) {
    alerts.push({
      type:    'info',
      icon:    '✏️',
      message: 'Tienes ' + data.pendingReviews.length + ' evaluación(es) de KPI por revisar.',
      action:  'kpis'
    })
  }

  if (data.pendingVacReq && data.pendingVacReq.length > 0) {
    alerts.push({
      type:    'info',
      icon:    '🏖️',
      message: 'Tienes ' + data.pendingVacReq.length + ' solicitud(es) de vacaciones pendiente(s).',
      action:  'vacations'
    })
  }

  if (data.vacBalance && parseInt(data.vacBalance.daysRemaining) <= 3 && parseInt(data.vacBalance.daysRemaining) > 0) {
    alerts.push({
      type:    'warning',
      icon:    '⚠️',
      message: 'Te quedan solo ' + data.vacBalance.daysRemaining + ' días de vacaciones.',
      action:  'vacations'
    })
  }

  if (data.anniversaryInfo && data.anniversaryInfo.daysToAnniversary <= 7) {
    alerts.push({
      type:    'success',
      icon:    '🎉',
      message: '¡En ' + data.anniversaryInfo.daysToAnniversary + ' día(s) cumples ' + data.anniversaryInfo.yearsOfService + ' año(s) en la empresa!',
      action:  null
    })
  }

  return alerts
}

async function _buildTeamStats(members, teamId) {
  var empIds = members.map(function(m) { return m.id })
  var allEmployees = await Promise.all(empIds.map(function(id) {
    return DB.getById(CONFIG.SHEETS.EMPLOYEES, id)
  }))
  var validEmps = allEmployees.filter(Boolean)

  var avgYears = validEmps.length > 0
    ? Math.round(validEmps.reduce(function(s, e) {
        return s + (e.hireDate ? Math.floor((new Date() - new Date(e.hireDate)) / (365.25 * 86400000)) : 0)
      }, 0) / validEmps.length * 10) / 10
    : 0

  var deptCount = {}
  validEmps.forEach(function(e) {
    deptCount[e.department] = (deptCount[e.department] || 0) + 1
  })

  var today = new Date().toISOString().split('T')[0]
  var allRequests = await DB.getAll(CONFIG.SHEETS.VACATION_REQUESTS)
  var onVacation = allRequests.filter(function(r) {
    return empIds.indexOf(r.employeeId) > -1 &&
           r.status === CONFIG.STATUS.APPROVED &&
           r.startDate <= today && r.endDate >= today
  }).length

  return {
    headcount:     members.length,
    avgSeniority:  avgYears,
    byDepartment:  deptCount,
    onVacationNow: onVacation
  }
}

function _getMonthAnniversaries(employees) {
  var today = new Date()
  var month = today.getMonth()
  return employees
    .filter(function(e) {
      if (!e.hireDate) return false
      var hireMonth = new Date(e.hireDate).getMonth()
      return hireMonth === month
    })
    .map(function(e) {
      var hire  = new Date(e.hireDate)
      var years = today.getFullYear() - hire.getFullYear()
      return {
        id:       e.id,
        fullName: (e.firstName || '') + ' ' + (e.lastName || ''),
        photoUrl: e.photoUrl,
        hireDate: e.hireDate,
        years:    years,
        day:      hire.getDate()
      }
    })
    .sort(function(a, b) { return a.day - b.day })
}
