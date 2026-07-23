// ============================================================
// scripts.js — Frontend SPA logic (ported from GAS scripts.html)
// Auth: Supabase browser SDK (PKCE) + Bearer token on API calls
// ============================================================

// Browser Supabase client — initialized in APP.init()
var _sb = null;

// ── CLIENT CACHE ─────────────────────────────────────────────
var ClientCache = (function() {
  var _store = {};
  var TTL = {
    'employees.directory':    120000,
    'employees.list':         120000,
    'teams.list':             180000,
    'teams.myTeams':          120000,
    'kpi.definitions.list':   300000,
    'kpi.periods.list':       120000,
    'kpi.schedules.list':     300000,
    'birthdays.upcoming':    1800000,
    'birthdays.annual':      1800000,
    'birthdays.month':        180000,
    'vacations.holidays':    1800000,
    'announcements.list':     120000,
    'orgchart.flat':          180000,
    'orgchart.get':           180000,
    'dashboard.company':      120000,
  };
  var INVALIDATE = {
    'employees.create':        ['employees.directory','employees.list','orgchart.flat','orgchart.get','birthdays.upcoming','birthdays.annual'],
    'employees.update':        ['employees.directory','employees.list','orgchart.flat','orgchart.get','birthdays.upcoming','birthdays.annual'],
    'employees.deactivate':    ['employees.directory','employees.list','orgchart.flat','orgchart.get'],
    'teams.create':            ['teams.list','teams.myTeams'],
    'teams.update':            ['teams.list','teams.myTeams'],
    'teams.addMember':         ['teams.list','teams.myTeams','employees.directory'],
    'teams.removeMember':      ['teams.list','teams.myTeams','employees.directory'],
    'teams.assignCoLeader':    ['teams.list','teams.myTeams'],
    'kpi.definitions.create':  ['kpi.definitions.list'],
    'kpi.definitions.update':  ['kpi.definitions.list'],
    'kpi.definitions.delete':  ['kpi.definitions.list'],
    'kpi.periods.create':      ['kpi.periods.list'],
    'kpi.periods.open':        ['kpi.periods.list'],
    'kpi.periods.close':       ['kpi.periods.list'],
    'kpi.periods.extend':      ['kpi.periods.list'],
    'kpi.schedules.create':    ['kpi.schedules.list'],
    'kpi.schedules.update':    ['kpi.schedules.list'],
    'kpi.schedules.remove':    ['kpi.schedules.list'],
    'kpi.schedules.runNow':    ['kpi.periods.list','kpi.schedules.list'],
    'announcements.create':    ['announcements.list'],
    'announcements.update':    ['announcements.list'],
    'announcements.remove':    ['announcements.list'],
    'orgchart.update':         ['orgchart.flat','orgchart.get'],
    'vacations.addHoliday':    ['vacations.holidays'],
    'vacations.removeHoliday': ['vacations.holidays'],
    'kpi.reviews.selfSubmit':  ['kpi.reports.overview'],
    'kpi.reviews.managerReview':['kpi.reports.overview'],
  };
  function _key(action, data) {
    var d = data && Object.keys(data).length ? JSON.stringify(data) : '';
    return action + d;
  }
  return {
    get: function(action, data) {
      if (!TTL[action]) return null;
      var entry = _store[_key(action, data)];
      if (!entry) return null;
      if (Date.now() > entry.exp) { delete _store[_key(action, data)]; return null; }
      return entry.data;
    },
    set: function(action, data, result) {
      if (!TTL[action]) return;
      _store[_key(action, data)] = { data: result, exp: Date.now() + TTL[action] };
    },
    invalidate: function(action) {
      var targets = INVALIDATE[action] || [];
      targets.forEach(function(a) {
        Object.keys(_store).forEach(function(k) {
          if (k === a || k.indexOf(a + '{') === 0 || k.indexOf(a + '[') === 0) delete _store[k];
        });
        delete _store[a];
      });
    },
    warm: function(preload) {
      if (preload.employees)      { this.set('employees.directory', {}, preload.employees); this.set('employees.list', {}, preload.employees); }
      if (preload.teams)           this.set('teams.list', {}, preload.teams);
      if (preload.kpiDefinitions)  this.set('kpi.definitions.list', {}, preload.kpiDefinitions);
      if (preload.announcements)   this.set('announcements.list', {}, preload.announcements);
      if (preload.birthdays)       this.set('birthdays.upcoming', { days: 30 }, preload.birthdays);
      if (preload.roles)          { this.set('roles.list', {}, preload.roles); AdminHR._cachedRoles = preload.roles; }
    }
  };
})();

// ── APP CORE ─────────────────────────────────────────────────
var APP = {
  user: null,
  data: null,

  api: function(action, data, cb) {
    data = data || {};
    var cached = ClientCache.get(action, data);
    if (cached !== null) { setTimeout(function() { cb(null, cached); }, 0); return; }
    ClientCache.invalidate(action);
    var doFetch = function(token) {
      fetch('/api/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? 'Bearer ' + token : ''
        },
        body: JSON.stringify({ action: action, data: data })
      })
      .then(function(res) { return res.json(); })
      .then(function(r) {
        if (r && r.ok) { ClientCache.set(action, data, r.data); cb(null, r.data); }
        else { cb((r && r.error) ? r.error : ('Fallo en ' + action), null); }
      })
      .catch(function(e) { cb(e.message || String(e), null); });
    };
    if (_sb) {
      _sb.auth.getSession().then(function(res) {
        doFetch(res.data.session ? res.data.session.access_token : null);
      });
    } else { doFetch(null); }
  },

  _loadUser: function(token) {
    fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(res) { return res.json(); })
      .then(function(r) {
        APP.hideLoader();
        if (!r || !r.ok) {
          if (r && r.notRegistered) APP.renderAccessDenied();
          else APP.renderLoginScreen();
          return;
        }
        APP.user = r.user;
        APP.data = null;
        APP.renderHeader();
        APP.renderSidebar();
        CODES.start();
        APP.navigate('dashboard');
      })
      .catch(function() { APP.hideLoader(); APP.renderLoginScreen(); });
  },

  init: function() {
    _sb = window.supabase.createClient(window.__SB_URL__, window.__SB_KEY__);
    APP.showLoader('Verificando sesión...');
    _sb.auth.onAuthStateChange(function(event, session) {
      if (event !== 'INITIAL_SESSION') return;
      if (!session) { APP.hideLoader(); APP.renderLoginScreen(); return; }
      APP._loadUser(session.access_token);
    });
  },

  navigate: function(view) {
    APP.currentView = view;
    document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active'); });
    document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
    var el = document.getElementById('view-' + view);
    if (el) el.classList.add('active');
    var nav = document.querySelector('[data-view="' + view + '"]');
    if (nav) nav.classList.add('active');
    document.getElementById('header-title').textContent = APP.viewTitles[view] || 'HR Platform';
    APP.loadView(view);
  },

  viewTitles: {
    dashboard: 'Mi Dashboard', employees: 'Directorio', orgchart: 'Organigrama',
    kpis: 'KPIs & Evaluaciones', vacations: 'Vacaciones', birthdays: 'Cumpleaños',
    team: 'Mi Equipo', settings: 'Configuración'
  },

  loadView: function(view) {
    var fns = {
      dashboard:  DashboardView.load,
      employees:  EmployeesView.load,
      orgchart:   OrgChartView.load,
      kpis:       KPIsView.load,
      vacations:  VacationsView.load,
      birthdays:  BirthdaysView.load,
      team:       TeamView.load,
    };
    if (fns[view]) fns[view]();
  },

  renderHeader: function() {
    var alerts = APP.data && APP.data.alerts ? APP.data.alerts.length : 0;
    var dot = document.getElementById('notif-dot');
    if (dot) dot.style.display = alerts > 0 ? 'block' : 'none';
  },

  renderSidebar: function() {
    var u = APP.user;
    if (!u) return;
    var nameEl = document.getElementById('sidebar-name');
    var roleEl = document.getElementById('sidebar-role');
    var initEl = document.getElementById('sidebar-initials');
    if (nameEl) nameEl.textContent = u.fullName || '—';
    if (roleEl) roleEl.textContent = u.roleName || '';
    if (initEl) {
      var fi = (u.firstName && u.firstName[0]) ? u.firstName[0] : (u.fullName ? u.fullName[0] : '?');
      var li = (u.lastName && u.lastName[0]) ? u.lastName[0] : '';
      initEl.textContent = (fi + li).toUpperCase();
    }
    if (u.isAdmin || u.isHR) {
      var sec = document.getElementById('admin-section');
      if (sec) sec.style.display = 'block';
    }
    if (u.isManager && u.canApproveVacations && !u.isAdmin && !u.isHR) {
      var approverSec = document.getElementById('approver-section');
      if (approverSec) approverSec.style.display = 'block';
    }
  },

  renderLoginScreen: function() {
    document.getElementById('app-loader').style.display = 'none';
    var existing = document.getElementById('login-screen');
    if (existing) { existing.style.display = 'flex'; return; }
    var el = document.createElement('div');
    el.id = 'login-screen';
    el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:var(--bg);z-index:9999;';
    el.innerHTML =
      '<div style="text-align:center;max-width:380px;padding:40px 32px;background:var(--card);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.12)">' +
        '<div style="width:56px;height:56px;background:var(--primary);border-radius:14px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">' +
          '<span style="color:#fff;font-weight:800;font-size:22px">IK</span>' +
        '</div>' +
        '<h1 style="font-size:26px;font-weight:700;margin:0 0 8px;color:var(--text)">IKAN HR</h1>' +
        '<p style="color:var(--text-muted);margin:0 0 32px;font-size:15px;line-height:1.5">Plataforma de Recursos Humanos.<br>Inicia sesión con tu cuenta corporativa.</p>' +
        '<button onclick="_sb.auth.signInWithOAuth({provider:\'google\',options:{redirectTo:window.location.origin}})" style="display:flex;align-items:center;justify-content:center;gap:10px;background:var(--primary);color:#fff;padding:13px 24px;border-radius:10px;border:none;cursor:pointer;font-weight:600;font-size:15px;width:100%;transition:background .15s" onmouseover="this.style.background=\'var(--primary-dark)\'" onmouseout="this.style.background=\'var(--primary)\'">' +
          '<svg width="20" height="20" viewBox="0 0 24 24"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>' +
          'Iniciar sesión con Google' +
        '</button>' +
      '</div>';
    document.body.appendChild(el);
  },

  renderAccessDenied: function() {
    var shell = document.getElementById('app-shell');
    if (shell) shell.style.display = 'none';
    var existing = document.getElementById('access-denied-screen');
    if (existing) { existing.style.display = 'flex'; return; }
    var el = document.createElement('div');
    el.id = 'access-denied-screen';
    el.innerHTML =
      '<div style="text-align:center;max-width:420px;padding:40px 32px;">' +
        '<span class="material-icons-round" style="font-size:64px;color:var(--text-muted);display:block;margin-bottom:16px">lock</span>' +
        '<h2 style="margin:0 0 12px;font-size:22px;color:var(--text)">Sin acceso</h2>' +
        '<p style="color:var(--text-muted);line-height:1.6;margin:0 0 24px">Tu cuenta de Google no está registrada en la plataforma. Contacta a Recursos Humanos para que te den de alta.</p>' +
        '<button class="btn btn-primary" onclick="_sb.auth.signOut().then(function(){window.location.reload()})">Cerrar sesión</button>' +
      '</div>';
    el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:var(--bg);z-index:9999;';
    document.body.appendChild(el);
  },

  toast: function(msg, type) {
    type = type || 'info';
    var icons = { success: 'check_circle', error: 'error', info: 'info', warning: 'warning' };
    var t = document.createElement('div');
    t.className = 'toast ' + (type === 'success' ? 'success' : type === 'error' ? 'error' : '');
    t.innerHTML = '<span class="material-icons-round" style="font-size:16px">' + (icons[type] || 'info') + '</span>' + msg;
    document.getElementById('toast-container').appendChild(t);
    setTimeout(function() { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(function() { t.remove(); }, 300); }, 3500);
  },

  showLoader: function(msg) {
    document.getElementById('app-loader').style.display = 'flex';
    document.getElementById('loader-msg').textContent = msg || 'Cargando...';
  },
  hideLoader: function() {
    document.getElementById('app-loader').style.display = 'none';
  },

  modal: function(title, bodyHtml, footer) {
    var existing = document.getElementById('app-modal');
    if (existing) existing.remove();
    var m = document.createElement('div');
    m.className = 'modal-overlay'; m.id = 'app-modal';
    m.innerHTML = '<div class="modal"><div class="modal-header"><h3>' + title + '</h3>' +
      '<button class="icon-btn" onclick="document.getElementById(\'app-modal\').remove()"><span class="material-icons-round">close</span></button></div>' +
      '<div class="modal-body">' + bodyHtml + '</div>' +
      (footer ? '<div class="modal-footer">' + footer + '</div>' : '') + '</div>';
    m.addEventListener('click', function(e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
  },

  closeModal: function() {
    var m = document.getElementById('app-modal');
    if (m) m.remove();
  },

  initials: function(name) { return (name || '').split(' ').slice(0,2).map(function(w){return w[0]||'';}).join('').toUpperCase(); },
  fmtDate: function(d) { if (!d) return '—'; var p = d.split('-'); return p[2]+'/'+p[1]+'/'+p[0]; },
  fmtScore: function(s) { var n = parseFloat(s); return isNaN(n) ? '—' : n.toFixed(1); },
  semLabel: function(s) {
    if (s === null || s === undefined || s === '') return '—';
    var n = parseFloat(s);
    if (isNaN(n)) return '—';
    if (n >= 75) return '🟢 Logrado';
    if (n >= 25) return '🟡 Parcialmente';
    return '🔴 No logrado';
  },
  scoreColor: function(s) { var n=parseFloat(s); if(isNaN(n)) return ''; if(n>=9) return 'green'; if(n>=7) return ''; if(n>=5) return 'orange'; return 'red'; },
  badgeStatus: function(s) {
    var map = { 'Aprobado':'success','Pendiente':'warning','Pendiente Manager':'info','Rechazado':'danger','Completado':'success','En Revisión':'info','Borrador':'gray','activo':'success','inactivo':'gray' };
    return '<span class="badge badge-'+(map[s]||'gray')+'">'+s+'</span>';
  }
};

// ── DASHBOARD VIEW ────────────────────────────────────────────
var DashboardView = {
  load: function() {
    var d = APP.data;
    if (!d) {
      APP.api('dashboard.myData', {}, function(err, data) {
        if (err) {
          document.getElementById('dash-pending-list').innerHTML = '<div class="empty-state"><span class="material-icons-round">error_outline</span><p>No se pudo cargar</p></div>';
          document.getElementById('dash-birthdays').innerHTML = '<div class="empty-state"><span class="material-icons-round">error_outline</span><p>No se pudo cargar</p></div>';
          document.getElementById('dash-announcements').innerHTML = '<div class="empty-state"><span class="material-icons-round">error_outline</span><p>No se pudo cargar</p></div>';
          APP.toast('Error al cargar el dashboard', 'error');
          return;
        }
        APP.data = data;
        DashboardView.render(data);
      });
      return;
    }
    DashboardView.render(d);
  },

  render: function(d) {
    var alertsHtml = (d.alerts || []).map(function(a) {
      return '<div class="alert ' + a.type + '" onclick="APP.navigate(\'' + (a.action||'dashboard') + '\')">' + a.icon + ' ' + a.message + '</div>';
    }).join('') || '<p class="text-muted text-sm">Sin alertas por el momento 🎉</p>';
    document.getElementById('dash-alerts').innerHTML = alertsHtml;

    var vac = d.vacation || {};
    var bal = vac.balance || {};
    document.getElementById('dash-vac-days').textContent = bal.daysRemaining || 0;
    document.getElementById('dash-kpi-score').textContent = d.kpi && d.kpi.avgScore ? d.kpi.avgScore : '—';
    document.getElementById('dash-pending-kpi').textContent = (d.pendingKPIs || []).length;
    document.getElementById('dash-pending-vac').textContent = vac.pendingRequests || 0;

    var bdays = (d.birthdays || []).slice(0, 5);
    document.getElementById('dash-birthdays').innerHTML = bdays.length
      ? '<div class="bday-list">' + bdays.map(DashboardView.bdayItem).join('') + '</div>'
      : '<div class="empty-state"><span class="material-icons-round">cake</span><p>Sin cumpleaños próximos</p></div>';

    var kpi = d.kpi || {};
    var trend = kpi.trend === 'up' ? '📈' : kpi.trend === 'down' ? '📉' : '➡️';
    document.getElementById('dash-kpi-label').textContent = (kpi.avgScoreLabel || '') + ' ' + trend;

    var ann = (d.announcements || []).slice(0, 4);
    document.getElementById('dash-announcements').innerHTML = ann.length
      ? ann.map(function(a) {
          return '<div style="padding:10px 0;border-bottom:1px solid var(--border)">' +
            (a.pinned ? '<span style="color:var(--warning)">📌 </span>' : '') +
            '<span class="font-600 text-sm">' + a.title + '</span>' +
            '<p class="text-xs text-muted mt-4">' + (a.body || '').substring(0, 100) + (a.body && a.body.length > 100 ? '...' : '') + '</p>' +
            '<p class="text-xs text-muted mt-4">' + APP.fmtDate((a.publishedAt || '').split('T')[0]) + ' · ' + a.authorName + '</p></div>';
        }).join('')
      : '<div class="empty-state"><span class="material-icons-round">campaign</span><p>Sin comunicados</p></div>';

    var pk = (d.pendingKPIs || []).slice(0, 3);
    document.getElementById('dash-pending-list').innerHTML = pk.length
      ? pk.map(function(p) {
          return '<div class="kpi-card pending mt-8"><div class="kpi-name">' + p.kpi.name + '</div>' +
            '<div class="kpi-meta"><span>📅 ' + p.period.name + '</span><span>⚖️ Peso: ' + p.kpi.weight + '%</span></div>' +
            '<button class="btn btn-primary btn-sm" onclick="APP.navigate(\'kpis\')">Autocalificarme</button></div>';
        }).join('')
      : '<div class="empty-state"><span class="material-icons-round">task_alt</span><p>¡Todo al día!</p></div>';
  },

  bdayItem: function(b) {
    return '<div class="bday-item' + (b.isToday ? ' today' : '') + '">' +
      '<div class="bday-avatar">' + APP.initials(b.fullName) + '</div>' +
      '<div><div class="bday-name">' + b.fullName + (b.isToday ? ' 🎂' : '') + '</div>' +
      '<div class="bday-info">' + b.department + '</div></div>' +
      '<div class="bday-days">' + (b.isToday ? '¡Hoy!' : b.daysUntil + ' días') + '</div></div>';
  }
};

// ── EMPLOYEES VIEW ────────────────────────────────────────────
var EmployeesView = {
  all: [],
  load: function() {
    if (EmployeesView.all.length) { EmployeesView.render(); return; }
    document.getElementById('view-employees').innerHTML = '<div class="loader"><div class="spinner"></div> Cargando directorio...</div>';
    APP.api('employees.directory', {}, function(err, data) {
      if (err) { APP.toast(err, 'error'); return; }
      EmployeesView.all = data || [];
      document.getElementById('view-employees').innerHTML = EmployeesView.skeleton();
      EmployeesView.render();
      var s = document.getElementById('emp-search');
      if (s) s.addEventListener('input', EmployeesView.filter);
    });
  },
  skeleton: function() {
    var isAdmin = APP.user && (APP.user.isAdmin || APP.user.isHR);
    return '<div class="view-title"><span class="material-icons-round">people</span>Directorio de Empleados' +
      '<span id="emp-count" class="badge badge-gray" style="margin-left:10px"></span>' +
      (isAdmin ? '<button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="AdminHR.openNewEmployee()"><span class="material-icons-round">person_add</span>Agregar Empleado</button>' : '') +
      '</div>' +
      '<div class="card mb-20"><div class="flex gap-8 items-center">' +
      '<div class="header-search" style="width:100%;max-width:340px"><span class="material-icons-round">search</span><input id="emp-search" placeholder="Buscar por nombre, email..."></div>' +
      '<select id="emp-dept-filter" onchange="EmployeesView.filter()" style="width:200px"><option value="">Todos los departamentos</option></select>' +
      '</div></div><div id="emp-grid" class="emp-grid"></div>';
  },
  render: function() {
    var depts = [].concat(EmployeesView.all.map(function(e){return e.department;})).filter(function(d,i,a){return d && a.indexOf(d)===i;}).sort();
    var sel = document.getElementById('emp-dept-filter');
    if (sel && sel.options.length === 1) {
      depts.forEach(function(d) { var o = document.createElement('option'); o.value = d; o.textContent = d; sel.appendChild(o); });
    }
    EmployeesView.filter();
  },
  filter: function() {
    var q = (document.getElementById('emp-search') || {value:''}).value.toLowerCase();
    var dept = (document.getElementById('emp-dept-filter') || {value:''}).value;
    var filtered = EmployeesView.all.filter(function(e) {
      var match = !q || (e.fullName||'').toLowerCase().indexOf(q) > -1 || (e.email||'').toLowerCase().indexOf(q) > -1;
      var deptMatch = !dept || e.department === dept;
      return match && deptMatch;
    });
    var count = document.getElementById('emp-count');
    if (count) count.textContent = filtered.length + ' empleados';
    var grid = document.getElementById('emp-grid');
    if (!grid) return;
    grid.innerHTML = filtered.length ? filtered.map(EmployeesView.card).join('') : '<div class="empty-state"><span class="material-icons-round">search_off</span><p>Sin resultados</p></div>';
  },
  card: function(e) {
    var initials = APP.initials(e.fullName);
    return '<div class="emp-card" onclick="EmployeesView.showDetail(\'' + e.id + '\')">' +
      '<div class="emp-avatar">' + (e.photoUrl ? '<img src="' + e.photoUrl + '" onerror="this.parentElement.textContent=\'' + initials + '\'"/>' : initials) + '</div>' +
      '<div class="emp-name">' + e.fullName + '</div>' +
      '<div class="emp-title">' + (e.jobTitle || '—') + '</div>' +
      '<span class="badge badge-info">' + (e.department || '—') + '</span>' +
      (e.email ? '<p class="text-xs text-muted mt-8">' + e.email + '</p>' : '') + '</div>';
  },
  showDetail: function(id) {
    APP.api('employees.get', { id: id }, function(err, emp) {
      if (err) { APP.toast(err, 'error'); return; }
      var isAdmin = APP.user && (APP.user.isAdmin || APP.user.isHR || APP.user.isManager);
      APP.modal('👤 ' + emp.fullName,
        '<div class="flex gap-12 items-center mb-16">' +
        '<div class="emp-avatar" style="width:72px;height:72px;font-size:26px;flex-shrink:0">' + APP.initials(emp.fullName) + '</div>' +
        '<div><div class="font-600" style="font-size:16px">' + emp.fullName + '</div>' +
        '<div class="text-muted text-sm">' + (emp.jobTitle||'') + ' · ' + (emp.department||'') + '</div>' +
        '<div class="mt-4">' + APP.badgeStatus(emp.status||'activo') + '</div></div></div>' +
        '<div class="grid grid-2 gap-8">' +
        EmployeesView.field('Departamento', emp.department) +
        EmployeesView.field('Email', emp.email) +
        EmployeesView.field('Teléfono', emp.phone) +
        EmployeesView.field('Equipo', emp.teamName) +
        EmployeesView.field('Manager', emp.managerName) +
        EmployeesView.field('Antigüedad', (emp.yearsOfService||0) + ' año(s)') +
        EmployeesView.field('Fecha ingreso', APP.fmtDate(emp.hireDate)) +
        (isAdmin ? EmployeesView.field('Vacaciones/año', emp.vacationDaysPerYear + ' días') : '') +
        '</div>',
        isAdmin
          ? '<button class="btn btn-outline" onclick="APP.closeModal()">Cerrar</button>' +
            '<button class="btn btn-primary" onclick="AdminHR.openEditEmployee(\'' + emp.id + '\')"><span class="material-icons-round">edit</span>Editar</button>' +
            (emp.status === 'activo' ? '<button class="btn btn-danger btn-sm" onclick="AdminHR.deactivateEmployee(\'' + emp.id + '\',\'' + emp.fullName + '\')"><span class="material-icons-round">person_off</span>Dar de baja</button>' : '')
          : '<button class="btn btn-outline" onclick="APP.closeModal()">Cerrar</button>'
      );
    });
  },
  field: function(label, value) {
    return '<div><div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:.04em">' + label + '</div>' +
           '<div class="font-600 text-sm mt-4">' + (value || '—') + '</div></div>';
  }
};

// ── ORG CHART VIEW ────────────────────────────────────────────
var OrgChartView = {
  zoom: 1,
  load: function() {
    var el = document.getElementById('org-tree');
    if (el && el.dataset.loaded) return;
    OrgChartView.zoom = 1;
    document.getElementById('view-orgchart').innerHTML =
      '<div class="view-title"><span class="material-icons-round">account_tree</span>Organigrama</div>' +
      '<div class="card" style="padding:0;overflow:hidden">' +
        '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap">' +
          '<button class="btn btn-outline btn-sm" onclick="OrgChartView.zoomOut()"><span class="material-icons-round" style="font-size:16px">remove</span></button>' +
          '<span id="org-zoom-label" style="font-size:13px;font-weight:600;min-width:42px;text-align:center">100%</span>' +
          '<button class="btn btn-outline btn-sm" onclick="OrgChartView.zoomIn()"><span class="material-icons-round" style="font-size:16px">add</span></button>' +
          '<button class="btn btn-outline btn-sm" onclick="OrgChartView.resetZoom()" style="margin-left:4px">↺ Reset</button>' +
        '</div>' +
        '<div id="org-zoom-outer" style="overflow:auto;width:100%;max-height:72vh">' +
          '<div id="org-zoom-inner" style="display:inline-block;transform-origin:top left;transition:transform .15s">' +
            '<div id="org-tree" class="loader"><div class="spinner"></div> Construyendo organigrama...</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    APP.api('orgchart.get', {}, function(err, data) {
      if (err) { APP.toast(err,'error'); return; }
      var tree = document.getElementById('org-tree');
      if (!tree) return;
      tree.dataset.loaded = '1';
      tree.className = 'org-tree';
      tree.innerHTML = OrgChartView.renderNodes(data.nodes, 0);
    });
  },
  renderNodes: function(nodes, depth) {
    depth = depth || 0;
    if (!nodes || !nodes.length) return '';
    return nodes.map(function(n) {
      var hasChildren = n.children && n.children.length > 0;
      var collapsed = depth >= 2;
      var toggleBtn = hasChildren
        ? '<button class="org-toggle-btn" onclick="OrgChartView.toggle(this)">' + (collapsed ? '▼ ' + n.children.length : '▲') + '</button>'
        : '';
      var card = '<div class="org-card' + (n.isLeader ? ' leader' : '') + '">' +
        '<div class="oa">' + APP.initials(n.fullName) + '</div>' +
        '<div class="on">' + n.fullName + '</div>' +
        '<div class="ot">' + (n.jobTitle || '') + '</div>' +
        (n.isLeader   ? '<div class="org-badge" style="color:var(--primary)">👑 Líder</div>'    : '') +
        (n.isCoLeader ? '<div class="org-badge" style="color:var(--warning)">⭐ Co-líder</div>' : '') +
        (n.department ? '<div class="org-dept">' + n.department + '</div>' : '') +
        toggleBtn + '</div>';
      var children = hasChildren
        ? '<div class="org-vline"></div>' +
          '<div class="org-children"' + (collapsed ? ' style="display:none"' : '') + '>' +
          OrgChartView.renderNodes(n.children, depth + 1) + '</div>'
        : '';
      return '<div class="org-node">' + card + children + '</div>';
    }).join('');
  },
  toggle: function(btn) {
    var orgNode = btn.parentNode.parentNode;
    var children = orgNode.querySelector('.org-children');
    var vline = orgNode.querySelector('.org-vline');
    if (!children) return;
    var isHidden = children.style.display === 'none';
    children.style.display = isHidden ? 'flex' : 'none';
    if (vline) vline.style.display = isHidden ? 'block' : 'none';
    var count = children.querySelectorAll(':scope > .org-node').length;
    btn.textContent = isHidden ? '▲' : '▼ ' + count;
  },
  zoomIn:    function() { OrgChartView.zoom = Math.min(2,  Math.round((OrgChartView.zoom+0.1)*10)/10); OrgChartView._applyZoom(); },
  zoomOut:   function() { OrgChartView.zoom = Math.max(0.3,Math.round((OrgChartView.zoom-0.1)*10)/10); OrgChartView._applyZoom(); },
  resetZoom: function() { OrgChartView.zoom = 1; OrgChartView._applyZoom(); },
  _applyZoom: function() {
    var inner = document.getElementById('org-zoom-inner');
    if (inner) inner.style.transform = 'scale(' + OrgChartView.zoom + ')';
    var label = document.getElementById('org-zoom-label');
    if (label) label.textContent = Math.round(OrgChartView.zoom * 100) + '%';
  }
};

