// ============================================================
// POST /api/action — Main API dispatcher
// Body: { action: string, data: object }
// ============================================================

import { requireLogin, CONFIG } from '../../lib/auth.js'
import { DB } from '../../lib/db.js'
import { EmployeeModule }     from '../../modules/employees.js'
import { KPIModule }          from '../../modules/kpis.js'
import { VacationsModule }    from '../../modules/vacations.js'
import { TeamsModule }        from '../../modules/teams.js'
import { BirthdaysModule }    from '../../modules/birthdays.js'
import { AnnouncementsModule } from '../../modules/announcements.js'
import { OrgChartModule }     from '../../modules/orgchart.js'
import { DashboardModule }    from '../../modules/dashboard.js'
import { RolesModule }        from '../../modules/roles.js'
import { PositionsModule }    from '../../modules/positions.js'
import { ConfigModule }       from '../../modules/config.js'
import { MailService }        from '../../lib/email.js'
import { buildEmail }        from '../../lib/email-template.js'
import { KPISchedulesModule } from '../../modules/kpi-schedules.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    var body   = req.body
    var action = body.action
    var data   = body.data || {}

    var user = await requireLogin(req, res)

    // Admin debug impersonation: if _impersonateAs is in data and caller is admin, swap user context
    var impersonateId = data._impersonateAs
    if (impersonateId) delete data._impersonateAs
    if (impersonateId && user.isAdmin) {
      var impUser = await _buildImpersonatedUser(impersonateId)
      if (impUser) user = impUser
    }

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
    'kpi.reports.overview':      function() { return KPIModule.getReport(data, user) },
    'kpi.reports.byDepartment':  function() { return KPIModule.getReportByDepartment(data, user) },

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
    'vacations.workingDays':      function() { return VacationsModule.calculateWorkingDays(data.startDate, data.endDate, user.country || 'MX') },
    'vacations.isWorkingDay':     function() { return VacationsModule.isWorkingDay(data.date, user) },
    'vacations.calendarMonth':    function() { return VacationsModule.getCalendarMonth(data.year, data.month, user) },
    'vacations.upcomingAbsences': function() { return VacationsModule.getUpcomingAbsences(data.days, user) },
    'vacations.recalcBalances':   function() { return VacationsModule.recalculateAnnualBalances(user) },
    'vacations.allRequests':      function() { return VacationsModule.getAllRequests(data, user) },
    'vacations.allBalances':      function() { return VacationsModule.getAllBalances(user) },
    'vacations.adjustBalance':    function() { return VacationsModule.adjustBalance(data, user) },

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

    // ── ADMIN DEBUG ────────────────────────────────────────────
    'admin.viewAsUser': async function() {
      if (!user.isAdmin) throw new Error('Solo admin puede usar esta función.')
      return _buildImpersonatedUser(data.employeeId)
    },

    // ── EMAIL ──────────────────────────────────────────────────
    'email.getEnabled': function() { return ConfigModule.get('emailEnabled', user) },
    'email.setEnabled': function() { return ConfigModule.set('emailEnabled', String(data.enabled), user) },
    'email.test':       async function() {
      if (!user.email) throw new Error('No tienes email registrado en tu perfil.')
      var enabled = await ConfigModule.get('emailEnabled', user)
      if (enabled === 'false') throw new Error('Los correos están desactivados. Actívalos primero desde Configuración.')
      var sent = await MailService.send({
        to:      user.email,
        subject: 'Test de correo — IKAN HR',
        htmlBody: buildEmail({
          icon:  '✅',
          title: 'Correo de prueba',
          bodyHTML:
            '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Hola <strong style="color:#1E293B">' + (user.firstName || user.email) + '</strong>,</p>' +
            '<p style="margin:0;color:#475569;font-size:15px;line-height:1.6">Este es un correo de prueba enviado desde el panel de administración. Si lo estás leyendo, el sistema de notificaciones está funcionando correctamente.</p>',
          details: [
            { label: 'Enviado a',  value: user.email },
            { label: 'Estado',     value: '✅ Entregado', highlight: '#16A34A' }
          ]
        })
      })
      return { ok: true, sentTo: user.email, messageId: sent && sent.id }
    },
    'email.testScenario':  async function() {
      if (!user.isAdmin && !user.isHR) throw new Error('Solo admin o HR puede usar esta función.')
      return _sendTestScenario(data.scenario, user)
    },

    // ── ROLES ──────────────────────────────────────────────────
    'roles.list':        function() { return RolesModule.list(user) },
    'roles.create':      function() { return RolesModule.create(data, user) },
    'roles.update':      function() { return RolesModule.update(data.id, data, user) },
    'roles.remove':      function() { return RolesModule.remove(data.id, user) },
    'positions.list':    function() { return PositionsModule.list(user) },
    'positions.create':  function() { return PositionsModule.create(data, user) },
    'positions.update':  function() { return PositionsModule.update(data.id, data, user) },
    'positions.remove':  function() { return PositionsModule.remove(data.id, user) },

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

