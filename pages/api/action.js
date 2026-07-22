// ============================================================
// POST /api/action — Main API dispatcher
// Body: { action: string, data: object }
// ============================================================

import { requireLogin } from '../../lib/auth.js'
import { EmployeeModule }     from '../../modules/employees.js'
import { KPIModule }          from '../../modules/kpis.js'
import { VacationsModule }    from '../../modules/vacations.js'
import { TeamsModule }        from '../../modules/teams.js'
import { BirthdaysModule }    from '../../modules/birthdays.js'
import { AnnouncementsModule } from '../../modules/announcements.js'
import { OrgChartModule }     from '../../modules/orgchart.js'
import { DashboardModule }    from '../../modules/dashboard.js'
import { RolesModule }        from '../../modules/roles.js'
import { ConfigModule }       from '../../modules/config.js'
import { KPISchedulesModule } from '../../modules/kpi-schedules.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    var body   = req.body
    var action = body.action
    var data   = body.data || {}

    var user = await requireLogin(req, res)
    var result = await dispatch(action, data, user)
    return res.json({ ok: true, data: result })
  } catch (e) {
    console.error('API error [' + (req.body && req.body.action) + ']:', e.message)
    return res.json({ ok: false, error: e.message || 'Error en la solicitud' })
  }
}