// ── KPIs VIEW ─────────────────────────────────────────────────
var KPIsView = {
  tab: 'self',
  _pendingPeriods: {},  // kpiIds por período para submitPeriodSelf
  _reviewGroups: {},
  _reviewOrder: [],

  load: function() {
    var el = document.getElementById('kpi-content');
    if (!el) return;
    KPIsView.renderTabs();
    KPIsView.loadTab('self');
  },

  renderTabs: function() {
    var el = document.getElementById('kpi-content');
    var isManager = APP.user && (APP.user.isManager || APP.user.isAdmin || APP.user.isHR);
    el.innerHTML = '<div class="tabs">' +
      '<div class="tab active" onclick="KPIsView.loadTab(\'self\')" id="tab-self">📊 Mis KPIs</div>' +
      (isManager ? '<div class="tab" onclick="KPIsView.loadTab(\'review\')" id="tab-review">✏️ Por Revisar <span id="kpi-review-count" class="nav-badge" style="background:var(--warning);color:#fff;margin-left:4px"></span></div>' : '') +
      (isManager ? '<div class="tab" onclick="KPIsView.loadTab(\'team\')" id="tab-team">👥 Mi Equipo</div>' : '') +
      (APP.user && (APP.user.isAdmin||APP.user.isHR) ? '<div class="tab" onclick="KPIsView.loadTab(\'config\')" id="tab-config">⚙️ Configurar</div>' : '') +
      '</div><div id="kpi-tab-content"><div class="loader"><div class="spinner"></div></div></div>';
  },

  loadTab: function(tab) {
    KPIsView.tab = tab;
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    var tEl = document.getElementById('tab-' + tab);
    if (tEl) tEl.classList.add('active');
    var content = document.getElementById('kpi-tab-content');
    content.innerHTML = '<div class="loader"><div class="spinner"></div> Cargando...</div>';
    if (tab === 'self') {
      APP.api('kpi.dashboard', { employeeId: APP.user.id }, function(err, data) {
        if (err) { content.innerHTML = '<p class="text-muted">Error: ' + err + '</p>'; return; }
        content.innerHTML = KPIsView.renderSelfDashboard(data);
      });
    } else if (tab === 'review') {
      APP.api('kpi.reviews.pendingManager', {}, function(err, data) {
        if (err) { content.innerHTML = '<p>Error: ' + err + '</p>'; return; }
        var cnt = document.getElementById('kpi-review-count');
        if (cnt) cnt.textContent = (data||[]).length || '';
        content.innerHTML = KPIsView.renderManagerReviews(data || []);
      });
    } else if (tab === 'team') {
      var teams = APP.user.ledTeams && APP.user.ledTeams[0];
      if (!teams) { content.innerHTML = '<div class="empty-state"><span class="material-icons-round">group</span><p>No tienes equipos asignados</p></div>'; return; }
      APP.api('kpi.teamDashboard', { teamId: teams }, function(err, data) {
        if (err) { content.innerHTML = '<p>Error: ' + err + '</p>'; return; }
        content.innerHTML = KPIsView.renderTeamDashboard(data);
      });
    } else if (tab === 'config') {
      APP.api('kpi.definitions.list', {}, function(err, data) {
        if (err) { content.innerHTML = '<p>Error: ' + err + '</p>'; return; }
        content.innerHTML = KPIsView.renderConfig(data || []);
      });
    }
  },

  // ── P2: semaphore HTML helper ─────────────────────────────────
  _semHtml: function(key, curVal) {
    var opts = [
      { val: 0,   label: '🔴 No logrado',   cls: 'red'    },
      { val: 50,  label: '🟡 Parcialmente', cls: 'yellow' },
      { val: 100, label: '🟢 Logrado',      cls: 'green'  }
    ];
    var cur = (curVal !== undefined && curVal !== '') ? parseInt(curVal) : null;
    var btns = opts.map(function(o) {
      var sel = (cur !== null && cur === o.val) ? ' selected-' + o.cls : '';
      return '<button type="button" class="sem-btn' + sel + '" onclick="KPIsView.setSem(\'' + key + '\',' + o.val + ')" data-val="' + o.val + '">' + o.label + '</button>';
    }).join('');
    return '<div class="sem-sel" id="sem-sel-' + key + '">' + btns + '</div>' +
           '<input type="hidden" id="sem-val-' + key + '" value="' + (cur !== null ? cur : '') + '">';
  },

  setSem: function(key, val) {
    var hidden = document.getElementById('sem-val-' + key);
    if (hidden) hidden.value = val;
    var cls = { 0: 'red', 50: 'yellow', 100: 'green' };
    var sel = document.getElementById('sem-sel-' + key);
    if (!sel) return;
    sel.querySelectorAll('.sem-btn').forEach(function(btn) {
      btn.classList.remove('selected-red', 'selected-yellow', 'selected-green');
      if (parseInt(btn.dataset.val) === val) btn.classList.add('selected-' + (cls[val] || ''));
    });
  },

  // ── P1: self-assessment for a full period at once ─────────────
  renderSelfDashboard: function(d) {
    var pending = d.pendingSelf || 0;
    var avgLabel = d.avgScore !== null && d.avgScore !== undefined ? APP.semLabel(d.avgScore) : '—';
    var html = '<div class="grid grid-3 mb-20">' +
      '<div class="card stat-card"><div class="stat-icon blue"><span class="material-icons-round">analytics</span></div><div><div class="stat-value" style="font-size:18px">' + avgLabel + '</div><div class="stat-label">Resultado general</div></div></div>' +
      '<div class="card stat-card"><div class="stat-icon orange"><span class="material-icons-round">pending_actions</span></div><div><div class="stat-value">' + pending + '</div><div class="stat-label">Períodos pendientes</div></div></div>' +
      '<div class="card stat-card"><div class="stat-icon green"><span class="material-icons-round">trending_up</span></div><div><div class="stat-value">' + (d.kpisForRole||d.kpisForPosition||[]).length + '</div><div class="stat-label">KPIs en tu puesto</div></div></div>' +
      '</div>';

    // ── P1: group pending items by period, one form per period ──
    var pendingItems = d.pendingItems || [];
    if (pendingItems.length > 0) {
      KPIsView._pendingPeriods = {};
      var pendingByPeriod = {}, periodOrder = [];
      pendingItems.forEach(function(item) {
        var pid = item.period.id;
        if (!pendingByPeriod[pid]) { pendingByPeriod[pid] = { period: item.period, items: [] }; periodOrder.push(pid); }
        pendingByPeriod[pid].items.push(item);
      });
      periodOrder.forEach(function(pid) {
        var pg = pendingByPeriod[pid];
        var period = pg.period;
        KPIsView._pendingPeriods[pid] = pg.items.map(function(i) { return i.kpi.id; });
        html += '<div class="card mb-20">' +
          '<div class="card-title">⚡ Autoevaluación — ' + period.name + '</div>' +
          (period.selfAssessmentDeadline
            ? '<p class="text-sm text-muted mb-16">📅 Fecha límite: <strong>' + APP.fmtDate(period.selfAssessmentDeadline) + '</strong></p>'
            : '<p class="text-sm text-muted mb-16">Período activo. Selecciona tu resultado en cada KPI.</p>');
        pg.items.forEach(function(item) {
          var kpi = item.kpi;
          var draftScore   = item.draft && item.draft.selfScore !== '' ? item.draft.selfScore : undefined;
          var draftComment = item.draft ? (item.draft.selfComments || '') : '';
          html += '<div class="kpi-review-row">' +
            '<div class="kpi-row-name">' + kpi.name + '</div>' +
            '<div class="kpi-row-meta">' +
              (kpi.target ? '<span>🎯 ' + kpi.target + '</span>' : '') +
              '<span>⚖️ ' + kpi.weight + '%</span>' +
              '<span>📦 ' + kpi.periodType + '</span>' +
            '</div>' +
            (kpi.instructions ? '<div class="alert info" style="margin-bottom:10px;font-size:12px">📋 ' + kpi.instructions + '</div>' : '') +
            KPIsView._semHtml(kpi.id, draftScore) +
            '<textarea id="sem-comment-' + kpi.id + '" class="mt-8" rows="2" placeholder="Contexto o evidencia (opcional)...">' + draftComment + '</textarea>' +
          '</div>';
        });
        html += '<div style="text-align:right;margin-top:16px">' +
          '<button class="btn btn-primary" onclick="KPIsView.submitPeriodSelf(\'' + pid + '\')">' +
            '<span class="material-icons-round">send</span> Enviar autoevaluación →</button></div>' +
        '</div>';
      });
    }

    html += '<div class="card"><div class="card-title">📅 Historial de Evaluaciones</div>';
    if (!(d.periodResults||[]).length) {
      html += '<div class="empty-state"><span class="material-icons-round">history</span><p>Sin evaluaciones aún</p></div>';
    }
    (d.periodResults||[]).forEach(function(pr) {
      var label = pr.overallScore !== null ? APP.semLabel(pr.overallScore) : null;
      html += '<div style="padding:12px 0;border-bottom:1px solid var(--border)">' +
        '<div class="flex justify-between items-center"><div>' +
        '<div class="font-600 text-sm">' + pr.period.name + '</div>' +
        '<div class="text-xs text-muted">' + APP.fmtDate(pr.period.startDate) + ' → ' + APP.fmtDate(pr.period.endDate) + '</div></div>' +
        (label ? '<div style="text-align:right;font-size:16px;font-weight:700">' + label + '</div>' : APP.badgeStatus(pr.period.status)) +
        '</div>' +
        '<div class="progress-wrap mt-8"><div class="progress-fill" style="width:' + pr.completionPct + '%"></div></div>' +
        '<div class="text-xs text-muted mt-4">' + pr.completedCount + '/' + pr.totalCount + ' KPIs completados</div></div>';
    });
    html += '</div>';
    return html;
  },

  submitPeriodSelf: function(periodId) {
    var kpiIds = KPIsView._pendingPeriods[periodId] || [];
    for (var i = 0; i < kpiIds.length; i++) {
      var v = document.getElementById('sem-val-' + kpiIds[i]);
      if (!v || v.value === '') {
        APP.toast('Selecciona tu resultado para todos los KPIs', 'error'); return;
      }
    }
    var btns = document.querySelectorAll('[onclick*="submitPeriodSelf"]');
    btns.forEach(function(b) { b.disabled = true; b.textContent = 'Enviando...'; });
    var idx = 0;
    function next() {
      if (idx >= kpiIds.length) {
        APP.toast('✅ Autoevaluación enviada al manager', 'success');
        APP.data = null; KPIsView.loadTab('self'); return;
      }
      var kpiId    = kpiIds[idx++];
      var score    = document.getElementById('sem-val-' + kpiId).value;
      var comments = (document.getElementById('sem-comment-' + kpiId)||{}).value || '';
      APP.api('kpi.reviews.selfSubmit', { kpiDefinitionId: kpiId, periodId: periodId, selfScore: score, selfComments: comments },
        function(err) {
          if (err) { APP.toast(err, 'error'); btns.forEach(function(b){b.disabled=false;b.textContent='Enviar autoevaluación →';}); return; }
          next();
        }
      );
    }
    next();
  },

  // ── Manager review ────────────────────────────────────────────
  renderManagerReviews: function(reviews) {
    if (!reviews.length) return '<div class="empty-state"><span class="material-icons-round">task_alt</span><p>¡Sin revisiones pendientes!</p></div>';
    var groups = {}, order = [];
    reviews.forEach(function(r) {
      if (!groups[r.employeeName]) { groups[r.employeeName] = []; order.push(r.employeeName); }
      groups[r.employeeName].push(r);
    });
    KPIsView._reviewGroups = groups;
    KPIsView._reviewOrder  = order;
    var html = '<div class="card"><div class="card-title">Evaluaciones pendientes de tu revisión <span class="badge badge-warning" style="margin-left:8px">' + order.length + ' persona(s) · ' + reviews.length + ' KPI(s)</span></div>';
    order.forEach(function(empName, idx) {
      var empReviews = groups[empName];
      var isLast = idx === order.length - 1;
      html += '<div style="padding:16px 0' + (isLast ? '' : ';border-bottom:1px solid var(--border)') + '">' +
        '<div class="flex items-center gap-10 mb-10">' +
          '<div class="emp-avatar" style="width:40px;height:40px;font-size:14px;flex-shrink:0">' + APP.initials(empName) + '</div>' +
          '<div style="flex:1"><div class="font-600">' + empName + '</div><div class="text-xs text-muted">' + empReviews.length + ' KPI(s) por revisar</div></div>' +
          '<button class="btn btn-primary btn-sm" onclick="KPIsView.openEmployeeReview(' + idx + ')"><span class="material-icons-round">rate_review</span>Revisar evaluación</button>' +
        '</div>' +
        '<div style="margin-left:50px">' +
          empReviews.map(function(r) {
            var comment = r.selfComments ? ' · <em style="color:var(--text-muted)">"' + r.selfComments.substring(0,90) + (r.selfComments.length>90?'…':'') + '"</em>' : '';
            return '<div style="padding:8px 12px;background:var(--bg);border-radius:6px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">' +
              '<div><div class="text-sm font-600">' + r.kpiName + '</div>' +
              '<div class="text-xs" style="color:var(--text-muted)">Auto: <strong>' + APP.semLabel(r.selfScore) + '</strong>' + comment + '</div></div>' +
              '<span class="badge badge-warning" style="font-size:10px">En revisión</span></div>';
          }).join('') +
        '</div></div>';
    });
    return html + '</div>';
  },

  openEmployeeReview: function(idx) {
    var empName    = KPIsView._reviewOrder[idx];
    var empReviews = KPIsView._reviewGroups[empName];
    if (!empReviews || !empReviews.length) return;
    var body = empReviews.map(function(r, i) {
      var sep = i > 0 ? 'padding-top:20px;margin-top:20px;border-top:1px solid var(--border)' : '';
      return '<div style="' + sep + '">' +
        '<div class="font-600 text-sm mb-8">' + r.kpiName + '</div>' +
        '<div style="background:var(--bg);border-radius:6px;padding:10px 12px;margin-bottom:12px">' +
          '<div class="text-xs" style="color:var(--text-muted)">Autoevaluación: <strong>' + APP.semLabel(r.selfScore) + '</strong>' + (r.kpiTarget ? ' · Meta: ' + r.kpiTarget : '') + '</div>' +
          (r.selfComments ? '<div class="text-xs mt-4" style="color:var(--text-muted)">💬 "' + r.selfComments + '"</div>' : '') +
        '</div>' +
        '<div class="form-group"><label>Tu evaluación *</label>' +
          KPIsView._semHtml('mr-' + r.id, '') +
        '</div>' +
        '<div class="form-group"><label>Retroalimentación</label><textarea id="mr-comments-' + r.id + '" rows="2" placeholder="Comentarios para ' + empName + '..."></textarea></div>' +
      '</div>';
    }).join('');
    var ids = JSON.stringify(empReviews.map(function(r){ return r.id; }));
    APP.modal('📊 Revisión: ' + empName, body,
      '<button class="btn btn-outline" onclick="APP.closeModal()">Cancelar</button>' +
      '<button class="btn btn-primary" onclick="KPIsView.submitAllReviews(' + ids + ',true)"><span class="material-icons-round">check_circle</span>Aprobar todas</button>'
    );
  },

  submitAllReviews: function(reviewIds, approved) {
    for (var v = 0; v < reviewIds.length; v++) {
      var sv = document.getElementById('sem-val-mr-' + reviewIds[v]);
      if (!sv || sv.value === '') {
        APP.toast('Selecciona tu evaluación para todos los KPIs', 'error'); return;
      }
    }
    var idx = 0;
    function next() {
      if (idx >= reviewIds.length) {
        APP.closeModal();
        APP.toast('✅ ' + reviewIds.length + ' evaluación(es) aprobada(s)', 'success');
        KPIsView.loadTab('review'); return;
      }
      var rid      = reviewIds[idx++];
      var score    = document.getElementById('sem-val-mr-' + rid).value;
      var comments = (document.getElementById('mr-comments-' + rid)||{}).value || '';
      APP.api('kpi.reviews.managerReview', { reviewId: rid, managerScore: score, managerComments: comments, finalScore: score, approved: approved },
        function(err) { if (err) { APP.toast(err, 'error'); return; } next(); });
    }
    next();
  },

  renderTeamDashboard: function(d) {
    return '<div class="grid grid-3 mb-20">' +
      '<div class="card stat-card"><div class="stat-icon blue"><span class="material-icons-round">people</span></div><div><div class="stat-value">' + d.memberCount + '</div><div class="stat-label">Miembros del equipo</div></div></div>' +
      '<div class="card stat-card"><div class="stat-icon green"><span class="material-icons-round">analytics</span></div><div><div class="stat-value" style="font-size:16px">' + (d.teamScore !== null ? APP.semLabel(d.teamScore) : '—') + '</div><div class="stat-label">Resultado del equipo</div></div></div>' +
      '<div class="card stat-card"><div class="stat-icon orange"><span class="material-icons-round">pending</span></div><div><div class="stat-value">' + d.pendingTotal + '</div><div class="stat-label">Revisiones pendientes</div></div></div>' +
      '</div><div class="card"><div class="card-title">Resultados por miembro</div>' +
      '<div class="table-wrap"><table><thead><tr><th>Empleado</th><th>Resultado</th><th>Pendientes</th></tr></thead><tbody>' +
      (d.memberStats||[]).map(function(m) {
        return '<tr><td><div class="td-name"><div class="td-avatar">' + APP.initials(m.fullName) + '</div>' + m.fullName + '</div></td>' +
          '<td><strong>' + APP.semLabel(m.lastScore) + '</strong></td>' +
          '<td>' + (m.pendingReviews > 0 ? '<span class="badge badge-warning">' + m.pendingReviews + ' pendiente(s)</span>' : '✅') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  },

  renderConfig: function(kpis) {
    return '<div class="card"><div class="card-title flex justify-between items-center">KPIs Configurados' +
      '<button class="btn btn-primary btn-sm" onclick="AdminHR.openBatchKPI()"><span class="material-icons-round">playlist_add</span>Agregar por Puesto</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>KPI</th><th>Puesto</th><th>Tipo</th><th>Período</th><th>Peso</th><th>Meta</th><th>Estado</th></tr></thead><tbody>' +
      kpis.map(function(k) {
        return '<tr><td><strong>' + k.name + '</strong><br><span class="text-xs text-muted">' + (k.category||'') + '</span></td>' +
          '<td>' + (k.positionName||k.roleName||'—') + '</td><td>' + k.type + '</td><td>' + k.periodType + '</td>' +
          '<td><strong>' + k.weight + '%</strong></td><td>' + k.target + '</td>' +
          '<td>' + (String(k.isActive)==='true' ? '<span class="badge badge-success">Activo</span>' : '<span class="badge badge-gray">Inactivo</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
};

// ── VACATIONS VIEW ────────────────────────────────────────────
var VacationsView = {
  load: function() {
    var el = document.getElementById('vac-content');
    if (!el) return;
    el.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    VacationsView.loadAll();
  },
  loadAll: function() {
    var done = 0, bal, reqs, holsCur = [], holsNxt = [];
    var yr = new Date().getFullYear();
    function mergeAndRender() { VacationsView.render(bal, reqs, holsCur.concat(holsNxt)); }
    function check() { done++; if (done === 4) mergeAndRender(); }
    APP.api('vacations.balance',    { employeeId: APP.user.id }, function(e,d){ bal=d; check(); });
    APP.api('vacations.myRequests', { employeeId: APP.user.id }, function(e,d){ reqs=d||[]; check(); });
    APP.api('vacations.holidays',   { year: yr   }, function(e,d){ holsCur=d||[]; check(); });
    APP.api('vacations.holidays',   { year: yr+1 }, function(e,d){ holsNxt=d||[]; check(); });
  },
  render: function(bal, reqs, hols) {
    var el = document.getElementById('vac-content'); if (!el) return;
    bal = bal || {};
    var html = '<div class="card mb-20"><div class="card-title">🏖️ Mi Saldo de Vacaciones ' + new Date().getFullYear() + '</div>' +
      '<div class="vacation-balance">' +
      '<div class="balance-box"><div class="balance-num">' + (bal.daysEntitled||0) + '</div><div class="balance-lbl">Días disponibles (LFT)</div></div>' +
      '<div class="balance-box"><div class="balance-num" style="color:var(--success)">' + (bal.daysRemaining||0) + '</div><div class="balance-lbl">Días restantes</div></div>' +
      '<div class="balance-box"><div class="balance-num" style="color:var(--warning)">' + (bal.daysPending||0) + '</div><div class="balance-lbl">Días pendientes</div></div>' +
      '<div class="balance-box"><div class="balance-num" style="color:var(--text-muted)">' + (bal.daysUsed||0) + '</div><div class="balance-lbl">Días tomados</div></div>' +
      '</div><div class="mt-16"><div class="progress-wrap"><div class="progress-fill" style="width:' + Math.round(((bal.daysUsed||0)/(bal.daysEntitled||12))*100) + '%"></div></div>' +
      '<div class="text-xs text-muted mt-4">' + (bal.daysUsed||0) + ' de ' + (bal.daysEntitled||0) + ' días usados</div></div></div>';
    html += '<div class="flex gap-12 mb-20">' +
      '<button class="btn btn-primary" onclick="VacationsView.openRequest()"><span class="material-icons-round">add</span>Solicitar Vacaciones</button>' +
      (APP.user.isAdmin||APP.user.isHR||(APP.user.isManager&&APP.user.canApproveVacations) ? '<button class="btn btn-outline" onclick="VacationsView.loadTeamRequests()"><span class="material-icons-round">group</span>Ver equipo</button>' : '') +
      '</div>';
    html += '<div class="grid grid-2 gap-16"><div><div class="card"><div class="card-title">Mis Solicitudes</div>';
    if (!reqs.length) html += '<div class="empty-state"><span class="material-icons-round">beach_access</span><p>Sin solicitudes aún</p></div>';
    else html += reqs.slice(0,10).map(VacationsView.requestCard).join('');
    html += '</div></div>';
    VacationsView._hols = hols;
    var _c = VacationsView._country || 'MX';
    var _countryChips = {MX:'🇲🇽 MX',AR:'🇦🇷 AR',BR:'🇧🇷 BR',US:'🇺🇸 US',JP:'🇯🇵 JP',CO:'🇨🇴 CO',PA:'🇵🇦 PA'};
    html += '<div><div class="card">' +
      '<div class="card-title">📅 Feriados ' + new Date().getFullYear() + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">' +
      Object.keys(_countryChips).map(function(k) {
        var on = k === _c;
        return '<button id="hol-chip-'+k+'" onclick="VacationsView._setCountry(\''+k+'\')" style="padding:5px 13px;border-radius:20px;border:2px solid '+(on?'var(--primary)':'var(--border)')+';background:'+(on?'var(--primary)':'transparent')+';color:'+(on?'#fff':'var(--text)')+';font-size:0.8rem;font-weight:'+(on?'700':'400')+';cursor:pointer;transition:all .15s">'+_countryChips[k]+'</button>';
      }).join('') +
      '</div>' +
      '<div id="hol-list">' + VacationsView._holRows(hols, _c) + '</div>' +
      '</div></div></div>';
    el.innerHTML = html;
  },
  requestCard: function(r) {
    var canCancel = r.status === 'Pendiente' || r.status === 'Pendiente Manager';
    return '<div class="request-card mt-8"><div>' +
      '<div class="request-dates">📅 ' + APP.fmtDate(r.startDate) + ' → ' + APP.fmtDate(r.endDate) + '</div>' +
      '<div class="request-days">' + r.workingDays + ' días hábiles' + (r.reason ? ' · ' + r.reason : '') + '</div></div>' +
      APP.badgeStatus(r.status) + (canCancel ? '<button class="btn btn-outline btn-sm" onclick="VacationsView.cancelReq(\'' + r.id + '\')">Cancelar</button>' : '') + '</div>';
  },
  openRequest: function() {
    var today = new Date().toISOString().split('T')[0];
    APP.modal('🏖️ Solicitar Vacaciones',
      '<div class="alert info mb-16">ℹ️ Solo se contarán días hábiles (lunes a viernes, excluyendo feriados).</div>' +
      '<div class="form-row"><div class="form-group"><label>Fecha inicio</label><input type="date" id="vac-start" min="' + today + '"></div>' +
      '<div class="form-group"><label>Fecha fin</label><input type="date" id="vac-end" min="' + today + '"></div></div>' +
      '<div class="form-group"><label>Días hábiles estimados</label><div id="vac-days-calc" class="alert info">Selecciona las fechas para calcular</div></div>' +
      '<div class="form-group"><label>Motivo (opcional)</label><input id="vac-reason" placeholder="Vacaciones familiares, viaje..."></div>',
      '<button class="btn btn-outline" onclick="APP.closeModal()">Cancelar</button>' +
      '<button class="btn btn-primary" onclick="VacationsView.submitRequest()"><span class="material-icons-round">send</span>Enviar solicitud</button>'
    );
    setTimeout(function() {
      ['vac-start','vac-end'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', VacationsView.calcDays);
      });
    }, 100);
  },
  calcDays: function() {
    var s = (document.getElementById('vac-start')||{}).value;
    var e = (document.getElementById('vac-end')||{}).value;
    var el = document.getElementById('vac-days-calc');
    if (!s || !e || !el) return;
    APP.api('vacations.workingDays', { startDate: s, endDate: e }, function(err, days) {
      if (err) { el.textContent = 'Error calculando'; return; }
      el.textContent = '📅 ' + days + ' días hábiles';
    });
  },
  submitRequest: function() {
    var s = document.getElementById('vac-start').value;
    var e = document.getElementById('vac-end').value;
    var r = document.getElementById('vac-reason').value;
    if (!s || !e) { APP.toast('Selecciona las fechas', 'error'); return; }
    APP.api('vacations.request', { startDate: s, endDate: e, reason: r }, function(err) {
      if (err) { APP.toast(err, 'error'); return; }
      APP.closeModal(); APP.toast('✅ Solicitud enviada a tu manager', 'success');
      VacationsView.load();
    });
  },
  cancelReq: function(id) {
    if (!confirm('¿Cancelar esta solicitud?')) return;
    APP.api('vacations.cancel', { id: id }, function(err) {
      if (err) { APP.toast(err, 'error'); return; }
      APP.toast('Solicitud cancelada', 'success'); VacationsView.load();
    });
  },
  loadTeamRequests: function() {
    var isHROrAdmin = APP.user.isAdmin || APP.user.isHR;
    var title = isHROrAdmin ? '👥 Solicitudes Pendientes (Revisión RH)' : '👥 Solicitudes Pendientes de tu Aprobación';
    APP.api('vacations.teamRequests', {}, function(err, data) {
      if (err) { APP.toast(err, 'error'); return; }
      if (!data || !data.length) { APP.toast('Sin solicitudes pendientes', 'info'); return; }
      APP.modal(title,
        '<div>' + data.map(function(r) {
          var approveLabel = isHROrAdmin ? '✅ Aprobar → Manager' : '✅ Aprobar';
          return '<div class="request-card mt-8"><div><div class="font-600 text-sm">' + r.employeeName + '</div>' +
            '<div class="request-dates">' + APP.fmtDate(r.startDate) + ' → ' + APP.fmtDate(r.endDate) + '</div>' +
            '<div class="request-days">' + r.workingDays + ' días hábiles' + (r.reason ? ' · ' + r.reason : '') + '</div></div>' +
            '<div class="flex gap-8">' +
            '<button class="btn btn-success btn-sm" onclick="VacationsView.approveReq(\'' + r.id + '\')">' + approveLabel + '</button>' +
            '<button class="btn btn-danger btn-sm" onclick="VacationsView.rejectReq(\'' + r.id + '\')">❌ Rechazar</button></div></div>';
        }).join('') + '</div>');
    });
  },
  approveReq: function(id) {
    APP.api('vacations.approve', { id: id, notes: '' }, function(err, data) {
      if (err) { APP.toast(err, 'error'); return; }
      var msg = (data && data.status === 'Pendiente Manager') ? '✅ Revisado por RH · pendiente aprobación del manager' : '✅ Vacaciones aprobadas';
      APP.toast(msg, 'success'); APP.closeModal();
    });
  },
  rejectReq: function(id) {
    APP.modal('❌ Rechazar Solicitud de Vacaciones',
      '<div class="alert warning mb-12">El empleado será notificado y los días regresarán a su saldo disponible.</div>' +
      '<div class="form-group"><label>Motivo de rechazo</label><textarea id="rej-reason" rows="3" placeholder="Explica por qué no se puede aprobar..."></textarea></div>',
      '<button class="btn btn-outline" onclick="APP.closeModal()">Cancelar</button>' +
      '<button class="btn btn-danger" onclick="VacationsView._doReject(\'' + id + '\')">Confirmar Rechazo</button>'
    );
  },
  _doReject: function(id) {
    var notes = (document.getElementById('rej-reason')||{value:''}).value.trim();
    APP.api('vacations.reject', { id: id, notes: notes }, function(err) {
      if (err) { APP.toast(err, 'error'); return; }
      APP.toast('Solicitud rechazada', 'info'); APP.closeModal();
    });
  },
  _hols: [], _country: 'MX',
  _holRows: function(hols, country) {
    var rows = hols.filter(function(h){ return h.type === country; });
    if (!rows.length) return '<div class="empty-state"><span class="material-icons-round">event_busy</span><p>Sin feriados registrados</p></div>';
    var today = new Date(); today.setHours(0,0,0,0);

    var upcoming = [], past = [];
    rows.forEach(function(h) {
      (new Date(h.date + 'T00:00:00') >= today ? upcoming : past).push(h);
    });
    upcoming.sort(function(a, b){ return a.date.localeCompare(b.date); });

    // Past holidays that already have an upcoming version (same name) get dropped
    var upNames = upcoming.map(function(h){ return h.name.toLowerCase(); });
    past = past.filter(function(h){ return upNames.indexOf(h.name.toLowerCase()) === -1; });

    // Project the remaining past holidays to next year
    past = past.map(function(h) {
      var ny = String(parseInt(h.date.split('-')[0]) + 1);
      return { name: h.name, date: ny + h.date.slice(4), type: h.type };
    }).sort(function(a, b){ return a.date.localeCompare(b.date); });

    return upcoming.concat(past).map(function(h) {
      var diff  = Math.round((new Date(h.date + 'T00:00:00') - today) / 86400000);
      var label, color;
      if (diff === 0)     { label = '🎉 Hoy';            color = 'var(--success)'; }
      else if (diff <= 7) { label = 'En ' + diff + 'd';  color = 'var(--warning)'; }
      else                { label = 'En ' + diff + 'd';  color = 'var(--primary)'; }
      return '<div class="flex justify-between items-center" style="padding:10px 0;border-bottom:1px solid var(--border)">' +
        '<div>' +
          '<div style="font-size:1rem;font-weight:600;line-height:1.2">' + h.name + '</div>' +
          '<div style="font-size:0.88rem;color:var(--text-muted);margin-top:3px">' + APP.fmtDate(h.date) + '</div>' +
        '</div>' +
        '<span style="font-size:0.8rem;font-weight:700;color:' + color + ';white-space:nowrap;margin-left:8px">' + label + '</span>' +
        '</div>';
    }).join('');
  },
  _setCountry: function(c) {
    VacationsView._country = c;
    var chips = {MX:1,AR:1,BR:1,US:1,JP:1,CO:1,PA:1};
    Object.keys(chips).forEach(function(k) {
      var btn = document.getElementById('hol-chip-' + k);
      if (!btn) return;
      var on = k === c;
      btn.style.borderColor = on ? 'var(--primary)' : 'var(--border)';
      btn.style.background  = on ? 'var(--primary)' : 'transparent';
      btn.style.color       = on ? '#fff' : 'var(--text)';
      btn.style.fontWeight  = on ? '700' : '400';
    });
    var el = document.getElementById('hol-list');
    if (el) el.innerHTML = VacationsView._holRows(VacationsView._hols || [], c);
  }
};

// ── ADMIN / HR ────────────────────────────────────────────────
var AdminHR = {
  _cachedRoles: null,
  _cachedPositions: null,
  _allKPIs: null,
  _batchRowStyle: null,
  _batchTypeOpts: null,
  _batchPeriodOpts: null,
  _reviewGroups: null,
  _reviewOrder: null,

  // ── EMPLOYEES ──────────────────────────────────────────────
  openNewEmployee: function() {
    AdminHR._loadFormDeps(function(roles, managers, positions) {
      APP.modal('➕ Nuevo Empleado', AdminHR._employeeForm(null, roles, managers, positions),
        '<button class="btn btn-outline" onclick="APP.closeModal()">Cancelar</button>' +
        '<button class="btn btn-primary" onclick="AdminHR.saveEmployee(null)"><span class="material-icons-round">save</span>Guardar</button>');
    });
  },
  openEditEmployee: function(id) {
    APP.api('employees.get', { id: id }, function(err, emp) {
      if (err) { APP.toast(err, 'error'); return; }
      AdminHR._loadFormDeps(function(roles, managers, positions) {
        APP.modal('✏️ Editar: ' + emp.fullName, AdminHR._employeeForm(emp, roles, managers, positions),
          '<button class="btn btn-outline" onclick="APP.closeModal()">Cancelar</button>' +
          '<button class="btn btn-primary" onclick="AdminHR.saveEmployee(\'' + id + '\')"><span class="material-icons-round">save</span>Guardar cambios</button>');
      });
    });
  },
  _loadFormDeps: function(cb) {
    var res = {}, pending = 3;
    function done(k, v) { res[k] = v; if (--pending === 0) { AdminHR._cachedRoles=res.roles||[]; AdminHR._cachedPositions=res.positions||[]; cb(res.roles||[], (res.employees||[]).filter(function(m){ return m.status==='activo'||!m.status; }), res.positions||[]); } }
    APP.api('roles.list',     {}, function(e,d){ done('roles',     d||[]); });
    APP.api('employees.list', {}, function(e,d){ done('employees', d||[]); });
    APP.api('positions.list', {}, function(e,d){ done('positions', d||[]); });
  },
  _employeeForm: function(emp, roles, managers, positions) {
    var v = emp || {};
    var sel = function(id, opts, val) {
      return '<select id="' + id + '">' + opts.map(function(o){ return '<option value="' + o.value + '"' + (o.value==val?' selected':'') + '>' + o.label + '</option>'; }).join('') + '</select>';
    };
    var roleOpts    = [{value:'',label:'— Selecciona un rol —'}].concat(roles.map(function(r){return{value:r.id,label:r.name};}));
    var mgrOpts     = [{value:'',label:'— Sin manager directo —'}].concat((managers||[]).map(function(m){return{value:m.id||m.employeeId,label:m.fullName||((m.firstName||'')+' '+(m.lastName||''))};}));
    var posOpts     = [{value:'',label:'— Sin puesto específico —'}].concat((positions||[]).map(function(p){return{value:p.id,label:p.name};}));
    var deptOpts    = ['Dirección','Sales','Sales Operations','Operations','INT OPS','Nodalink','Ikan Hub','RH','Marketing'].map(function(d){return{value:d,label:d};});
    var typeOpts    = ['Planta','Contrato','Por Proyecto','Temporal'].map(function(t){return{value:t,label:t};});
    var countryOpts = [{value:'MX',label:'🇲🇽 México'},{value:'AR',label:'🇦🇷 Argentina'},{value:'BR',label:'🇧🇷 Brasil'},{value:'US',label:'🇺🇸 EE.UU.'},{value:'JP',label:'🇯🇵 Japón'},{value:'CO',label:'🇨🇴 Colombia'},{value:'PA',label:'🇵🇦 Panamá'}];
    return '<div class="form-row">' +
      '<div class="form-group"><label>Nombre *</label><input id="ef-first" placeholder="Carlos" value="' + (v.firstName||'') + '"></div>' +
      '<div class="form-group"><label>Apellido *</label><input id="ef-last" placeholder="Martínez" value="' + (v.lastName||'') + '"></div>' +
      '</div><div class="form-row">' +
      '<div class="form-group"><label>Email corporativo *</label><input type="email" id="ef-email" placeholder="carlos@empresa.com" value="' + (v.email||'') + '"></div>' +
      '<div class="form-group"><label>Teléfono</label><input id="ef-phone" placeholder="55 1234 5678" value="' + (v.phone||'') + '"></div>' +
      '</div><div class="form-row">' +
      '<div class="form-group"><label>Título del puesto</label><input id="ef-title" placeholder="Gerente de Ventas" value="' + (v.jobTitle||'') + '"></div>' +
      '<div class="form-group"><label>Puesto (KPIs) *</label>' + sel('ef-pos', posOpts, v.positionId||'') + '</div>' +
      '</div><div class="form-row">' +
      '<div class="form-group"><label>Departamento</label>' + sel('ef-dept', deptOpts, v.department) + '</div>' +
      '<div class="form-group"><label>Fecha de ingreso *</label><input type="date" id="ef-hire" value="' + (v.hireDate||'') + '"></div>' +
      '</div><div class="form-row">' +
      '<div class="form-group"><label>Fecha de nacimiento</label><input type="date" id="ef-bday" value="' + (v.birthDate||'') + '"></div>' +
      '<div class="form-group"><label>Rol / Permisos *</label>' + sel('ef-role', roleOpts, v.roleId) + '</div>' +
      '</div><div class="form-row">' +
      '<div class="form-group"><label>Manager directo</label>' + sel('ef-mgr', mgrOpts, v.managerId) + '</div>' +
      '<div class="form-group"><label>Tipo de empleo</label>' + sel('ef-type', typeOpts, v.contractType||'Planta') + '</div>' +
      '</div><div class="form-row">' +
      '<div class="form-group"><label>País</label>' + sel('ef-country', countryOpts, v.country||'MX') + '</div>' +
      '<div class="form-group"><label>Status</label>' + sel('ef-status', [{value:'activo',label:'Activo'},{value:'inactivo',label:'Inactivo'}], v.status||'activo') + '</div>' +
      '</div>' +
      '<div class="form-group"><label>Notas internas</label><textarea id="ef-notes" placeholder="Notas...">' + (v.notes||'') + '</textarea></div>' +
      '<div class="form-group" style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg);border-radius:6px">' +
      '<input type="checkbox" id="ef-cap" style="width:auto;margin:0"' + (String(v.canApproveVacations)==='true'?' checked':'') + '>' +
      '<label for="ef-cap" style="margin:0;cursor:pointer"><strong>Puede autorizar vacaciones</strong></label></div>';
  },
  saveEmployee: function(id) {
    var data = {
      firstName: (document.getElementById('ef-first')||{value:''}).value.trim(),
      lastName:  (document.getElementById('ef-last') ||{value:''}).value.trim(),
      email:     (document.getElementById('ef-email')||{value:''}).value.trim(),
      phone:     (document.getElementById('ef-phone')||{value:''}).value.trim(),
      jobTitle:   (document.getElementById('ef-title')||{value:''}).value.trim(),
      positionId: (document.getElementById('ef-pos')  ||{value:''}).value,
      department: (document.getElementById('ef-dept') ||{value:''}).value,
      hireDate:   (document.getElementById('ef-hire') ||{value:''}).value,
      birthDate:  (document.getElementById('ef-bday') ||{value:''}).value,
      roleId:     (document.getElementById('ef-role') ||{value:''}).value,
      managerId:  (document.getElementById('ef-mgr')  ||{value:''}).value,
      contractType:(document.getElementById('ef-type')   ||{value:''}).value,
      country:   (document.getElementById('ef-country') ||{value:'MX'}).value,
      status:    (document.getElementById('ef-status')  ||{value:''}).value,
      notes:     (document.getElementById('ef-notes')||{value:''}).value,
      canApproveVacations: !!(document.getElementById('ef-cap')&&document.getElementById('ef-cap').checked)
    };
    if (!data.firstName||!data.lastName||!data.email||!data.roleId||!data.hireDate) {
      APP.toast('Nombre, apellido, email, rol y fecha de ingreso son obligatorios', 'error'); return;
    }
    var action = id ? 'employees.update' : 'employees.create';
    if (id) data.id = id;
    APP.api(action, data, function(err) {
      if (err) { APP.toast(err, 'error'); return; }
      APP.closeModal();
      APP.toast(id ? '✅ Empleado actualizado' : '✅ Empleado creado', 'success');
      EmployeesView.all = []; EmployeesView.load();
    });
  },
  deactivateEmployee: function(id, name) {
    if (!confirm('¿Dar de baja a ' + name + '? Esto marcará al empleado como inactivo.')) return;
    APP.api('employees.deactivate', { id: id }, function(err) {
      if (err) { APP.toast(err, 'error'); return; }
      APP.closeModal(); APP.toast('✅ ' + name + ' dado de baja', 'success');
      EmployeesView.all = []; EmployeesView.load();
    });
  },

  // ── KPI ADMIN ──────────────────────────────────────────────
  openKPIAdmin: function(initialTab) {
    var tabAliases = { periods: 'evaluaciones', schedules: 'evaluaciones', defs: 'kpis' };
    var tab = tabAliases[initialTab] || initialTab || 'kpis';
    var res = {}, pending = 5;
    function done(key, val) { res[key]=val||[]; if(--pending===0){ AdminHR._cachedPositions=res.positions; AdminHR._renderKPIAdmin(res.kpis,res.periods,res.schedules,res.positions,res.report,tab); } }
    APP.api('kpi.definitions.list', {}, function(e,d){ done('kpis',d); });
    APP.api('kpi.periods.list',     {}, function(e,d){ done('periods',d); });
    APP.api('kpi.schedules.list',   {}, function(e,d){ done('schedules',d); });
    APP.api('positions.list',       {}, function(e,d){ done('positions',d); });
    APP.api('kpi.reports.overview', {}, function(e,d){ done('report',d); });
  },
  _renderKPIAdmin: function(kpis, periods, schedules, positions, report, activeTab) {
    var tabs = ['kpis','evaluaciones','reports'];
    var labels = {kpis:'📊 KPIs',evaluaciones:'📅 Evaluaciones',reports:'📈 Reportes'};
    var tabBar = '<div class="tabs" style="margin-bottom:16px">' +
      tabs.map(function(t){ return '<div class="tab'+(t===activeTab?' active':'')+'" onclick="AdminHR.showKPITab(\''+t+'\',this)">'+labels[t]+'</div>'; }).join('') + '</div>';
    AdminHR._cyclePositions = positions;
    AdminHR._cycleKpis = kpis;
    AdminHR._cycleSchedules = schedules;
    APP.modal('⚙️ Administración de KPIs',
      tabBar +
      '<div id="kadmin-kpis"'         + (activeTab!=='kpis'         ?' style="display:none"':'') + '>' + AdminHR._kpiDefsTable(kpis, positions)                          + '</div>' +
      '<div id="kadmin-evaluaciones"' + (activeTab!=='evaluaciones' ?' style="display:none"':'') + '>' + AdminHR._evaluacionesTab(periods, schedules, kpis, positions)    + '</div>' +
      '<div id="kadmin-reports"'      + (activeTab!=='reports'      ?' style="display:none"':'') + '>' + AdminHR._reportsTab(report, periods)                             + '</div>'
    );
    if (activeTab === 'evaluaciones') AdminHR._updateLaunchPreview();
  },
  showKPITab: function(tab, el) {
    document.querySelectorAll('#app-modal .tab').forEach(function(t){t.classList.remove('active');});
    el.classList.add('active');
    ['kpis','evaluaciones','reports'].forEach(function(t){ var e2=document.getElementById('kadmin-'+t); if(e2) e2.style.display=t===tab?'block':'none'; });
    if (tab === 'evaluaciones') AdminHR._updateLaunchPreview();
  },

  // ── REPORTS TAB ────────────────────────────────────────────
  _reportsTab: function(report, periods) {
    if (!report || !report.reviews) return '<div class="empty-state"><span class="material-icons-round">bar_chart</span><p>No hay evaluaciones registradas aún.</p></div>';
    var summaries = report.periodSummaries || [];
    var reviews   = report.reviews || [];
    var periodOpts = '<option value="">— Todos los períodos —</option>' +
      (periods||[]).map(function(p){ return '<option value="'+p.id+'">'+p.name+' ('+p.periodType+')</option>'; }).join('');
    var statusOpts = '<option value="">— Todos los estados —</option>' +
      ['Borrador','En Revisión','Completado'].map(function(s){ return '<option value="'+s+'">'+s+'</option>'; }).join('');
    var summaryTable = summaries.length
      ? '<div class="card mb-16"><div class="card-title">Resumen por período</div><div class="table-wrap"><table><thead><tr><th>Período</th><th>Tipo</th><th>Completadas</th><th>% Avance</th><th>Score prom.</th></tr></thead><tbody>' +
        summaries.map(function(s) {
          var bar = '<div style="background:var(--bg);border-radius:4px;height:6px;width:100px;display:inline-block;vertical-align:middle;margin-left:6px"><div style="background:var(--primary);width:'+s.completionPct+'%;height:6px;border-radius:4px"></div></div>';
          return '<tr><td><strong>'+s.periodName+'</strong></td><td>'+s.periodType+'</td>' +
            '<td>'+s.completed+' / '+s.total+bar+'</td><td><strong>'+s.completionPct+'%</strong></td>' +
            '<td>'+(s.avgScore!==null?'<strong style="color:var(--primary)">'+s.avgScore+'</strong> <span class="text-muted text-xs">'+s.scoreLabel+'</span>':'—')+'</td></tr>';
        }).join('') + '</tbody></table></div></div>' : '';
    var detailTable = '<div class="card"><div class="card-title flex justify-between items-center">Detalle de evaluaciones' +
      '<div class="flex gap-8"><select id="rpt-period" onchange="AdminHR._filterReport()" style="font-size:12px;padding:4px 8px">'+periodOpts+'</select>' +
      '<select id="rpt-status" onchange="AdminHR._filterReport()" style="font-size:12px;padding:4px 8px">'+statusOpts+'</select></div></div>' +
      '<div class="table-wrap"><table id="rpt-table"><thead><tr><th>Empleado</th><th>Departamento</th><th>KPI</th><th>Período</th><th>Self</th><th>Manager</th><th>Final</th><th>Estado</th></tr></thead><tbody id="rpt-tbody">' +
      AdminHR._reportRows(reviews) + '</tbody></table></div></div>';
    return summaryTable + detailTable;
  },
  _reportRows: function(reviews) {
    if (!reviews.length) return '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">Sin resultados</td></tr>';
    return reviews.map(function(r) {
      var statusBadge = r.status==='Completado'?'<span class="badge badge-success">Completado</span>':r.status==='En Revisión'?'<span class="badge badge-warning">En Revisión</span>':'<span class="badge badge-gray">Borrador</span>';
      return '<tr data-period="'+r.periodId+'" data-status="'+r.status+'">' +
        '<td><div class="td-name"><div class="td-avatar">'+APP.initials(r.employeeName)+'</div>'+r.employeeName+'</div></td>' +
        '<td class="text-sm text-muted">'+r.department+'</td>' +
        '<td><strong>'+r.kpiName+'</strong><br><span class="text-xs text-muted">'+r.kpiCategory+' · '+r.kpiWeight+'%</span></td>' +
        '<td class="text-sm">'+r.periodName+'</td>' +
        '<td class="text-sm">'+(r.selfScore!==''&&r.selfScore!==undefined?APP.semLabel(r.selfScore):'—')+'</td>' +
        '<td class="text-sm">'+(r.managerScore!==''&&r.managerScore!==undefined?APP.semLabel(r.managerScore):'—')+'</td>' +
        '<td class="text-sm">'+(r.finalScore!==''&&r.finalScore!==undefined?'<strong>'+APP.semLabel(r.finalScore)+'</strong>':'—')+'</td>' +
        '<td>'+statusBadge+'</td></tr>';
    }).join('');
  },
  _filterReport: function() {
    var periodFilter=(document.getElementById('rpt-period')||{value:''}).value;
    var statusFilter=(document.getElementById('rpt-status')||{value:''}).value;
    document.querySelectorAll('#rpt-tbody tr[data-period]').forEach(function(row){
      var matchP=!periodFilter||row.getAttribute('data-period')===periodFilter;
      var matchS=!statusFilter||row.getAttribute('data-status')===statusFilter;
      row.style.display=(matchP&&matchS)?'':'none';
    });
  },

  // ── EVALUACIONES TAB (Q3 + Q4) ─────────────────────────────
  _evaluacionesTab: function(periods, schedules, kpis, positions) {
    var posOpts = '<option value="">— Todos los puestos —</option>' +
      (positions||[]).map(function(p){ return '<option value="'+p.id+'">'+p.name+'</option>'; }).join('');
    var launcher =
      '<div style="background:var(--bg);border:2px solid var(--primary);border-radius:10px;padding:16px 20px;margin-bottom:24px">' +
        '<div class="font-600 mb-12" style="color:var(--primary)"><span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px">bolt</span>Lanzar ciclo de evaluación</div>' +
        '<div class="form-row" style="margin-bottom:10px">' +
          '<div class="form-group" style="margin-bottom:0"><label style="font-size:12px">Frecuencia</label>' +
          '<select id="lp-type" onchange="AdminHR._updateLaunchPreview()" style="padding:7px 10px">' +
          '<option>Mensual</option><option>Bimestral</option><option>Semestral</option></select></div>' +
          '<div class="form-group" style="margin-bottom:0"><label style="font-size:12px">Puesto (opcional)</label>' +
          '<select id="lp-pos" onchange="AdminHR._updateLaunchPreview()" style="padding:7px 10px">'+posOpts+'</select></div>' +
        '</div>' +
        '<div id="lp-preview" style="margin:10px 0 14px;padding:10px 12px;background:var(--surface);border-radius:6px;font-size:13px"></div>' +
        '<button class="btn btn-primary" onclick="AdminHR.launchCycle()" id="lp-btn">' +
          '<span class="material-icons-round">bolt</span>Lanzar ahora</button>' +
      '</div>';

    var activePeriods = periods.filter(function(p){ return p.status==='activo'; });
    var otherPeriods  = periods.filter(function(p){ return p.status!=='activo'; });
    var allOrdered = activePeriods.concat(otherPeriods);
    var periodRows = !allOrdered.length
      ? '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">Sin períodos creados aún</td></tr>'
      : allOrdered.map(function(p) {
          var actions = '';
          if (p.status==='borrador') actions='<button class="btn btn-primary btn-sm" onclick="AdminHR.openPeriod(\''+p.id+'\')">Abrir</button>';
          else if (p.status==='activo') actions=
            '<button class="btn btn-outline btn-sm" onclick="AdminHR.openExtendPeriod(\''+p.id+'\',\''+(p.endDate||'')+'\',\''+(p.selfAssessmentDeadline||'')+'\',\''+(p.managerReviewDeadline||'')+'\')">Prorrogar</button> ' +
            '<button class="btn btn-outline btn-sm" onclick="AdminHR.closePeriod(\''+p.id+'\')">Cerrar</button>';
          return '<tr><td><strong>'+p.name+'</strong></td><td>'+p.periodType+'</td>' +
            '<td class="text-sm">'+APP.fmtDate(p.startDate)+' → '+APP.fmtDate(p.endDate)+'</td>' +
            '<td>'+APP.badgeStatus(p.status)+'</td><td style="white-space:nowrap">'+actions+'</td></tr>';
        }).join('');
    var periodsSection =
      '<div class="font-600 mb-8" style="font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Historial de períodos</div>' +
      '<div class="table-wrap mb-24"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Fechas</th><th>Estado</th><th></th></tr></thead><tbody>'+periodRows+'</tbody></table></div>';

    var schedulesSection =
      '<div class="font-600 mb-8" style="font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Programaciones automáticas</div>' +
      AdminHR._schedulesTable(schedules, kpis, positions);

    return launcher + periodsSection + schedulesSection;
  },
  _calcLaunchDates: function(type) {
    var today = new Date(); today.setHours(0,0,0,0);
    var end = new Date(today);
    if (type==='Mensual')    { end.setMonth(end.getMonth()+1); end.setDate(0); }
    else if (type==='Bimestral') { end.setMonth(end.getMonth()+2); end.setDate(0); }
    else                         { end.setMonth(end.getMonth()+6); end.setDate(0); }
    var selfDl = new Date(today); selfDl.setDate(selfDl.getDate()+20);
    var mgrDl  = new Date(today); mgrDl.setDate(mgrDl.getDate()+28);
    var fmt = function(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
    return { start:fmt(today), end:fmt(end), selfDl:fmt(selfDl), mgrDl:fmt(mgrDl) };
  },
  _updateLaunchPreview: function() {
    var typeEl = document.getElementById('lp-type');
    var posEl  = document.getElementById('lp-pos');
    var prev   = document.getElementById('lp-preview');
    if (!typeEl || !prev) return;
    var type = typeEl.value;
    var posId = posEl ? posEl.value : '';
    var posName = '';
    if (posId && posEl) { var opt = posEl.options[posEl.selectedIndex]; posName = opt ? opt.text : ''; }
    var MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    var now = new Date();
    var name = 'Evaluación ' + MONTHS[now.getMonth()] + ' ' + now.getFullYear() + (posName && posName.indexOf('Todos')===-1 ? ' — ' + posName : '');
    var d = AdminHR._calcLaunchDates(type);
    var fmtShort = function(s){ var p=s.split('-'); return p[2]+'/'+p[1]+'/'+p[0]; };
    prev.innerHTML =
      '<div style="font-weight:600;margin-bottom:4px">📋 '+name+'</div>' +
      '<div style="color:var(--text-muted);font-size:12px">' +
        '📅 '+fmtShort(d.start)+' → '+fmtShort(d.end) +
        '&nbsp;&nbsp;·&nbsp;&nbsp;⏱ Autocalif.: '+fmtShort(d.selfDl) +
        '&nbsp;&nbsp;·&nbsp;&nbsp;👔 Manager: '+fmtShort(d.mgrDl) +
      '</div>';
    prev._launchData = { name:name, type:type, positionId:posId, dates:d };
  },
  launchCycle: function() {
    var prev = document.getElementById('lp-preview');
    if (!prev || !prev._launchData) { APP.toast('Carga la pestaña de Evaluaciones primero','error'); return; }
    var ld = prev._launchData;
    var btn = document.getElementById('lp-btn');
    if (btn) { btn.disabled=true; btn.textContent='Lanzando...'; }
    var data = {
      name: ld.name, periodType: ld.type, positionId: ld.positionId,
      startDate: ld.dates.start, endDate: ld.dates.end,
      selfAssessmentDeadline: ld.dates.selfDl, managerReviewDeadline: ld.dates.mgrDl,
      status: 'borrador'
    };
    APP.api('kpi.periods.create', data, function(err, period) {
      if (err) { APP.toast(err,'error'); if(btn){btn.disabled=false;btn.innerHTML='<span class="material-icons-round">bolt</span>Lanzar ahora';} return; }
      APP.api('kpi.periods.open', { periodId: period.id }, function(err2) {
        if (err2) { APP.toast('Período creado pero no abierto: '+err2,'warning'); }
        else { APP.toast('✅ '+ld.name+' lanzada — empleados notificados','success'); }
        AdminHR.openKPIAdmin('evaluaciones');
      });
    });
  },
  openPeriod: function(id) {
    APP.api('kpi.periods.open', { periodId: id }, function(err) {
      if (err) { APP.toast(err,'error'); return; }
      APP.toast('✅ Período abierto — empleados notificados','success'); AdminHR.openKPIAdmin();
    });
  },
  openExtendPeriod: function(id, currentEnd, currentSelfDl, currentMgrDl) {
    APP.modal('📅 Prorrogar Período',
      '<div class="alert info mb-16">Solo modifica los campos que quieras extender. Las fechas nuevas deben ser posteriores a las actuales.</div>' +
      '<div class="form-group"><label>Nueva fecha de fin <span class="text-muted text-sm">(actual: '+APP.fmtDate(currentEnd)+')</span></label>' +
      '<input type="date" id="ext-end" value="'+currentEnd+'"></div>' +
      '<div class="form-group"><label>Nuevo límite autocalificación <span class="text-muted text-sm">(actual: '+(currentSelfDl?APP.fmtDate(currentSelfDl):'—')+')</span></label>' +
      '<input type="date" id="ext-self" value="'+(currentSelfDl||'')+'"></div>' +
      '<div class="form-group"><label>Nuevo límite revisión manager <span class="text-muted text-sm">(actual: '+(currentMgrDl?APP.fmtDate(currentMgrDl):'—')+')</span></label>' +
      '<input type="date" id="ext-mgr" value="'+(currentMgrDl||'')+'"></div>',
      '<button class="btn btn-outline" onclick="APP.closeModal()">Cancelar</button>' +
      '<button class="btn btn-primary" onclick="AdminHR.saveExtendPeriod(\''+id+'\',\''+currentEnd+'\')"><span class="material-icons-round">update</span>Guardar prórroga</button>');
  },
  saveExtendPeriod: function(id, originalEnd) {
    var endDate = (document.getElementById('ext-end')||{value:''}).value;
    var selfDl  = (document.getElementById('ext-self')||{value:''}).value;
    var mgrDl   = (document.getElementById('ext-mgr')||{value:''}).value;
    if (endDate && endDate <= originalEnd) { APP.toast('La nueva fecha de fin debe ser posterior a '+APP.fmtDate(originalEnd),'error'); return; }
    var data = { periodId: id };
    if (endDate && endDate!==originalEnd) data.endDate = endDate;
    if (selfDl) data.selfAssessmentDeadline = selfDl;
    if (mgrDl)  data.managerReviewDeadline  = mgrDl;
    if (!data.endDate && !data.selfAssessmentDeadline && !data.managerReviewDeadline) { APP.toast('No hay cambios para guardar','error'); return; }
    APP.api('kpi.periods.extend', data, function(err) {
      if (err) { APP.toast(err,'error'); return; }
      APP.closeModal(); APP.toast('✅ Período prorrogado','success'); AdminHR.openKPIAdmin('periods');
    });
  },
  closePeriod: function(id) {
    if (!confirm('¿Cerrar este período? Ya no se podrán enviar autocalificaciones.')) return;
    APP.api('kpi.periods.close', { periodId: id }, function(err) {
      if (err) { APP.toast(err,'error'); return; }
      APP.toast('✅ Período cerrado','success'); AdminHR.openKPIAdmin();
    });
  },

  // ── KPI DEFINITIONS ────────────────────────────────────────
  _withRoles: function(cb) {
    if (AdminHR._cachedRoles && AdminHR._cachedRoles.length) { cb(AdminHR._cachedRoles); return; }
    APP.api('roles.list', {}, function(err, roles) { AdminHR._cachedRoles=roles||[]; cb(AdminHR._cachedRoles); });
  },
  _withPositions: function(cb) {
    if (AdminHR._cachedPositions && AdminHR._cachedPositions.length) { cb(AdminHR._cachedPositions); return; }
    APP.api('positions.list', {}, function(err, pos) { AdminHR._cachedPositions=pos||[]; cb(AdminHR._cachedPositions); });
  },
  _buildRoleOpts: function(roles, includeAll) {
    var placeholder = includeAll ? '— Todos los roles —' : '— Selecciona un rol —';
    return [{value:'',label:placeholder}].concat((roles||[]).map(function(r){return{value:r.id,label:r.name};}));
  },
  _buildPositionOpts: function(positions, includeAll) {
    var placeholder = includeAll ? '— Todos los puestos —' : '— Selecciona un puesto —';
    return [{value:'',label:placeholder}].concat((positions||[]).map(function(p){return{value:p.id,label:p.name};}));
  },
  _kpiDefsTable: function(kpis, positions) {
    var posNames = {'':'Sin puesto específico'};
    (positions||AdminHR._cachedPositions||[]).forEach(function(p){posNames[p.id]=p.name;});
    var groups={}, order=[];
    kpis.forEach(function(k){ var pId=k.positionId||''; if(!groups[pId]){groups[pId]=[];order.push(pId);} groups[pId].push(k); });
    var html = '<div class="flex justify-between items-center mb-16"><span class="font-600">'+kpis.length+' KPIs configurados</span>' +
      '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-outline btn-sm" onclick="AdminHR.openNewKPIDef()"><span class="material-icons-round">add</span>Uno</button>' +
      '<button class="btn btn-primary btn-sm" onclick="AdminHR.openBatchKPI()"><span class="material-icons-round">playlist_add</span>Agregar por Puesto</button>' +
      '</div></div>';
    if (!kpis.length) return html+'<div style="text-align:center;padding:32px;color:var(--text-muted)"><span class="material-icons-round" style="font-size:48px;display:block;margin-bottom:8px">analytics</span>Sin KPIs configurados.</div>';
    order.forEach(function(pId) {
      var pKpis=groups[pId];
      var tw=pKpis.reduce(function(s,k){return s+(parseFloat(k.weight)||0);},0);
      var wCol=tw===100?'var(--success)':tw>100?'var(--danger)':'var(--warning)';
      html+='<div style="margin-bottom:20px"><div class="flex justify-between items-center mb-8"><span class="font-600 text-sm">'+(posNames[pId]||pId||'Sin puesto')+'</span>' +
        '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:11px;color:'+wCol+';font-weight:600">Peso total: '+tw+'%</span>' +
        '<button class="btn btn-outline btn-sm" onclick="AdminHR.openBatchKPI(\''+pId+'\')"><span class="material-icons-round" style="font-size:14px">add</span>Agregar</button></div></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Período</th><th>Peso</th><th>Meta</th><th>Estado</th><th></th></tr></thead><tbody>' +
        pKpis.map(function(k){
          return '<tr><td><strong>'+k.name+'</strong>'+(k.category?'<br><span class="text-xs text-muted">'+k.category+'</span>':'')+
            '</td><td>'+k.periodType+'</td><td><strong>'+k.weight+'%</strong></td><td>'+(k.target||'—')+'</td>' +
            '<td>'+(String(k.isActive)==='true'?'<span class="badge badge-success">Activo</span>':'<span class="badge badge-gray">Inactivo</span>')+'</td>' +
            '<td><button class="btn btn-outline btn-sm" onclick="AdminHR.openEditKPI(\''+k.id+'\')">Editar</button></td></tr>';
        }).join('')+'</tbody></table></div></div>';
    });
    return html;
  },
  openNewKPIDef: function() {
    AdminHR._withPositions(function(positions) {
      APP.modal('➕ Nuevo KPI', AdminHR._kpiForm(null, AdminHR._buildPositionOpts(positions,true)),
        '<button class="btn btn-outline" onclick="AdminHR.openKPIAdmin()">← Volver</button>' +
        '<button class="btn btn-primary" onclick="AdminHR.saveKPI(null)"><span class="material-icons-round">save</span>Guardar KPI</button>');
    });
  },
  openEditKPI: function(id) {
    APP.api('kpi.definitions.list', {}, function(err, kpis) {
      var kpi=(kpis||[]).filter(function(k){return k.id===id;})[0];
      if (!kpi) { APP.toast('KPI no encontrado','error'); return; }
      AdminHR._withPositions(function(positions) {
        APP.modal('✏️ Editar KPI: '+kpi.name, AdminHR._kpiForm(kpi, AdminHR._buildPositionOpts(positions,true)),
          '<button class="btn btn-outline" onclick="AdminHR.openKPIAdmin()">← Volver</button>' +
          '<button class="btn btn-primary" onclick="AdminHR.saveKPI(\''+id+'\')"><span class="material-icons-round">save</span>Guardar cambios</button>');
      });
    });
  },
  _kpiForm: function(kpi, posOpts) {
    var v=kpi||{};
    var sel=function(id,opts,val){ return '<select id="'+id+'">'+opts.map(function(o){return '<option value="'+o.value+'"'+(String(o.value)===String(val)?' selected':'')+'>'+o.label+'</option>';}).join('')+'</select>'; };
    var MONTHS=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    var active=[]; try{var raw=v.activeMonths;active=(!raw||raw==='all')?MONTHS:JSON.parse(raw);}catch(e){active=MONTHS;}
    var checks=MONTHS.map(function(m){return '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap"><input type="checkbox" class="kf-month" value="'+m+'"'+(active.indexOf(m)>-1?' checked':'')+' style="width:auto;margin:0" onchange="AdminHR._updateMonthAll()"> <span style="font-size:12px">'+m.substring(0,3)+'</span></label>';}).join('');
    return '<div class="form-row">' +
      '<div class="form-group"><label>Nombre *</label><input id="kf-name" value="'+(v.name||'')+'" placeholder="Cuota mensual de ventas"></div>' +
      '<div class="form-group"><label>Categoría</label><input id="kf-cat" value="'+(v.category||'')+'" placeholder="Ventas, Productividad..."></div>' +
      '</div><div class="form-row">' +
      '<div class="form-group"><label>Período</label>'+sel('kf-period',[{value:'Mensual',label:'Mensual'},{value:'Bimestral',label:'Bimestral'},{value:'Semestral',label:'Semestral'}],v.periodType||'Mensual')+'</div>' +
      '<div class="form-group"><label>Peso (%) *</label><input type="number" id="kf-weight" min="1" max="100" value="'+(v.weight||20)+'"></div>' +
      '</div><div class="form-row">' +
      '<div class="form-group"><label>Meta</label><input id="kf-target" value="'+(v.target||'')+'" placeholder="Entregar 100% de pedidos, Tasa 90%..."></div>' +
      '<div class="form-group"><label>Aplica al puesto</label>'+sel('kf-pos',posOpts,v.positionId||'')+'</div>' +
      '</div>' +
      '<div class="form-group"><label>Descripción</label><textarea id="kf-desc" rows="2" placeholder="Breve descripción del KPI y cómo se mide...">'+(v.description||'')+'</textarea></div>' +
      '<div class="form-group"><label>Instrucciones para el empleado</label><textarea id="kf-inst" placeholder="Cómo medir este KPI...">'+(v.instructions||'')+'</textarea></div>' +
      '<div class="form-group"><label>Meses en que aplica</label>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><label style="display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="kf-month-all"'+(active.length===12?' checked':'')+' style="width:auto;margin:0" onchange="AdminHR._toggleAllMonths(this.checked)"><strong style="font-size:12px">Todos</strong></label></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px">'+checks+'</div></div>';
  },
  _toggleAllMonths: function(checked) { document.querySelectorAll('.kf-month').forEach(function(el){el.checked=checked;}); },
  _updateMonthAll: function() {
    var all=document.querySelectorAll('.kf-month'); var chk=document.querySelectorAll('.kf-month:checked');
    var allEl=document.getElementById('kf-month-all'); if(allEl) allEl.checked=all.length===chk.length;
  },
  saveKPI: function(id) {
    var months=[]; document.querySelectorAll('.kf-month:checked').forEach(function(el){months.push(el.value);});
    var activeMonths=months.length===12||months.length===0?'all':JSON.stringify(months);
    var data = {
      name:(document.getElementById('kf-name')||{value:''}).value.trim(),
      category:(document.getElementById('kf-cat')||{value:''}).value.trim(),
      description:(document.getElementById('kf-desc')||{value:''}).value.trim(),
      periodType:(document.getElementById('kf-period')||{value:''}).value,
      weight:(document.getElementById('kf-weight')||{value:''}).value,
      target:(document.getElementById('kf-target')||{value:''}).value.trim(),
      positionId:(document.getElementById('kf-pos')||{value:''}).value,
      activeMonths:activeMonths,
      instructions:(document.getElementById('kf-inst')||{value:''}).value.trim(),
      isActive:true
    };
    if (!data.name||!data.weight) { APP.toast('Nombre y peso son obligatorios','error'); return; }
    if (id) data.id=id;
    APP.api(id?'kpi.definitions.update':'kpi.definitions.create', data, function(err) {
      if (err) { APP.toast(err,'error'); return; }
      APP.toast(id?'✅ KPI actualizado':'✅ KPI creado','success'); AdminHR.openKPIAdmin();
    });
  },
  openBatchKPI: function(prePos) {
    var res={}, pending=2;
    function done(k,v){res[k]=v;if(--pending===0)_render();}
    APP.api('kpi.definitions.list',{},function(err,d){if(err){APP.toast(err,'error');return;}done('kpis',d||[]);});
    AdminHR._withPositions(function(p){done('positions',p);});
    function _render() {
      var kpis=res.kpis; var positions=res.positions;
      AdminHR._allKPIs=kpis; AdminHR._cachedPositions=positions;
      var posOpts=AdminHR._buildPositionOpts(positions,true);
      var posSel='<select id="bk-pos" onchange="AdminHR.updateBatchPositionInfo()" style="width:100%">'+posOpts.map(function(o){return '<option value="'+o.value+'"'+(o.value===(prePos||'')?'  selected':'')+'>'+o.label+'</option>';}).join('')+'</select>';
      var s='style="padding:5px 6px;font-size:12px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);width:100%"';
      AdminHR._batchRowStyle=s;
      AdminHR._batchPeriodOpts='<option>Mensual</option><option>Bimestral</option><option>Semestral</option>';
      var body='<div class="form-group" style="margin-bottom:12px"><label>Puesto al que aplican los KPIs</label>'+posSel+'</div>' +
        '<div id="bk-pos-info" style="margin-bottom:14px"></div>' +
        '<div class="flex justify-between items-center mb-8"><span class="font-600 text-sm">Nuevos KPIs</span>' +
        '<button class="btn btn-outline btn-sm" onclick="AdminHR.addBatchRow()"><span class="material-icons-round">add</span>Agregar fila</button></div>' +
        '<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse"><thead>' +
        '<tr style="border-bottom:2px solid var(--border)"><th style="text-align:left;padding:4px 6px;min-width:180px">Nombre *</th>' +
        '<th style="text-align:left;padding:4px 6px;min-width:110px">Período</th>' +
        '<th style="text-align:left;padding:4px 6px;min-width:65px">Peso %</th><th style="text-align:left;padding:4px 6px;min-width:100px">Meta</th>' +
        '<th style="width:30px"></th></tr></thead><tbody id="bk-rows"></tbody></table></div>' +
        '<div id="bk-weight-info" style="margin-top:10px;font-size:12px"></div>';
      APP.modal('Agregar KPIs por Puesto', body,
        '<button class="btn btn-outline" onclick="AdminHR.openKPIAdmin()">← Volver</button>' +
        '<button class="btn btn-primary" onclick="AdminHR.saveBatchKPIs()"><span class="material-icons-round">save</span>Guardar todos</button>');
      var modalEl=document.querySelector('#app-modal .modal'); if(modalEl) modalEl.style.maxWidth='760px';
      AdminHR.updateBatchPositionInfo(); AdminHR.addBatchRow(); AdminHR.addBatchRow(); AdminHR.addBatchRow();
    }
  },
  addBatchRow: function() {
    var tbody=document.getElementById('bk-rows'); if(!tbody) return;
    var s=AdminHR._batchRowStyle||''; var po=AdminHR._batchPeriodOpts||'<option>Mensual</option>';
    var tr=document.createElement('tr'); tr.style.borderBottom='1px solid var(--border)';
    tr.innerHTML='<td style="padding:4px 4px"><input class="bk-name" placeholder="Nombre del KPI" '+s+' oninput="AdminHR.updateBatchWeightTotal()"></td>' +
      '<td style="padding:4px 4px"><select class="bk-period" '+s+'>'+po+'</select></td>' +
      '<td style="padding:4px 4px"><input type="number" class="bk-weight" min="1" max="100" value="20" style="width:58px;padding:5px 4px;font-size:12px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)" oninput="AdminHR.updateBatchWeightTotal()"></td>' +
      '<td style="padding:4px 4px"><input class="bk-target" placeholder="Meta" '+s+'></td>' +
      '<td style="padding:4px 2px;text-align:center"><button onclick="this.closest(\'tr\').remove();AdminHR.updateBatchWeightTotal()" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:2px 4px"><span class="material-icons-round" style="font-size:15px">close</span></button></td>';
    tbody.appendChild(tr);
  },
  updateBatchPositionInfo: function() {
    var posEl=document.getElementById('bk-pos'); var infoEl=document.getElementById('bk-pos-info'); if(!posEl||!infoEl) return;
    var pId=posEl.value;
    var existing=(AdminHR._allKPIs||[]).filter(function(k){return(k.positionId||'')===pId;});
    if (!existing.length) { infoEl.innerHTML='<div style="font-size:12px;color:var(--text-muted);padding:8px 10px;background:var(--bg);border-radius:6px">Sin KPIs para este puesto aún.</div>'; }
    else {
      var tw=existing.reduce(function(s,k){return s+(parseFloat(k.weight)||0);},0);
      var wCol=tw>=100?'var(--danger)':tw>=80?'var(--warning)':'var(--success)';
      infoEl.innerHTML='<div style="font-size:12px;background:var(--bg);border-radius:6px;padding:8px 10px">' +
        '<div class="flex justify-between mb-6"><span class="font-600">KPIs existentes para este puesto</span><span style="color:'+wCol+';font-weight:600">Peso acumulado: '+tw+'%</span></div>' +
        existing.map(function(k){return '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)"><span>'+k.name+'</span><span style="font-weight:600">'+k.weight+'%</span></div>';}).join('')+'</div>';
    }
    AdminHR.updateBatchWeightTotal();
  },
  updateBatchWeightTotal: function() {
    var posEl=document.getElementById('bk-pos'); var infoEl=document.getElementById('bk-weight-info'); if(!posEl||!infoEl) return;
    var pId=posEl.value;
    var existW=(AdminHR._allKPIs||[]).filter(function(k){return(k.positionId||'')===pId;}).reduce(function(s,k){return s+(parseFloat(k.weight)||0);},0);
    var newW=0; document.querySelectorAll('.bk-weight').forEach(function(el){newW+=parseFloat(el.value||0)||0;});
    var total=existW+newW;
    var col=total===100?'var(--success)':total>100?'var(--danger)':'var(--text-muted)';
    var msg=total===100?'✅ Peso total: 100% — perfecto':total>100?'⚠️ Peso total: '+total+'% — excede 100%':'Peso total: '+total+'%';
    infoEl.innerHTML='<span style="color:'+col+';font-weight:'+(total>=100?'600':'400')+'">'+msg+'</span>';
  },
  saveBatchKPIs: function() {
    var posEl=document.getElementById('bk-pos'); if(!posEl) return;
    var positionId=posEl.value; var toSave=[];
    document.querySelectorAll('#bk-rows tr').forEach(function(tr) {
      var name=(tr.querySelector('.bk-name')||{value:''}).value.trim(); if(!name) return;
      toSave.push({ name:name, periodType:(tr.querySelector('.bk-period')||{value:'Mensual'}).value,
        weight:(tr.querySelector('.bk-weight')||{value:'20'}).value, target:(tr.querySelector('.bk-target')||{value:''}).value.trim(), positionId:positionId, isActive:true });
    });
    if (!toSave.length) { APP.toast('Agrega al menos un KPI con nombre','error'); return; }
    var saveBtn=document.querySelector('#app-modal .modal-footer .btn-primary');
    if (saveBtn) { saveBtn.disabled=true; saveBtn.textContent='Guardando '+toSave.length+'...'; }
    var saved=0, failed=0;
    function saveNext(i) {
      if (i>=toSave.length) { APP.toast((failed?'':'✅ ')+saved+' KPI(s) creado(s)'+(failed?', '+failed+' error(es)':''),failed?'warning':'success'); AdminHR.openKPIAdmin('defs'); return; }
      APP.api('kpi.definitions.create',toSave[i],function(err){if(err)failed++;else saved++;saveNext(i+1);});
    }
    saveNext(0);
  },

  // ── SCHEDULES ──────────────────────────────────────────────
  _schedulesTable: function(schedules, kpis, positions) {
    var posNames={}; (positions||AdminHR._cachedPositions||[]).forEach(function(p){posNames[p.id]=p.name;});
    var freqIcon={Mensual:'🗓',Bimestral:'📆',Semestral:'📅'};
    var html='<div class="flex justify-between items-center mb-12"><div><span class="font-600">'+schedules.length+' programación(es)</span>' +
      '<span class="text-xs text-muted" style="display:block;margin-top:2px">Se activan automáticamente según la configuración</span></div>' +
      '<button class="btn btn-primary btn-sm" onclick="AdminHR.openNewSchedule()"><span class="material-icons-round">add</span>Nueva programación</button></div>';
    if (!schedules.length) return html+'<div style="text-align:center;padding:32px;color:var(--text-muted)"><span class="material-icons-round" style="font-size:48px;display:block;margin-bottom:8px">schedule</span>Sin programaciones.</div>';
    html+='<div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Aplica a</th><th>Frecuencia</th><th>Día</th><th>Plazos</th><th>Estado</th><th>Próxima</th><th></th></tr></thead><tbody>';
    schedules.forEach(function(s) {
      var isActive=String(s.isActive)==='true';
      var next=AdminHR._calcNextDate(s.dayOfMonth,s.periodType,s.lastActivatedAt);
      var target=s.positionId?(posNames[s.positionId]||s.positionId):(s.department||'Todos');
      html+='<tr><td><strong>'+s.name+'</strong></td><td><span class="badge badge-gray">'+target+'</span></td>' +
        '<td>'+(freqIcon[s.periodType]||'')+' '+s.periodType+'</td><td>Día <strong>'+s.dayOfMonth+'</strong></td>' +
        '<td><span class="text-xs">Auto: '+(s.selfAssessmentDays||25)+'d<br>Mgr: '+(s.managerReviewDays||30)+'d</span></td>' +
        '<td>'+(isActive?'<span class="badge badge-success">Activa</span>':'<span class="badge badge-gray">Inactiva</span>')+'</td>' +
        '<td>'+(isActive?'<span class="text-sm font-600" style="color:var(--primary)">'+APP.fmtDate(next)+'</span>':'<span class="text-muted text-sm">—</span>')+'</td>' +
        '<td style="white-space:nowrap"><button class="btn btn-outline btn-sm" onclick="AdminHR.openEditSchedule(\''+s.id+'\')">Editar</button> ' +
        '<button class="btn btn-primary btn-sm" onclick="AdminHR.runScheduleNow(\''+s.id+'\',\''+s.name+'\')"><span class="material-icons-round" style="font-size:14px">play_arrow</span></button></td></tr>';
    });
    return html+'</tbody></table></div>';
  },
  _calcNextDate: function(dayOfMonth, periodType, lastActivatedAt) {
    var today=new Date(); var day=Math.max(1,Math.min(28,parseInt(dayOfMonth)||1));
    var windowDays={Mensual:27,Bimestral:54,Semestral:170}; var skip=false;
    if (lastActivatedAt){var last=new Date(lastActivatedAt);var win=(windowDays[periodType]||27)*86400000;skip=!isNaN(last.getTime())&&(today.getTime()-last.getTime())<win;}
    var next=new Date(today.getFullYear(),today.getMonth(),day);
    if (skip||next<=today){var ma=periodType==='Semestral'?6:periodType==='Bimestral'?2:1;next.setMonth(next.getMonth()+ma);}
    return next.toISOString().split('T')[0];
  },
  openNewSchedule: function() {
    var res={},pending=2;
    function done(k,v){res[k]=v;if(--pending===0)APP.modal('⏰ Nueva Programación',AdminHR._scheduleForm(null,res.kpis,res.positions),'<button class="btn btn-outline" onclick="AdminHR.openKPIAdmin(\'schedules\')">← Volver</button><button class="btn btn-primary" onclick="AdminHR.saveSchedule(null)"><span class="material-icons-round">save</span>Crear</button>');}
    APP.api('kpi.definitions.list',{},function(e,d){done('kpis',d||[]);});
    AdminHR._withPositions(function(p){done('positions',p);});
  },
  openEditSchedule: function(id) {
    APP.api('kpi.schedules.list',{},function(err,schedules){
      var s=(schedules||[]).filter(function(x){return x.id===id;})[0];
      if(!s){APP.toast('Programación no encontrada','error');return;}
      var res={},pending=2;
      function done(k,v){res[k]=v;if(--pending===0)APP.modal('✏️ Editar: '+s.name,AdminHR._scheduleForm(s,res.kpis,res.positions),'<button class="btn btn-outline" onclick="AdminHR.openKPIAdmin(\'schedules\')">← Volver</button><button class="btn btn-primary" onclick="AdminHR.saveSchedule(\''+id+'\')"><span class="material-icons-round">save</span>Guardar</button>');}
      APP.api('kpi.definitions.list',{},function(e,d){done('kpis',d||[]);});
      AdminHR._withPositions(function(p){done('positions',p);});
    });
  },
  _scheduleForm: function(s, kpis, positions) {
    var v=s||{};
    var posOpts=[{value:'',label:'— Todos los empleados activos —'}].concat((positions||AdminHR._cachedPositions||[]).map(function(p){return{value:p.id,label:p.name};}));
    var sel=function(id,opts,val){return '<select id="'+id+'">'+opts.map(function(o){return '<option value="'+o.value+'"'+(String(o.value)===String(val||'')?'  selected':'')+'>'+o.label+'</option>';}).join('')+'</select>';};
    var selectedIds=[]; try{selectedIds=JSON.parse(v.kpiDefinitionIds||'[]');}catch(e){}
    var kpiChecks=kpis.length
      ?kpis.filter(function(k){return String(k.isActive)==='true';}).map(function(k){var chk=selectedIds.indexOf(k.id)>-1?' checked':'';return '<label style="display:flex;align-items:center;gap:6px;margin-bottom:6px;cursor:pointer"><input type="checkbox" class="sched-kpi-check" value="'+k.id+'"'+chk+' style="width:auto"><span class="text-sm"><strong>'+k.name+'</strong> <span class="text-muted">('+k.periodType+' · '+k.weight+'%)</span></span></label>';}).join('')
      :'<span class="text-muted text-sm">No hay KPIs configurados aún.</span>';
    return '<div class="form-group"><label>Nombre *</label><input id="sf-name" value="'+(v.name||'')+'" placeholder="Evaluación Mensual Ventas"></div>' +
      '<div class="form-row"><div class="form-group"><label>Aplica a (puesto)</label>'+sel('sf-pos',posOpts,v.positionId)+'</div>' +
      '<div class="form-group"><label>Frecuencia</label>'+sel('sf-freq',[{value:'Mensual',label:'Mensual'},{value:'Bimestral',label:'Bimestral'},{value:'Semestral',label:'Semestral'}],v.periodType||'Mensual')+'</div></div>' +
      '<div class="form-row"><div class="form-group"><label>Día del mes *</label><input type="number" id="sf-day" min="1" max="28" value="'+(v.dayOfMonth||1)+'"></div>' +
      '<div class="form-group"></div></div>' +
      '<div class="form-row"><div class="form-group"><label>Días para autocalificación</label><input type="number" id="sf-self" min="1" max="60" value="'+(v.selfAssessmentDays||25)+'"></div>' +
      '<div class="form-group"><label>Días para revisión manager</label><input type="number" id="sf-mgr" min="1" max="60" value="'+(v.managerReviewDays||30)+'"></div></div>' +
      '<div class="form-group"><label>KPIs a incluir</label><div style="max-height:160px;overflow-y:auto;padding:8px;border:1px solid var(--border);border-radius:6px">'+kpiChecks+'</div></div>' +
      (s?'<div class="form-group" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="sf-active" style="width:auto"'+(String(v.isActive)==='true'?' checked':'')+' ><label for="sf-active" style="margin:0">Programación activa</label></div>':'');
  },
  saveSchedule: function(id) {
    var name=(document.getElementById('sf-name')||{value:''}).value.trim();
    var positionId=(document.getElementById('sf-pos')||{value:''}).value;
    var freq=(document.getElementById('sf-freq')||{value:'Mensual'}).value;
    var day=parseInt((document.getElementById('sf-day')||{value:'1'}).value)||1;
    var selfD=parseInt((document.getElementById('sf-self')||{value:'25'}).value)||25;
    var mgrD=parseInt((document.getElementById('sf-mgr')||{value:'30'}).value)||30;
    var active=id?((document.getElementById('sf-active')||{checked:true}).checked):true;
    var kpiIds=[]; document.querySelectorAll('.sched-kpi-check:checked').forEach(function(cb){kpiIds.push(cb.value);});
    if (!name){APP.toast('El nombre es obligatorio','error');return;}
    if (day<1||day>28){APP.toast('El día debe estar entre 1 y 28','error');return;}
    var data={name:name,positionId:positionId,periodType:freq,dayOfMonth:day,selfAssessmentDays:selfD,managerReviewDays:mgrD,kpiDefinitionIds:kpiIds,isActive:active};
    if (id) data.id=id;
    APP.api(id?'kpi.schedules.update':'kpi.schedules.create',data,function(err){
      if(err){APP.toast(err,'error');return;}
      APP.toast(id?'✅ Programación actualizada':'✅ Programación creada','success'); AdminHR.openKPIAdmin('schedules');
    });
  },
  runScheduleNow: function(id, name) {
    if (!confirm('¿Ejecutar "'+name+'" ahora? Esto creará un período activo y notificará a los empleados.')) return;
    APP.api('kpi.schedules.runNow',{id:id},function(err,result){
      if(err){APP.toast(err,'error');return;}
      APP.toast('✅ '+(result.name||name)+' ejecutada — '+(result.employees||0)+' empleado(s), '+(result.kpis||0)+' KPI(s)','success');
      AdminHR.openKPIAdmin('schedules');
    });
  },

  // ── ROLES ──────────────────────────────────────────────────
  openRolesAdmin: function() {
    APP.api('roles.list',{},function(err,roles){
      if(err){APP.toast(err,'error');return;}
      AdminHR._cachedRoles=roles||[];
      var PERM_LABELS={admin:'Admin',hr:'RRHH',manager:'Manager',employee:'Empleado'};
      var PERM_COLORS={admin:'var(--danger)',hr:'var(--primary)',manager:'var(--warning)',employee:'var(--text-muted)'};
      var rows=(roles||[]).map(function(r){
        var perms=[]; try{perms=JSON.parse(r.permissions||'[]');}catch(e){}
        var badges=perms.map(function(p){return '<span style="font-size:10px;padding:2px 6px;border-radius:10px;background:var(--bg);color:'+(PERM_COLORS[p]||'var(--text)')+';border:1px solid var(--border);margin-right:3px">'+(PERM_LABELS[p]||p)+'</span>';}).join('');
        return '<tr><td><strong>'+r.name+'</strong>'+(r.department?'<br><span class="text-xs text-muted">'+r.department+'</span>':'')+'</td>' +
          '<td>'+badges+'</td><td style="text-align:right;white-space:nowrap">' +
          '<button class="btn btn-outline btn-sm" onclick="AdminHR.openEditRole(\''+r.id+'\')" style="margin-right:4px">Editar</button>' +
          '<button class="btn btn-outline btn-sm" onclick="AdminHR.deleteRole(\''+r.id+'\',\''+r.name.replace(/'/g,"\\'")+'\')" style="color:var(--danger)">Eliminar</button></td></tr>';
      }).join('');
      APP.modal('🏷️ Administrar Roles',
        '<div class="flex justify-between items-center mb-12"><span class="font-600">'+(roles||[]).length+' roles configurados</span>' +
        '<button class="btn btn-primary btn-sm" onclick="AdminHR.openNewRole()"><span class="material-icons-round">add</span>Nuevo Rol</button></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Permisos</th><th></th></tr></thead><tbody>' +
        (rows||'<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">Sin roles configurados</td></tr>') +
        '</tbody></table></div>');
    });
  },
  _roleForm: function(role) {
    var v=role||{};
    var perms=[]; try{perms=JSON.parse(v.permissions||'[]');}catch(e){}
    var permCheck=function(p,label){var chk=perms.indexOf(p)>-1?' checked':'';return '<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" class="role-perm" value="'+p+'"'+chk+' style="width:auto"><span>'+label+'</span></label>';};
    return '<div class="form-row">' +
      '<div class="form-group"><label>Nombre del rol *</label><input id="rf-name" value="'+(v.name||'')+'" placeholder="Gerente de Marketing"></div>' +
      '<div class="form-group"><label>Departamento</label><input id="rf-dept" value="'+(v.department||'')+'" placeholder="Marketing"></div>' +
      '</div><div class="form-group"><label>Descripción</label><input id="rf-desc" value="'+(v.description||'')+'" placeholder="Descripción breve del puesto"></div>' +
      '<div class="form-group"><label>Permisos del sistema</label><div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:6px">' +
        permCheck('admin','Administrador (acceso total)')+permCheck('hr','RRHH (gestión de personal)')+
        permCheck('manager','Manager (aprobar vacaciones, revisar KPIs)')+permCheck('employee','Empleado (acceso básico)') +
      '</div></div>';
  },
  openNewRole: function() {
    APP.modal('➕ Nuevo Rol',AdminHR._roleForm(null),
      '<button class="btn btn-outline" onclick="AdminHR.openRolesAdmin()">← Volver</button>' +
      '<button class="btn btn-primary" onclick="AdminHR.saveRole(null)"><span class="material-icons-round">save</span>Crear Rol</button>');
  },
  openEditRole: function(id) {
    APP.api('roles.list',{},function(err,roles){
      var role=(roles||[]).filter(function(r){return r.id===id;})[0];
      if(!role){APP.toast('Rol no encontrado','error');return;}
      APP.modal('✏️ Editar: '+role.name,AdminHR._roleForm(role),
        '<button class="btn btn-outline" onclick="AdminHR.openRolesAdmin()">← Volver</button>' +
        '<button class="btn btn-primary" onclick="AdminHR.saveRole(\''+id+'\')"><span class="material-icons-round">save</span>Guardar cambios</button>');
    });
  },
  saveRole: function(id) {
    var name=(document.getElementById('rf-name')||{value:''}).value.trim();
    if (!name){APP.toast('El nombre del rol es obligatorio','error');return;}
    var perms=[]; document.querySelectorAll('.role-perm:checked').forEach(function(el){perms.push(el.value);});
    if (!perms.length){APP.toast('Selecciona al menos un permiso','error');return;}
    var data={name:name,department:(document.getElementById('rf-dept')||{value:''}).value.trim(),description:(document.getElementById('rf-desc')||{value:''}).value.trim(),permissions:perms};
    if (id) data.id=id;
    APP.api(id?'roles.update':'roles.create',data,function(err){
      if(err){APP.toast(err,'error');return;}
      AdminHR._cachedRoles=null;
      APP.toast(id?'✅ Rol actualizado':'✅ Rol creado','success'); AdminHR.openRolesAdmin();
    });
  },
  deleteRole: function(id, name) {
    if (!confirm('¿Eliminar el rol "'+name+'"? Solo se puede si ningún empleado activo lo tiene asignado.')) return;
    APP.api('roles.remove',{id:id},function(err){
      if(err){APP.toast(err,'error');return;}
      AdminHR._cachedRoles=null; APP.toast('✅ Rol eliminado','success'); AdminHR.openRolesAdmin();
    });
  },

  // ── PUESTOS ────────────────────────────────────────────────
  openPositionsAdmin: function() {
    APP.api('positions.list',{},function(err,positions){
      if(err){APP.toast(err,'error');return;}
      AdminHR._cachedPositions=positions||[];
      var deptOpts=['Dirección','Sales','Sales Operations','Operations','INT OPS','Nodalink','Ikan Hub','RH','Marketing'];
      var rows=(positions||[]).map(function(p){
        var isActive=p.status!=='inactivo';
        return '<tr><td><strong>'+p.name+'</strong>'+(p.description?'<br><span class="text-xs text-muted">'+p.description+'</span>':'')+'</td>' +
          '<td>'+(p.department||'—')+'</td>' +
          '<td>'+(isActive?'<span class="badge badge-success">Activo</span>':'<span class="badge badge-gray">Inactivo</span>')+'</td>' +
          '<td style="text-align:right;white-space:nowrap">' +
          '<button class="btn btn-outline btn-sm" onclick="AdminHR.openEditPosition(\''+p.id+'\')" style="margin-right:4px">Editar</button>' +
          '<button class="btn btn-outline btn-sm" onclick="AdminHR.deletePosition(\''+p.id+'\',\''+p.name.replace(/'/g,"\\'")+'\')" style="color:var(--danger)">Eliminar</button></td></tr>';
      }).join('');
      APP.modal('💼 Configurar Puestos',
        '<div class="flex justify-between items-center mb-12"><span class="font-600">'+(positions||[]).length+' puestos configurados</span>' +
        '<button class="btn btn-primary btn-sm" onclick="AdminHR.openNewPosition()"><span class="material-icons-round">add</span>Nuevo Puesto</button></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Departamento</th><th>Estado</th><th></th></tr></thead><tbody>' +
        (rows||'<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Sin puestos configurados</td></tr>') +
        '</tbody></table></div>' +
        '<div style="margin-top:12px;padding:10px 12px;background:var(--bg);border-radius:6px;font-size:12px;color:var(--text-muted)">' +
        '💡 Los puestos definen qué KPIs aplican a cada empleado. Los roles controlan los permisos de acceso a la plataforma.</div>');
    });
  },
  _positionForm: function(pos) {
    var v=pos||{};
    var sel=function(id,opts,val){ return '<select id="'+id+'">'+opts.map(function(o){return '<option value="'+o.value+'"'+(String(o.value)===String(val)?' selected':'')+'>'+o.label+'</option>';}).join('')+'</select>'; };
    var deptOpts=[{value:'',label:'— Sin departamento —'}].concat(['Dirección','Sales','Sales Operations','Operations','INT OPS','Nodalink','Ikan Hub','RH','Marketing'].map(function(d){return{value:d,label:d};}));
    return '<div class="form-group"><label>Nombre del puesto *</label><input id="pf-name" value="'+(v.name||'')+'" placeholder="Ej: Ejecutivo de Ventas, Analista de Operaciones..."></div>' +
      '<div class="form-group"><label>Departamento</label>'+sel('pf-dept',deptOpts,v.department||'')+'</div>' +
      '<div class="form-group"><label>Descripción</label><input id="pf-desc" value="'+(v.description||'')+'" placeholder="Breve descripción del puesto"></div>' +
      (pos?'<div class="form-group" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="pf-active" style="width:auto"'+(pos.status!=='inactivo'?' checked':'')+' ><label for="pf-active" style="margin:0">Puesto activo</label></div>':'');
  },
  openNewPosition: function() {
    APP.modal('➕ Nuevo Puesto', AdminHR._positionForm(null),
      '<button class="btn btn-outline" onclick="AdminHR.openPositionsAdmin()">← Volver</button>' +
      '<button class="btn btn-primary" onclick="AdminHR.savePosition(null)"><span class="material-icons-round">save</span>Crear Puesto</button>');
  },
  openEditPosition: function(id) {
    APP.api('positions.list',{},function(err,positions){
      var pos=(positions||[]).filter(function(p){return p.id===id;})[0];
      if(!pos){APP.toast('Puesto no encontrado','error');return;}
      APP.modal('✏️ Editar: '+pos.name, AdminHR._positionForm(pos),
        '<button class="btn btn-outline" onclick="AdminHR.openPositionsAdmin()">← Volver</button>' +
        '<button class="btn btn-primary" onclick="AdminHR.savePosition(\''+id+'\')"><span class="material-icons-round">save</span>Guardar cambios</button>');
    });
  },
  savePosition: function(id) {
    var name=(document.getElementById('pf-name')||{value:''}).value.trim();
    if (!name){APP.toast('El nombre del puesto es obligatorio','error');return;}
    var data={
      name:name,
      department:(document.getElementById('pf-dept')||{value:''}).value,
      description:(document.getElementById('pf-desc')||{value:''}).value.trim()
    };
    if (id) {
      data.id=id;
      var activeEl=document.getElementById('pf-active');
      data.status=(!activeEl||activeEl.checked)?'activo':'inactivo';
    }
    APP.api(id?'positions.update':'positions.create',data,function(err){
      if(err){APP.toast(err,'error');return;}
      AdminHR._cachedPositions=null;
      APP.toast(id?'✅ Puesto actualizado':'✅ Puesto creado','success'); AdminHR.openPositionsAdmin();
    });
  },
  deletePosition: function(id, name) {
    if (!confirm('¿Eliminar el puesto "'+name+'"? Solo se puede si ningún empleado activo lo tiene asignado.')) return;
    APP.api('positions.remove',{id:id},function(err){
      if(err){APP.toast(err,'error');return;}
      AdminHR._cachedPositions=null; APP.toast('✅ Puesto eliminado','success'); AdminHR.openPositionsAdmin();
    });
  },

  // ── COMUNICADOS ────────────────────────────────────────────
  openAnnouncementsAdmin: function() {
    APP.api('announcements.list',{},function(err,items){
      APP.modal('📢 Administrar Comunicados',
        '<div class="flex justify-between items-center mb-12"><span class="font-600">'+(items||[]).length+' comunicados activos</span>' +
        '<button class="btn btn-primary btn-sm" onclick="AdminHR.openNewAnnouncement()"><span class="material-icons-round">add</span>Nuevo</button></div>' +
        (items||[]).map(function(a){
          return '<div class="request-card mt-8"><div>'+(a.pinned?'<span style="color:var(--warning)">📌 </span>':'')+
            '<strong class="text-sm">'+a.title+'</strong>' +
            '<p class="text-xs text-muted mt-4">'+(a.body||'').substring(0,80)+'...</p>' +
            '<p class="text-xs text-muted">'+APP.fmtDate((a.publishedAt||'').split('T')[0])+' · '+(a.authorName||'')+'</p></div>' +
            '<button class="btn btn-outline btn-sm" onclick="AdminHR.removeAnnouncement(\''+a.id+'\')">Archivar</button></div>';
        }).join(''));
    });
  },
  openNewAnnouncement: function() {
    APP.modal('📢 Nuevo Comunicado',
      '<div class="form-group"><label>Título *</label><input id="af-title" placeholder="Aviso importante para el equipo"></div>' +
      '<div class="form-group"><label>Contenido *</label><textarea id="af-body" rows="5" placeholder="Escribe el contenido del comunicado..."></textarea></div>' +
      '<div class="form-row"><div class="form-group"><label>Audiencia</label><select id="af-audience"><option value="all">Toda la empresa</option></select></div>' +
      '<div class="form-group"><label>Expiración (opcional)</label><input type="date" id="af-expires"></div></div>' +
      '<div class="form-group" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="af-pinned" style="width:auto"><label for="af-pinned" style="margin:0">Fijar al inicio</label></div>',
      '<button class="btn btn-outline" onclick="APP.closeModal()">Cancelar</button>' +
      '<button class="btn btn-primary" onclick="AdminHR.saveAnnouncement()"><span class="material-icons-round">send</span>Publicar</button>');
  },
  saveAnnouncement: function() {
    var data={
      title:(document.getElementById('af-title')||{value:''}).value.trim(),
      body:(document.getElementById('af-body')||{value:''}).value.trim(),
      targetAudience:(document.getElementById('af-audience')||{value:'all'}).value,
      expiresAt:(document.getElementById('af-expires')||{value:''}).value,
      pinned:(document.getElementById('af-pinned')||{checked:false}).checked,
      status:'publicado'
    };
    if(!data.title||!data.body){APP.toast('Título y contenido son obligatorios','error');return;}
    APP.api('announcements.create',data,function(err){
      if(err){APP.toast(err,'error');return;}
      APP.closeModal(); APP.toast('✅ Comunicado publicado','success'); APP.data=null;
    });
  },
  removeAnnouncement: function(id) {
    if (!confirm('¿Archivar este comunicado?')) return;
    APP.api('announcements.remove',{id:id},function(err){
      if(err){APP.toast(err,'error');return;}
      APP.toast('Comunicado archivado','info'); AdminHR.openAnnouncementsAdmin();
    });
  },

  openSystemConfig: function() {
    APP.api('email.getEnabled', {}, function(err, val) {
      var enabled = (val !== 'false');
      var bgColor = enabled ? 'var(--primary)' : '#94a3b8';
      var knobTransform = enabled ? 'translateX(20px)' : 'translateX(0)';
      var checked = enabled ? ' checked' : '';
      var labelText = enabled ? 'Activo' : 'Inactivo';
      var emailAddr = APP.user.email || '—';
      var html =
        '<div style="padding:4px 0">' +
        '<div class="card mb-12" style="padding:16px">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px">' +
            '<div>' +
              '<div style="font-weight:600;margin-bottom:4px">Notificaciones por correo</div>' +
              '<div style="font-size:13px;color:var(--text-muted)">Activa o desactiva todos los correos del sistema</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:10px;flex-shrink:0">' +
              '<span id="cfg-email-label" style="font-size:13px">' + labelText + '</span>' +
              '<label style="position:relative;display:inline-block;width:46px;height:26px;cursor:pointer">' +
                '<input type="checkbox" id="cfg-email-cb"' + checked + ' style="opacity:0;width:0;height:0;position:absolute" onchange="AdminHR.saveEmailEnabled(this.checked)">' +
                '<span id="cfg-toggle-bg" style="position:absolute;inset:0;background:' + bgColor + ';border-radius:26px;transition:background .2s">' +
                  '<span id="cfg-toggle-knob" style="position:absolute;height:20px;width:20px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:transform .2s;transform:' + knobTransform + '"></span>' +
                '</span>' +
              '</label>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="card" style="padding:16px">' +
          '<div style="font-weight:600;margin-bottom:4px">Correo de prueba</div>' +
          '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Se enviará a <strong>' + emailAddr + '</strong></div>' +
          '<button class="btn btn-outline" id="cfg-test-btn" onclick="AdminHR.sendTestEmail()">' +
            '<span class="material-icons-round">send</span>Enviar correo de prueba' +
          '</button>' +
          '<div id="cfg-test-result" style="margin-top:8px;font-size:13px"></div>' +
        '</div>' +
        '</div>';
      APP.modal('Configuración del sistema', html,
        '<button class="btn btn-primary" onclick="APP.closeModal()">Cerrar</button>');
    });
  },

  saveEmailEnabled: function(enabled) {
    APP.api('email.setEnabled', { enabled: enabled }, function(err) {
      if (err) { APP.toast(err, 'error'); return; }
      var label = document.getElementById('cfg-email-label');
      var bg    = document.getElementById('cfg-toggle-bg');
      var knob  = document.getElementById('cfg-toggle-knob');
      if (label) label.textContent = enabled ? 'Activo' : 'Inactivo';
      if (bg)    bg.style.background = enabled ? 'var(--primary)' : '#94a3b8';
      if (knob)  knob.style.transform = enabled ? 'translateX(20px)' : 'translateX(0)';
      APP.toast(enabled ? 'Correos activados' : 'Correos desactivados', 'success');
    });
  },

  sendTestEmail: function() {
    var btn    = document.getElementById('cfg-test-btn');
    var result = document.getElementById('cfg-test-result');
    if (btn)    btn.disabled = true;
    if (result) result.textContent = 'Enviando...';
    APP.api('email.test', {}, function(err, data) {
      if (btn) btn.disabled = false;
      var el = document.getElementById('cfg-test-result');
      if (err) {
        if (el) el.innerHTML = '<span style="color:var(--danger)">Error: ' + err + '</span>';
        return;
      }
      if (el) el.innerHTML = '<span style="color:var(--success)">✅ Enviado a ' + ((data && data.sentTo) || APP.user.email) + '</span>';
    });
  }
};

// ── BIRTHDAYS VIEW ────────────────────────────────────────────
var BirthdaysView = {
  load: function() {
    var el = document.getElementById('bday-content'); if (!el) return;
    el.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    APP.api('birthdays.annual', {}, function(err, data) {
      if (err) { APP.toast(err,'error'); return; }
      el.innerHTML = BirthdaysView.render(data);
    });
  },
  render: function(d) {
    var now = new Date();
    var months = d.monthNames;
    var html = '';
    for (var m = 1; m <= 12; m++) {
      var people = d.calendar[m] || [];
      var isCurrent = m === now.getMonth() + 1;
      html += '<div class="card mb-16" style="' + (isCurrent ? 'border:2px solid var(--primary)' : '') + '">' +
        '<div class="card-title">' + (isCurrent ? '📅 ' : '') + months[m-1] + ' <span class="badge badge-gray">' + people.length + '</span></div>';
      if (!people.length) html += '<p class="text-muted text-sm">Sin cumpleaños este mes</p>';
      else html += '<div class="bday-list">' + people.map(function(b) {
        return '<div class="bday-item' + (b.isToday?' today':'') + '">' +
          '<div class="bday-avatar">' + APP.initials(b.fullName) + '</div>' +
          '<div><div class="bday-name">' + b.fullName + (b.isToday?' 🎂':'') + '</div>' +
          '<div class="bday-info">Día ' + b.dayOfMonth + ' · ' + b.department + '</div></div>' +
          '<div class="bday-days">' + (b.isToday ? '¡Hoy!' : (b.daysUntil > 0 ? 'en ' + b.daysUntil + 'd' : '')) + '</div></div>';
      }).join('') + '</div>';
      html += '</div>';
    }
    return html;
  }
};

// ── TEAM VIEW ─────────────────────────────────────────────────
var TeamView = {
  load: function() {
    var el = document.getElementById('team-content'); if (!el) return;
    el.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    APP.api('teams.list', {}, function(err, teams) {
      if (err) { el.innerHTML = '<div class="empty-state"><p>' + err + '</p></div>'; return; }
      teams = (teams||[]).filter(function(t){ return t.status !== 'inactivo'; });
      var canManage = APP.user.isAdmin || APP.user.isHR;
      var html = '<div class="flex justify-between items-center mb-16">' +
        '<span class="font-600">' + teams.length + ' equipo(s)</span>' +
        (canManage ? '<button class="btn btn-primary btn-sm" onclick="TeamView.openNewTeam()"><span class="material-icons-round">add</span>Nuevo equipo</button>' : '') +
        '</div>';
      if (!teams.length) {
        html += '<div class="empty-state"><span class="material-icons-round">group</span><p>No hay equipos creados aún.' + (canManage ? '<br><button class="btn btn-primary mt-12" onclick="TeamView.openNewTeam()">+ Crear primer equipo</button>' : '') + '</p></div>';
      } else {
        html += '<div class="emp-grid">' + teams.map(function(t) {
          var isMyTeam = APP.user.ledTeams.indexOf(t.id) > -1 || APP.user.coledTeams.indexOf(t.id) > -1;
          return '<div class="emp-card" onclick="TeamView.openDetail(\'' + t.id + '\')" style="cursor:pointer">' +
            '<div class="emp-avatar" style="background:var(--primary)">' +
              '<span class="material-icons-round" style="font-size:22px;color:#fff">group</span>' +
            '</div>' +
            '<div class="emp-name">' + t.name + (isMyTeam ? ' <span style="font-size:10px;background:var(--primary);color:#fff;padding:1px 6px;border-radius:10px;vertical-align:middle">Mi equipo</span>' : '') + '</div>' +
            '<div class="emp-title text-muted text-sm">' + (t.leaderName || 'Sin líder') + '</div>' +
            '<div class="emp-dept text-muted text-sm">' + (t.memberCount || 0) + ' miembro(s)</div>' +
          '</div>';
        }).join('') + '</div>';
      }
      el.innerHTML = html;
    });
  },

  openDetail: function(id) {
    APP.api('teams.get', { id: id }, function(err, team) {
      if (err) { APP.toast(err, 'error'); return; }
      APP.api('teams.members', { teamId: id }, function(err2, members) {
        if (err2) { APP.toast(err2, 'error'); return; }
        var canManage = APP.user.isAdmin || APP.user.isHR ||
          APP.user.ledTeams.indexOf(id) > -1 || APP.user.coledTeams.indexOf(id) > -1;
        var memberCards = (members||[]).map(function(m) {
          var badge = m.isLeader ? '<span style="font-size:10px;background:var(--primary);color:#fff;padding:1px 6px;border-radius:10px">Líder</span>' :
                      m.isCoLeader ? '<span style="font-size:10px;background:var(--warning);color:#fff;padding:1px 6px;border-radius:10px">Co-Líder</span>' : '';
          return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">' +
            '<div class="emp-avatar" style="width:36px;height:36px;font-size:13px;flex-shrink:0">' + APP.initials(m.fullName) + '</div>' +
            '<div style="flex:1"><div class="font-600 text-sm">' + m.fullName + ' ' + badge + '</div>' +
            '<div class="text-xs text-muted">' + (m.jobTitle||'—') + ' · ' + (m.department||'—') + '</div></div>' +
            (canManage ? '<button onclick="TeamView.removeMember(\'' + id + '\',\'' + m.id + '\',\'' + m.fullName.replace(/'/g,"\\'") + '\')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:2px 6px" title="Quitar del equipo"><span class="material-icons-round" style="font-size:16px">person_remove</span></button>' : '') +
          '</div>';
        }).join('');
        var body =
          (team.description ? '<p class="text-sm text-muted mb-12">' + team.description + '</p>' : '') +
          '<div style="margin-bottom:16px">' + (memberCards || '<p class="text-muted text-sm">Sin miembros aún.</p>') + '</div>' +
          (canManage ? '<button class="btn btn-outline btn-sm" onclick="TeamView.openAddMember(\'' + id + '\')"><span class="material-icons-round">person_add</span>Agregar miembro</button>' : '');
        var footer =
          '<button class="btn btn-outline" onclick="APP.closeModal()">Cerrar</button>' +
          (canManage ? '<button class="btn btn-primary" onclick="TeamView.openEditTeam(\'' + id + '\')"><span class="material-icons-round">edit</span>Editar equipo</button>' : '');
        APP.modal('🤝 ' + team.name, body, footer);
      });
    });
  },

  openNewTeam: function() {
    AdminHR._withPositions(function() {
      APP.api('employees.list', {}, function(err, emps) {
        var active = (emps||[]).filter(function(e){ return e.status==='activo'||!e.status; });
        APP.modal('➕ Nuevo Equipo', TeamView._teamForm(null, active),
          '<button class="btn btn-outline" onclick="APP.closeModal()">Cancelar</button>' +
          '<button class="btn btn-primary" onclick="TeamView.saveTeam(null)"><span class="material-icons-round">save</span>Crear equipo</button>');
      });
    });
  },

  openEditTeam: function(id) {
    APP.api('teams.get', { id: id }, function(err, team) {
      if (err) { APP.toast(err, 'error'); return; }
      APP.api('employees.list', {}, function(err2, emps) {
        var active = (emps||[]).filter(function(e){ return e.status==='activo'||!e.status; });
        APP.modal('✏️ Editar: ' + team.name, TeamView._teamForm(team, active),
          '<button class="btn btn-outline" onclick="TeamView.openDetail(\'' + id + '\')">← Volver</button>' +
          '<button class="btn btn-primary" onclick="TeamView.saveTeam(\'' + id + '\')"><span class="material-icons-round">save</span>Guardar</button>');
      });
    });
  },

  _teamForm: function(team, employees) {
    var v = team || {};
    var empOpts = [{value:'',label:'— Sin asignar —'}].concat(employees.map(function(e){
      return { value: e.id, label: (e.firstName||'') + ' ' + (e.lastName||'') };
    }));
    var sel = function(id, opts, val) {
      return '<select id="' + id + '">' + opts.map(function(o){
        return '<option value="' + o.value + '"' + (o.value === (val||'') ? ' selected' : '') + '>' + o.label + '</option>';
      }).join('') + '</select>';
    };
    return '<div class="form-group"><label>Nombre del equipo *</label><input id="tf-name" value="' + (v.name||'') + '" placeholder="Ej: Equipo de Ventas LATAM"></div>' +
      '<div class="form-group"><label>Descripción</label><input id="tf-desc" value="' + (v.description||'') + '" placeholder="Objetivo o descripción del equipo"></div>' +
      '<div class="form-row">' +
        '<div class="form-group"><label>Líder</label>' + sel('tf-leader', empOpts, v.leaderId||'') + '</div>' +
        '<div class="form-group"><label>Co-Líder</label>' + sel('tf-coleader', empOpts, v.coLeaderId||'') + '</div>' +
      '</div>' +
      (team ? '<div class="form-group" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="tf-active" style="width:auto"' + (v.status!=='inactivo'?' checked':'') + '><label for="tf-active" style="margin:0">Equipo activo</label></div>' : '');
  },

  saveTeam: function(id) {
    var name = (document.getElementById('tf-name')||{value:''}).value.trim();
    if (!name) { APP.toast('El nombre del equipo es obligatorio', 'error'); return; }
    var data = {
      name: name,
      description: (document.getElementById('tf-desc')||{value:''}).value.trim(),
      leaderId:   (document.getElementById('tf-leader')||{value:''}).value,
      coLeaderId: (document.getElementById('tf-coleader')||{value:''}).value
    };
    if (id) {
      data.id = id;
      var activeEl = document.getElementById('tf-active');
      data.status = (!activeEl || activeEl.checked) ? 'activo' : 'inactivo';
    }
    APP.api(id ? 'teams.update' : 'teams.create', data, function(err, team) {
      if (err) { APP.toast(err, 'error'); return; }
      APP.toast(id ? '✅ Equipo actualizado' : '✅ Equipo creado', 'success');
      APP.closeModal();
      TeamView.load();
      if (id) setTimeout(function(){ TeamView.openDetail(id); }, 400);
    });
  },

  openAddMember: function(teamId) {
    APP.api('employees.list', {}, function(err, emps) {
      APP.api('teams.members', { teamId: teamId }, function(err2, current) {
        var currentIds = (current||[]).map(function(m){ return m.id; });
        var available = (emps||[]).filter(function(e){
          return (e.status==='activo'||!e.status) && currentIds.indexOf(e.id) === -1;
        });
        if (!available.length) { APP.toast('Todos los empleados activos ya son miembros de este equipo', 'info'); return; }
        var sel = '<select id="add-member-sel" style="width:100%">' +
          available.map(function(e){ return '<option value="' + e.id + '">' + (e.firstName||'') + ' ' + (e.lastName||'') + ' (' + (e.department||'—') + ')</option>'; }).join('') + '</select>';
        APP.modal('👤 Agregar miembro',
          '<div class="form-group"><label>Empleado</label>' + sel + '</div>',
          '<button class="btn btn-outline" onclick="TeamView.openDetail(\'' + teamId + '\')">← Volver</button>' +
          '<button class="btn btn-primary" onclick="TeamView.addMember(\'' + teamId + '\')"><span class="material-icons-round">person_add</span>Agregar</button>');
      });
    });
  },

  addMember: function(teamId) {
    var empId = (document.getElementById('add-member-sel')||{value:''}).value;
    if (!empId) return;
    APP.api('teams.addMember', { teamId: teamId, employeeId: empId }, function(err) {
      if (err) { APP.toast(err, 'error'); return; }
      APP.toast('✅ Miembro agregado', 'success');
      TeamView.openDetail(teamId);
    });
  },

  removeMember: function(teamId, empId, empName) {
    if (!confirm('¿Quitar a ' + empName + ' del equipo?')) return;
    APP.api('teams.removeMember', { teamId: teamId, employeeId: empId }, function(err) {
      if (err) { APP.toast(err, 'error'); return; }
      APP.toast('✅ Miembro quitado', 'success');
      TeamView.openDetail(teamId);
    });
  }
};

// ── ADMIN VIEW ────────────────────────────────────────────────
var AdminView = {
  load: function() {
    var el = document.getElementById('content'); if (!el) return;
    if (!APP.user || (!APP.user.isAdmin && !APP.user.isHR)) {
      APP.toast('Acceso restringido a administradores', 'error'); APP.navigate('dashboard'); return;
    }
    var res = {}, pending = 2;
    function done(k, v) {
      res[k] = v;
      if (--pending !== 0) return;
      var empCount     = (res.employees||[]).filter(function(e){return e.status==='activo';}).length;
      var pendingVacs  = (res.vacations||[]).filter(function(v){return v.status==='pendiente';}).length;
      var html =
        '<div class="view active" id="view-admin">' +
        '<div class="view-title"><span class="material-icons-round">admin_panel_settings</span>Panel de Administración</div>' +
        '<div class="grid grid-4 mb-20">' +
          '<div class="card stat-card" onclick="APP.navigate(\'employees\')" style="cursor:pointer">' +
            '<div class="stat-icon blue"><span class="material-icons-round">people</span></div>' +
            '<div><div class="stat-value">'+empCount+'</div><div class="stat-label">Empleados activos</div></div></div>' +
          '<div class="card stat-card" onclick="AdminHR.openKPIAdmin()" style="cursor:pointer">' +
            '<div class="stat-icon green"><span class="material-icons-round">analytics</span></div>' +
            '<div><div class="stat-value" id="admin-kpi-count">—</div><div class="stat-label">KPIs configurados</div></div></div>' +
          '<div class="card stat-card" onclick="APP.navigate(\'vacations\');setTimeout(function(){VacationsView.loadTeamRequests()},400)" style="cursor:pointer">' +
            '<div class="stat-icon orange"><span class="material-icons-round">event_available</span></div>' +
            '<div><div class="stat-value">'+pendingVacs+'</div><div class="stat-label">Solicitudes pendientes</div></div></div>' +
          '<div class="card stat-card" onclick="AdminHR.openRolesAdmin()" style="cursor:pointer">' +
            '<div class="stat-icon red"><span class="material-icons-round">badge</span></div>' +
            '<div><div class="stat-value" id="admin-role-count">—</div><div class="stat-label">Roles configurados</div></div></div>' +
          '<div class="card stat-card" onclick="AdminHR.openPositionsAdmin()" style="cursor:pointer">' +
            '<div class="stat-icon purple"><span class="material-icons-round">work</span></div>' +
            '<div><div class="stat-value" id="admin-pos-count">—</div><div class="stat-label">Puestos configurados</div></div></div>' +
        '</div>' +
        '<div class="grid grid-3 gap-16">' +
          '<div class="card">' +
            '<div class="card-title"><span class="material-icons-round" style="margin-right:6px">person_add</span>Empleados</div>' +
            '<p class="text-sm text-muted mb-12">Gestiona el directorio de personal, crea y edita perfiles.</p>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
              '<button class="btn btn-primary btn-sm" onclick="AdminHR.openNewEmployee()"><span class="material-icons-round">add</span>Nuevo</button>' +
              '<button class="btn btn-outline btn-sm" onclick="APP.navigate(\'employees\')"><span class="material-icons-round">list</span>Ver todos</button>' +
            '</div></div>' +
          '<div class="card">' +
            '<div class="card-title"><span class="material-icons-round" style="margin-right:6px">analytics</span>KPIs &amp; Evaluaciones</div>' +
            '<p class="text-sm text-muted mb-12">Crea definiciones, abre períodos y revisa reportes.</p>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
              '<button class="btn btn-primary btn-sm" onclick="AdminHR.openKPIAdmin()"><span class="material-icons-round">tune</span>Administrar</button>' +
              '<button class="btn btn-outline btn-sm" onclick="AdminHR.openKPIAdmin(\'reports\')"><span class="material-icons-round">bar_chart</span>Reportes</button>' +
            '</div></div>' +
          '<div class="card">' +
            '<div class="card-title"><span class="material-icons-round" style="margin-right:6px">work</span>Puestos</div>' +
            '<p class="text-sm text-muted mb-12">Define los puestos de trabajo y qué KPIs aplica a cada uno.</p>' +
            '<button class="btn btn-primary btn-sm" onclick="AdminHR.openPositionsAdmin()"><span class="material-icons-round">settings</span>Configurar Puestos</button>' +
          '</div>' +
          '<div class="card">' +
            '<div class="card-title"><span class="material-icons-round" style="margin-right:6px">badge</span>Roles</div>' +
            '<p class="text-sm text-muted mb-12">Configura roles del sistema y sus permisos de acceso.</p>' +
            '<button class="btn btn-primary btn-sm" onclick="AdminHR.openRolesAdmin()"><span class="material-icons-round">settings</span>Administrar Roles</button>' +
          '</div>' +
          '<div class="card">' +
            '<div class="card-title"><span class="material-icons-round" style="margin-right:6px">campaign</span>Comunicados</div>' +
            '<p class="text-sm text-muted mb-12">Publica avisos y comunicados para toda la empresa.</p>' +
            '<button class="btn btn-primary btn-sm" onclick="AdminHR.openAnnouncementsAdmin()"><span class="material-icons-round">add_comment</span>Nuevo Comunicado</button>' +
          '</div>' +
          '<div class="card">' +
            '<div class="card-title"><span class="material-icons-round" style="margin-right:6px">schedule</span>Programaciones</div>' +
            '<p class="text-sm text-muted mb-12">Automatiza la apertura de períodos de evaluación.</p>' +
            '<button class="btn btn-primary btn-sm" onclick="AdminHR.openKPIAdmin(\'schedules\')"><span class="material-icons-round">event_repeat</span>Ver Programaciones</button>' +
          '</div>' +
          '<div class="card">' +
            '<div class="card-title"><span class="material-icons-round" style="margin-right:6px">event_available</span>Aprobaciones</div>' +
            '<p class="text-sm text-muted mb-12">Revisa y aprueba solicitudes de vacaciones.</p>' +
            '<button class="btn btn-primary btn-sm" onclick="APP.navigate(\'vacations\');setTimeout(function(){VacationsView.loadTeamRequests()},400)">' +
              '<span class="material-icons-round">checklist</span>Ver solicitudes' +
            '</button></div>' +
        '</div></div>';
      var existAdmin = document.getElementById('view-admin');
      if (existAdmin) existAdmin.remove();
      var view = document.createElement('div');
      view.innerHTML = html;
      el.appendChild(view.firstChild);
      document.querySelectorAll('.view').forEach(function(v){v.classList.remove('active');});
      document.getElementById('view-admin').classList.add('active');
      APP.api('kpi.definitions.list',{},function(err,defs){var e=document.getElementById('admin-kpi-count');if(e)e.textContent=(defs||[]).length;});
      APP.api('roles.list',{},function(err,roles){var e=document.getElementById('admin-role-count');if(e)e.textContent=(roles||[]).length;});
      APP.api('positions.list',{},function(err,pos){var e=document.getElementById('admin-pos-count');if(e)e.textContent=(pos||[]).length;});
    }
    APP.api('employees.list',    {}, function(err,d){done('employees',d||[]);});
    APP.api('vacations.teamList',{}, function(err,d){done('vacations',d||[]);});
  }
};

// ── ADMIN ELEMENT CODES ───────────────────────────────────────
// Solo admins/HR ven los códigos naranja en cada elemento.
// Esquema: A=sidebar, H=header, D=dashboard, E=empleados,
//          O=organigrama, K=kpis, V=vacaciones, B=cumpleaños,
//          C=comunicados, X=admin, M=modal
var CODES = {
  _tagged: [],
  _obs: null,
  _timer: null,

  start: function() {
    if (!APP.user || (!APP.user.isAdmin && !APP.user.isHR)) return;
    document.body.classList.add('show-codes');
    var self = this;
    this._obs = new MutationObserver(function(muts) {
      var hasNew = muts.some(function(m) {
        return Array.from(m.addedNodes).some(function(n) { return n.nodeType === 1; });
      });
      if (!hasNew) return;
      clearTimeout(self._timer);
      self._timer = setTimeout(function() { self._run(); }, 120);
    });
    this._obs.observe(document.body, { childList: true, subtree: true });
    this._run();
  },

  _clear: function() {
    this._tagged.forEach(function(el) { el.removeAttribute('data-code'); });
    this._tagged = [];
  },

  _tag: function(el, code) {
    if (!el || el.getAttribute('data-code')) return;
    el.setAttribute('data-code', code);
    this._tagged.push(el);
  },

  _run: function() {
    this._clear();
    this._labelSidebar();
    this._labelHeader();
    this._labelMain();
    this._labelModal();
  },

  _labelSidebar: function() {
    document.querySelectorAll('#sidebar .nav-item').forEach(function(el, i) {
      CODES._tag(el, 'A' + (i + 1));
    });
  },

  _labelHeader: function() {
    var n = 1;
    document.querySelectorAll('#header button, #header .btn').forEach(function(el) {
      CODES._tag(el, 'H' + n++);
    });
  },

  _labelMain: function() {
    var view = APP.currentView || 'dashboard';
    var prefix = {
      dashboard: 'D', employees: 'E', orgchart: 'O', kpis: 'K',
      vacations: 'V', birthdays: 'B', teams: 'T', announcements: 'C', admin: 'X'
    }[view] || 'Z';
    var main = document.getElementById('main');
    if (!main) return;
    var n = 1;
    main.querySelectorAll(
      '.view-title, .stat-card, .card, .emp-card, .kpi-card, ' +
      '.form-group, button, th, h2, h3, .tab-btn, .nav-tab'
    ).forEach(function(el) {
      CODES._tag(el, prefix + n++);
    });
  },

  _labelModal: function() {
    var modal = document.querySelector('#modal-root .modal');
    if (!modal) return;
    var n = 1;
    modal.querySelectorAll('h3, h4, .form-group, button, .card, th').forEach(function(el) {
      CODES._tag(el, 'M' + n++);
    });
  }
};

// ── INIT ──────────────────────────────────────────────────────
// scripts.js loads with strategy="afterInteractive" — DOM is already
// ready, so we call APP.init() directly instead of waiting for 'load'.
APP.init();