async function _sendTestScenario(scenario, user) {
  if (!user.email) throw new Error('No tienes email registrado en tu perfil.')
  var name   = (user.firstName || 'Empleado') + ' ' + (user.lastName || 'Test')
  var today  = new Date().toISOString().split('T')[0]
  var nextWk = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
  var fn     = user.firstName || 'Usuario'

  var scenarios = {
    'vacation_request_manager': {
      subject:  '[IKAN HR] Solicitud de vacaciones — ' + name,
      htmlBody: buildEmail({
        icon: '📋', title: 'Solicitud de vacaciones pendiente',
        bodyHTML: '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Hola <strong style="color:#1E293B">' + fn + '</strong>,</p>' +
                  '<p style="margin:0;color:#475569;font-size:15px;line-height:1.6">Tu colaborador <strong style="color:#1E293B">' + name + '</strong> ha enviado una solicitud de vacaciones que requiere tu aprobación.</p>',
        details: [{ label:'Empleado', value: name }, { label:'Fecha inicio', value: today }, { label:'Fecha fin', value: nextWk }, { label:'Días hábiles', value:'5' }]
      })
    },
    'vacation_request_hr': {
      subject:  '[IKAN HR] Nueva solicitud de vacaciones — ' + name,
      htmlBody: buildEmail({
        icon: '🏖️', title: 'Nueva solicitud de vacaciones',
        bodyHTML: '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Hola <strong style="color:#1E293B">' + fn + '</strong>,</p>' +
                  '<p style="margin:0;color:#475569;font-size:15px;line-height:1.6"><strong style="color:#1E293B">' + name + '</strong> <span style="color:#94A3B8">· Departamento Ejemplo</span> ha solicitado vacaciones y está pendiente de aprobación.</p>',
        details: [{ label:'Empleado', value: name }, { label:'Fecha inicio', value: today }, { label:'Fecha fin', value: nextWk }, { label:'Días hábiles', value:'5' }]
      })
    },
    'vacation_approved': {
      subject:  '[IKAN HR] Tu solicitud de vacaciones fue aprobada ✅',
      htmlBody: buildEmail({
        icon: '✅', title: '¡Tu solicitud fue aprobada!',
        bodyHTML: '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Hola <strong style="color:#1E293B">' + fn + '</strong>,</p>' +
                  '<p style="margin:0;color:#475569;font-size:15px;line-height:1.6">Tu solicitud de vacaciones ha sido <strong style="color:#16A34A">aprobada</strong>. ¡Disfruta tu tiempo libre!</p>',
        details: [{ label:'Fecha inicio', value: today }, { label:'Fecha fin', value: nextWk }, { label:'Días hábiles', value:'5' }, { label:'Estado', value:'✅ Aprobada', highlight:'#16A34A' }]
      })
    },
    'vacation_rejected': {
      subject:  '[IKAN HR] Tu solicitud de vacaciones fue rechazada',
      htmlBody: buildEmail({
        icon: '❌', title: 'Tu solicitud fue rechazada',
        bodyHTML: '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Hola <strong style="color:#1E293B">' + fn + '</strong>,</p>' +
                  '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Tu solicitud de vacaciones <strong style="color:#DC2626">no fue aprobada</strong> en esta ocasión.</p>' +
                  '<div style="background:#FEF2F2;border-left:4px solid #DC2626;padding:12px 16px;border-radius:0 6px 6px 0"><span style="color:#991B1B;font-size:13px"><strong>Comentario:</strong> No hay cobertura suficiente en el equipo durante esas fechas.</span></div>',
        details: [{ label:'Fecha inicio', value: today }, { label:'Fecha fin', value: nextWk }, { label:'Días hábiles', value:'5' }, { label:'Estado', value:'❌ Rechazada', highlight:'#DC2626' }]
      })
    },
    'kpi_self_submit': {
      subject:  '[IKAN HR] Autocalificación lista para revisar — ' + name,
      htmlBody: buildEmail({
        icon: '📊', title: 'Autocalificación lista para revisar',
        bodyHTML: '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Hola <strong style="color:#1E293B">' + fn + '</strong>,</p>' +
                  '<p style="margin:0;color:#475569;font-size:15px;line-height:1.6"><strong style="color:#1E293B">' + name + '</strong> ha completado su autocalificación. Ingresa a la plataforma para revisarla y aprobarla.</p>',
        details: [{ label:'Empleado', value: name }, { label:'Período', value:'Q3 2025 (prueba)' }]
      })
    },
    'kpi_review_complete': {
      subject:  '[IKAN HR] Tu evaluación de KPIs fue aprobada — Q3 2025 (prueba)',
      htmlBody: buildEmail({
        icon: '🎯', title: 'Tu evaluación de KPIs fue aprobada',
        bodyHTML: '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Hola <strong style="color:#1E293B">' + fn + '</strong>,</p>' +
                  '<p style="margin:0;color:#475569;font-size:15px;line-height:1.6">Tu manager ha revisado y <strong style="color:#16A34A">aprobado</strong> tu evaluación de KPIs. Puedes ver tus resultados en tu dashboard.</p>',
        details: [{ label:'Período', value:'Q3 2025 (prueba)' }, { label:'Estado', value:'✅ Aprobada', highlight:'#16A34A' }]
      })
    },
    'kpi_period_open': {
      subject:  '[IKAN HR] Nuevo período de evaluación: Q3 2025 (prueba)',
      htmlBody: buildEmail({
        icon: '📅', title: 'Nuevo período de evaluación disponible',
        bodyHTML: '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Hola <strong style="color:#1E293B">' + fn + '</strong>,</p>' +
                  '<p style="margin:0;color:#475569;font-size:15px;line-height:1.6">Se ha abierto un nuevo período de evaluación de KPIs. Ingresa a la plataforma para completar tu autocalificación antes de la fecha límite.</p>',
        details: [{ label:'Período', value:'Q3 2025 (prueba)' }, { label:'Fecha límite', value: nextWk }]
      })
    },
    'birthday_greeting': {
      subject:  '🎂 ¡Feliz cumpleaños, ' + fn + '!',
      htmlBody: buildEmail({
        icon: '🎂', title: '¡Feliz cumpleaños, ' + fn + '!',
        bodyHTML: '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Hola <strong style="color:#1E293B">' + fn + '</strong>,</p>' +
                  '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Todo el equipo de IKAN te desea un día increíble lleno de alegría y muchos motivos para celebrar. 🎉</p>' +
                  '<p style="margin:0;color:#475569;font-size:15px;line-height:1.6">¡Gracias por ser parte de nuestro equipo!</p>'
      })
    },
    'birthday_notification': {
      subject:  '🎉 Hoy es el cumpleaños de ' + name,
      htmlBody: buildEmail({
        icon: '🎉', title: '¡Cumpleaños en el equipo!',
        bodyHTML: '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Hola <strong style="color:#1E293B">' + fn + '</strong>,</p>' +
                  '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Hoy es el cumpleaños de <strong style="color:#1E293B">' + name + '</strong>. ¡Únete a felicitarle!</p>'
      })
    },
    'announcement': {
      subject:  '📢 Comunicado: Recordatorio de políticas de la empresa (prueba)',
      htmlBody: buildEmail({
        icon: '📢', title: 'Recordatorio de políticas de la empresa',
        bodyHTML:
          '<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6">Hola <strong style="color:#1E293B">' + fn + '</strong>,</p>' +
          '<div style="color:#334155;font-size:15px;line-height:1.7;border-top:1px solid #E2E8F0;padding-top:16px">' +
          '<p>Este es un ejemplo de comunicado enviado a todos los empleados. Aquí iría el contenido del comunicado, que puede incluir <strong>texto en negritas</strong>, listas, y cualquier información relevante para el equipo.</p>' +
          '<p>Recuerda revisar el portal de IKAN HR para más detalles.</p>' +
          '</div>',
        details: [
          { label: 'Publicado por', value: name },
          { label: 'Fecha', value: new Date().toLocaleDateString('es-MX', { day:'numeric', month:'long', year:'numeric' }) }
        ]
      })
    }
  }

  if (!scenarios[scenario]) throw new Error('Escenario no reconocido: ' + scenario)
  var s    = scenarios[scenario]
  var sent = await MailService.send({ to: user.email, subject: s.subject, htmlBody: s.htmlBody })
  return { ok: true, sentTo: user.email, scenario: scenario, messageId: sent && sent.id }
}