async function dispatch(action, data, user) {
  var routes = {
    // ── EMPLOYEES ──────────────────────────────────────────────
    'employees.list':          function() { return EmployeeModule.list(data, user) },
    'employees.get':           function() { return EmployeeModule.get(data.id, user) },
    'employees.create':        function() { return EmployeeModule.create(data, user) },
    'employees.update':        function() { return EmployeeModule.update(data.id, data, user) },
    'employees.deactivate':    function() { return EmployeeModule.deactivate(data.id, user) },
    'employees.directory':     function() { return EmployeeModule.getDirectory(user) },
    'employees.directReports': function() { return EmployeeModule.getDirectReports(data.managerId, user) },
    'employees.anniversary':   function() { return EmployeeModule.getAnniversaryInfo(data.employeeId, user) },

    // ── ORGCHART ───────────────────────────────────────────────
    'orgchart.get':        function() { return OrgChartModule.get(user) },
    'orgchart.flat':       function() { return OrgChartModule.getFlat(user) },
    'orgchart.update':     function() { return OrgChartModule.updateRelation(data, user) },
    'orgchart.chain':      function() { return OrgChartModule.getChainOfCommand(data.employeeId, user) },
    'orgchart.allReports': function() { return OrgChartModule.getAllReports(data.managerId, user) },

    // ── TEAMS ──────────────────────────────────────────────────
    'teams.list':           function() { return TeamsModule.list(user) },
    'teams.get':            function() { return TeamsModule.get(data.id, user) },
    'teams.create':         function() { return TeamsModule.create(data, user) },
    'teams.update':         function() { return TeamsModule.update(data.id, data, user) },
    'teams.members':        function() { return TeamsModule.getMembers(data.teamId, user) },
    'teams.addMember':      function() { return TeamsModule.addMember(data.teamId, data.employeeId, user) },
    'teams.removeMember':   function() { return TeamsModule.removeMember(data.teamId, data.employeeId, user) },
    'teams.assignCoLeader': function() { return TeamsModule.assignCoLeader(data.teamId, data.employeeId, user) },
    'teams.myTeams':        function() { return TeamsModule.getMyTeams(user) },

    // ── KPI DEFINITIONS ────────────────────────────────────────
    'kpi.definitions.list':   function() { return KPIModule.listDefinitions(data, user) },
    'kpi.definitions.create': function() { return KPIModule.createDefinition(data, user) },
    'kpi.definitions.update': function() { return KPIModule.updateDefinition(data.id, data, user) },
    'kpi.definitions.delete': function() { return KPIModule.deleteDefinition(data.id, user) },

    // ── KPI PERIODS ────────────────────────────────────────────
    'kpi.periods.list':   function() { return KPIModule.listPeriods(data, user) },
    'kpi.periods.create': function() { return KPIModule.createPeriod(data, user) },
    'kpi.periods.open':   function() { return KPIModule.openPeriod(data.periodId, user) },
    'kpi.periods.close':  function() { return KPIModule.closePeriod(data.periodId, user) },
    'kpi.periods.extend': function() { return KPIModule.extendPeriod(data.periodId, data, user) },

    // ── KPI REVIEWS ────────────────────────────────────────────
    'kpi.reviews.selfSubmit':     function() { return KPIModule.selfAssessmentSubmit(data, user) },
    'kpi.reviews.selfDraft':      function() { return KPIModule.saveSelfDraft(data, user) },
    'kpi.reviews.managerReview':  function() { return KPIModule.managerReview(data, user) },
    'kpi.reviews.list':           function() { return KPIModule.listReviews(data, user) },
    'kpi.reviews.pendingSelf':    function() { return KPIModule.myPendingSelfAssessments(user) },
    'kpi.reviews.pendingManager': function() { return KPIModule.myPendingManagerReviews(user) },

    // ── KPI DASHBOARDS ─────────────────────────────────────────
    'kpi.dashboard':        function() { return KPIModule.getDashboard(data.employeeId, user) },
    'kpi.teamDashboard':    function() { return KPIModule.getTeamDashboard(data.teamId, user) },
    'kpi.reports.overview': function() { return KPIModule.getReport(data, user) },

    // ── VACATIONS ──────────────────────────────────────────────
    'vacations.request':          function() { return VacationsModule.createRequest(data, user) },
    'vacations.approve':          function() { return VacationsModule.approve(data.id, data.notes, user) },
    'vacations.reject':           function() { return VacationsModule.reject(data.id, data.notes, user) },
    'vacations.cancel':           function() { return VacationsModule.cancelRequest(data.id, user) },
    'vacations.myRequests':       function() { return VacationsModule.myRequests(data.employeeId, user) },
    'vacations.teamRequests':     function() { return VacationsModule.teamRequests(data, user) },
    'vacations.balance':          function() { return VacationsModule.getBalance(data.employeeId, user) },
    'vacations.holidays':         function() { return VacationsModule.getHolidays(data.year, user) },
    'vacations.addHoliday':       function() { return VacationsModule.addHoliday(data, user) },
    'vacations.removeHoliday':    function() { return VacationsModule.removeHoliday(data.id, user) },
    'vacations.workingDays':      function() { return VacationsModule.calculateWorkingDays(data.startDate, data.endDate) },
    'vacations.isWorkingDay':     function() { return VacationsModule.isWorkingDay(data.date, user) },
    'vacations.calendarMonth':    function() { return VacationsModule.getCalendarMonth(data.year, data.month, user) },
    'vacations.upcomingAbsences': function() { return VacationsModule.getUpcomingAbsences(data.days, user) },
    'vacations.recalcBalances':   function() { return VacationsModule.recalculateAnnualBalances(user) },

    // ── BIRTHDAYS ──────────────────────────────────────────────
    'birthdays.upcoming': function() { return BirthdaysModule.getUpcoming(data.days || 30, user) },
    'birthdays.month':    function() { return BirthdaysModule.getByMonth(data.month, user) },
    'birthdays.today':    function() { return BirthdaysModule.getToday(user) },
    'birthdays.annual':   function() { return BirthdaysModule.getAnnualCalendar(user) },
    'birthdays.greet':    function() { return BirthdaysModule.sendBirthdayGreeting(data.employeeId, user) },

    // ── ANNOUNCEMENTS ──────────────────────────────────────────
    'announcements.list':   function() { return AnnouncementsModule.list(data, user) },
    'announcements.create': function() { return AnnouncementsModule.create(data, user) },
    'announcements.update': function() { return AnnouncementsModule.update(data.id, data, user) },
    'announcements.remove': function() { return AnnouncementsModule.remove(data.id, user) },

    // ── DASHBOARD ──────────────────────────────────────────────
    'dashboard.company': function() { return DashboardModule.getCompanyData(user) },
    'dashboard.myData':  function() { return DashboardModule.getMyData(user) },
    'dashboard.team':    function() { return DashboardModule.getTeamData(data.teamId, user) },

    // ── CONFIG ─────────────────────────────────────────────────
    'config.get':    function() { return ConfigModule.get(data.key, user) },
    'config.set':    function() { return ConfigModule.set(data.key, data.value, user) },
    'config.getAll': function() { return ConfigModule.getAll(user) },

    // ── ROLES ──────────────────────────────────────────────────
    'roles.list':   function() { return RolesModule.list(user) },
    'roles.create': function() { return RolesModule.create(data, user) },
    'roles.update': function() { return RolesModule.update(data.id, data, user) },
    'roles.remove': function() { return RolesModule.remove(data.id, user) },

    // ── KPI SCHEDULES ──────────────────────────────────────────
    'kpi.schedules.list':   function() { return KPISchedulesModule.list(user) },
    'kpi.schedules.create': function() { return KPISchedulesModule.create(data, user) },
    'kpi.schedules.update': function() { return KPISchedulesModule.update(data.id, data, user) },
    'kpi.schedules.remove': function() { return KPISchedulesModule.remove(data.id, user) },
    'kpi.schedules.runNow': function() { return KPISchedulesModule.runNow(data.id, user) }
  }

  if (!routes[action]) throw new Error('Acción no reconocida: ' + action)
  return routes[action]()
}