async function _buildImpersonatedUser(empId) {
  if (!empId) return null
  var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, empId)
  if (!emp) return null
  var role = emp.roleId ? await DB.getById(CONFIG.SHEETS.ROLES, emp.roleId) : null
  var perms = []
  if (role && role.permissions) {
    try {
      perms = typeof role.permissions === 'string' ? JSON.parse(role.permissions) : (role.permissions || [])
    } catch (e) {}
  }
  var ledTeams   = await DB.getBy(CONFIG.SHEETS.TEAMS, 'leaderId', emp.id)
  var coledTeams = await DB.getBy(CONFIG.SHEETS.TEAMS, 'coLeaderId', emp.id)
  return {
    id:                  emp.id,
    email:               emp.email,
    firstName:           emp.firstName,
    lastName:            emp.lastName,
    fullName:            (emp.firstName || '') + ' ' + (emp.lastName || ''),
    roleId:              emp.roleId,
    roleName:            role ? role.name : '',
    teamId:              emp.teamId,
    managerId:           emp.managerId,
    department:          emp.department,
    permissions:         perms,
    isAdmin:             perms.indexOf('admin') > -1,
    isHR:                perms.indexOf('hr') > -1,
    isManager:           perms.indexOf('manager') > -1 || ledTeams.length > 0 || coledTeams.length > 0,
    ledTeams:            ledTeams.map(function(t) { return t.id }),
    coledTeams:          coledTeams.map(function(t) { return t.id }),
    canApproveVacations: emp.canApproveVacations === undefined || emp.canApproveVacations === ''
      ? true : String(emp.canApproveVacations) === 'true',
    country:             emp.country || 'MX',
    _isImpersonated:     true
  }
}
