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
    'orgchart.setLevel':       ['orgchart.flat','orgchart.get'],
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
    flush: function() { _store = {}; },
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

// ── MINI CALENDAR ────────────────────────────────────────────
var MiniCal = {
  _el: null, _onSelect: null, _year: null, _month: null, _selected: null,
  show: function(anchorEl, dateStr, onSelect) {
    MiniCal._onSelect = onSelect;
    MiniCal._selected = dateStr || '';
    var d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
    MiniCal._year = d.getFullYear(); MiniCal._month = d.getMonth();
    MiniCal._render(); MiniCal._position(anchorEl);
    setTimeout(function() { document.addEventListener('click', MiniCal._outside, true); }, 10);
  },
  hide: function() {
    if (MiniCal._el) { MiniCal._el.remove(); MiniCal._el = null; }
    document.removeEventListener('click', MiniCal._outside, true);
  },
  _outside: function(e) { if (MiniCal._el && !MiniCal._el.contains(e.target)) MiniCal.hide(); },
  _nav: function(dir) {
    MiniCal._month += dir;
    if (MiniCal._month > 11) { MiniCal._month = 0; MiniCal._year++; }
    if (MiniCal._month < 0)  { MiniCal._month = 11; MiniCal._year--; }
    MiniCal._render();
  },
  _pick: function(ds) {
    MiniCal._selected = ds;
    if (MiniCal._onSelect) MiniCal._onSelect(ds);
    MiniCal.hide();
  },
  _render: function() {
    if (!MiniCal._el) {
      MiniCal._el = document.createElement('div');
      MiniCal._el.onclick = function(e) { e.stopPropagation(); };
      MiniCal._el.style.cssText = 'position:fixed;z-index:10000;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.18);padding:12px;width:232px';
      document.body.appendChild(MiniCal._el);
    }
    var y = MiniCal._year, m = MiniCal._month;
    var MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    var DAYS = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'];
    var first = new Date(y, m, 1);
    var startDow = (first.getDay() + 6) % 7;
    var dim = new Date(y, m + 1, 0).getDate();
    var today = new Date(); today.setHours(0,0,0,0);
    var fmt2 = function(n) { return String(n).padStart(2,'0'); };
    var todayStr = today.getFullYear()+'-'+fmt2(today.getMonth()+1)+'-'+fmt2(today.getDate());
    var cells = DAYS.map(function(d) {
      return '<div style="font-size:10px;font-weight:700;color:var(--text-muted);text-align:center;padding:3px 0">' + d + '</div>';
    }).join('');
    for (var i = 0; i < startDow; i++) cells += '<div></div>';
    for (var day = 1; day <= dim; day++) {
      var ds = y+'-'+fmt2(m+1)+'-'+fmt2(day);
      var sel = ds === MiniCal._selected, tod = ds === todayStr;
      var bg = sel ? 'var(--primary)' : 'transparent';
      var color = sel ? '#fff' : 'var(--text)';
      var border = (tod && !sel) ? '1px solid var(--primary)' : '1px solid transparent';
      cells += '<div onclick="MiniCal._pick(\''+ds+'\')" style="cursor:pointer;text-align:center;border-radius:6px;padding:5px 2px;font-size:13px;font-weight:'+(sel?'700':'400')+';background:'+bg+';color:'+color+';border:'+border+'">'+day+'</div>';
    }
    MiniCal._el.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
        '<button onclick="MiniCal._nav(-1)" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:20px;line-height:1;padding:0 4px">‹</button>' +
        '<span style="font-size:13px;font-weight:700;color:var(--text)">'+MONTHS[m]+' '+y+'</span>' +
        '<button onclick="MiniCal._nav(1)"  style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:20px;line-height:1;padding:0 4px">›</button>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">'+cells+'</div>';
  },
  _position: function(anchor) {
    var r = anchor.getBoundingClientRect();
    var top = r.bottom + 6, left = r.left;
    if (left + 232 > window.innerWidth - 8) left = window.innerWidth - 240;
    if (top + 290 > window.innerHeight - 8) top = r.top - 296;
    MiniCal._el.style.top = top + 'px'; MiniCal._el.style.left = left + 'px';
  }
};

// ── APP CORE ─────────────────────────────────────────────────
var APP = {
  user: null,
  data: null,
  impersonateId: null,

  api: function(action, data, cb) {
    data = data || {};
    if (APP.impersonateId) data._impersonateAs = APP.impersonateId;
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

  apiPromise: function(action, data) {
    return new Promise(function(resolve, reject) {
      APP.api(action, data, function(err, result) {
        if (err) reject(new Error(err)); else resolve(result);
      });
    });
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
    kpis: 'KPIs & Evaluaciones', 'kpi-reports': 'Reportes KPI por Área',
    vacations: 'Vacaciones', 'vac-calendar': 'Calendario de Vacaciones', 'vac-history': 'Historial de Vacaciones', 'vac-balance': 'Concentrado de Vacaciones',
    birthdays: 'Cumpleaños', team: 'Mi Equipo', settings: 'Configuración', policies: 'Políticas',
    announcements: 'Comunicados',
    attendance:    'Asistencia'
  },

  loadView: function(view) {
    var fns = {
      dashboard:      DashboardView.load,
      employees:      EmployeesView.load,
      orgchart:       OrgChartView.load,
      kpis:           KPIsView.load,
      'kpi-reports':  KPIReportsView.load,
      vacations:      VacationsView.load,
      'vac-calendar': VacCalendarView.load,
      'vac-history':  VacHistoryView.load,
      'vac-balance':  VacBalanceView.load,
      birthdays:      BirthdaysView.load,
      team:           TeamView.load,
      policies:       PoliciesView.load,
      announcements:  AnnouncementsView.load,
      attendance:     AttendanceView.load,
    };
    if (fns[view]) fns[view]();
  },

  updateApprovalBadge: function() {
    var u = APP.user;
    if (!u || (!u.isAdmin && !u.isHR && !u.isManager)) return;
    APP.api('vacations.teamRequests', {}, function(err, data) {
      var count = err ? 0 : (data || []).length;
      ['nav-vac-badge-admin', 'nav-vac-badge-approver'].forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.textContent = count > 0 ? String(count) : '';
        el.style.display = count > 0 ? 'inline-flex' : 'none';
      });
    });
  },

  renderHeader: function() {
    var alerts = APP.data && APP.data.alerts ? APP.data.alerts.length : 0;
    var dot = document.getElementById('notif-dot');
    if (dot) dot.style.display = alerts > 0 ? 'block' : 'none';
  },

  openNotifications: function() {
    var d = APP.data || {};
    var alerts = d.alerts || [];
    var pending = d.pendingKPIs || [];
    var items = '';
    if (alerts.length) {
      items += '<div class="font-600 text-sm mb-8" style="color:var(--warning)">⚠️ Alertas</div>';
      items += alerts.map(function(a) {
        return '<div class="alert ' + a.type + '" style="margin-bottom:6px;cursor:pointer" onclick="APP.closeModal();APP.navigate(\'' + (a.action||'dashboard') + '\')">' + a.icon + ' ' + a.message + '</div>';
      }).join('');
    }
    if (pending.length) {
      items += '<div class="font-600 text-sm mb-8 mt-12">📋 KPIs pendientes de autoevaluación</div>';
      items += pending.map(function(p) {
        var evalBadge = p.evaluationType === 'meta'
          ? '<span class="badge badge-success" style="font-size:10px;margin-left:6px">🎯 Meta</span>'
          : '<span class="badge badge-info" style="font-size:10px;margin-left:6px">📈 Progreso</span>';
        return '<div style="padding:8px 0;border-bottom:1px solid var(--border)">' +
          '<div class="text-sm font-600">' + p.kpi.name + evalBadge + '</div>' +
          '<div class="text-xs text-muted">📅 ' + p.period.name + ' · ⚖️ ' + p.kpi.weight + '%</div>' +
        '</div>';
      }).join('');
    }
    if (!items) items = '<div class="empty-state"><span class="material-icons-round">notifications_none</span><p>Sin notificaciones 🎉</p></div>';
    APP.modal('🔔 Notificaciones', items,
      '<button class="btn btn-outline" onclick="APP.closeModal()">Cerrar</button>' +
      (pending.length ? '<button class="btn btn-primary" onclick="APP.closeModal();APP.navigate(\'kpis\')">Ir a KPIs</button>' : '')
    );
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
    var sec = document.getElementById('admin-section');
    if (sec) sec.style.display = (u.isAdmin || u.isHR) ? 'block' : 'none';
    var approverSec = document.getElementById('approver-section');
    if (approverSec) approverSec.style.display = (u.isManager && u.canApproveVacations && !u.isAdmin && !u.isHR) ? 'block' : 'none';
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
  // Renders selfComments: separates plain text from the evidence block,
  // and turns each "• filename: url" line into a download link.
  fmtComments: function(text) {
    if (!text) return '';
    var evidenceMarker = '📎 Evidencia:';
    var markerIdx = text.indexOf(evidenceMarker);
    var commentText = markerIdx > -1 ? text.slice(0, markerIdx).trim() : text.trim();
    var evidenceBlock = markerIdx > -1 ? text.slice(markerIdx + evidenceMarker.length) : '';

    var html = commentText
      ? '<span style="white-space:pre-line">' + commentText + '</span>'
      : '';

    if (evidenceBlock) {
      var links = evidenceBlock.split('\n').map(function(line) {
        line = line.trim();
        if (!line.startsWith('•')) return '';
        var colonIdx = line.indexOf(': http');
        if (colonIdx === -1) return '';
        var fname = line.slice(1, colonIdx).trim();
        var url   = line.slice(colonIdx + 2).trim();
        var dlUrl = url + (url.indexOf('?') === -1 ? '?download=' : '&download=') + encodeURIComponent(fname);
        return '<a href="' + dlUrl + '" target="_blank" rel="noopener" download="' + fname + '" style="display:inline-flex;align-items:center;gap:4px;color:var(--primary);font-size:12px;margin-top:4px"><span class="material-icons-round" style="font-size:14px">download</span>' + fname + '</a>';
      }).filter(Boolean).join('<br>');
      if (links) html += (html ? '<br>' : '') + '<div style="margin-top:4px">' + links + '</div>';
    }
    return html || '—';
  },

  fmtTarget: function(value, type) {
    if (value === null || value === undefined || value === '') return '—';
    if (type === 'Porcentaje' || type === 'Porcentual') return value + '%';
    if (type === 'Monetario') return '$' + value;
    if (type === 'Booleano' || type === 'Sí/No') return 'Sí (logrado)';
    return String(value);
  },
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
  },

  render: function(d) {
    var alertsHtml = (d.alerts || []).map(function(a) {
      return '<div class="alert ' + a.type + '" onclick="APP.navigate(\'' + (a.action||'dashboard') + '\')">' + a.icon + ' ' + a.message + '</div>';
    }).join('') || '<p class="text-muted text-sm">Sin alertas por el momento 🎉</p>';
    document.getElementById('dash-alerts').innerHTML = alertsHtml;

    var vac = d.vacation || {};
    var bal = vac.balance || {};
    document.getElementById('dash-vac-days').textContent = bal.daysRemaining || 0;
    var kpiScoreEl = document.getElementById('dash-kpi-score');
    var hasKpiScore = d.kpi && d.kpi.avgScore != null;
    kpiScoreEl.textContent = hasKpiScore ? APP.semLabel(d.kpi.avgScore) : '—';
    kpiScoreEl.style.fontSize = hasKpiScore ? '17px' : '';
    document.getElementById('dash-pending-kpi').textContent = (d.pendingKPIs || []).length;
    var isApprover = APP.user && (APP.user.isAdmin || APP.user.isHR || APP.user.isManager);
    document.getElementById('dash-pending-vac').textContent = isApprover ? ((d.team && d.team.pendingVacApproval) || 0) : (vac.pendingRequests || 0);
    var vacLabel = document.getElementById('dash-pending-vac-label');
    if (vacLabel) vacLabel.textContent = isApprover ? 'Por aprobar' : 'Solicitudes pendientes';

    var bdays = (d.birthdays || []).slice(0, 5);
    document.getElementById('dash-birthdays').innerHTML = bdays.length
      ? '<div class="bday-list">' + bdays.map(DashboardView.bdayItem).join('') + '</div>'
      : '<div class="empty-state"><span class="material-icons-round">cake</span><p>Sin cumpleaños próximos</p></div>';

    var kpi = d.kpi || {};
    var trend = kpi.trend === 'up' ? '📈' : kpi.trend === 'down' ? '📉' : '';
    document.getElementById('dash-kpi-label').textContent = hasKpiScore ? kpi.avgScore + ' pts ' + trend : 'Sin calificar';

    var ann = (d.announcements || []).slice(0, 4);
    document.getElementById('dash-announcements').innerHTML = ann.length
      ? ann.map(function(a) {
          var eid = 'ann-' + a.id;
          window['_ann_' + a.id] = a;
          return '<div style="padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="AnnouncementsView.openModal(window[\'_ann_\' + \'' + a.id + '\'])">' +
            (a.pinned ? '<span style="color:var(--warning)">📌 </span>' : '') +
            '<span class="font-600 text-sm" style="color:var(--primary)">' + a.title + '</span>' +
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

    APP.updateApprovalBadge();
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
      var isAdmin = APP.user && (APP.user.isAdmin || APP.user.isHR);
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
  _mode: 'tree',
  load: function() {
    OrgChartView.zoom = 1;
    OrgChartView._mode = 'tree';
    document.getElementById('view-orgchart').innerHTML =
      '<div class="view-title"><span class="material-icons-round">account_tree</span>Organigrama</div>' +
      '<div class="card" style="padding:0;overflow:hidden">' +
        '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap">' +
          '<button id="org-btn-tree" class="btn btn-primary btn-sm" onclick="OrgChartView.switchMode(\'tree\')"><span class="material-icons-round" style="font-size:15px">account_tree</span>Árbol</button>' +
          (OrgChartView._canSeePyramid() ? '<button id="org-btn-pyramid" class="btn btn-outline btn-sm" onclick="OrgChartView.switchMode(\'pyramid\')"><span class="material-icons-round" style="font-size:15px">layers</span>Pirámide</button>' : '') +
          '<div id="org-tree-controls" style="display:flex;align-items:center;gap:8px;margin-left:8px">' +
            '<button class="btn btn-outline btn-sm" onclick="OrgChartView.zoomOut()"><span class="material-icons-round" style="font-size:16px">remove</span></button>' +
            '<span id="org-zoom-label" style="font-size:13px;font-weight:600;min-width:42px;text-align:center">100%</span>' +
            '<button class="btn btn-outline btn-sm" onclick="OrgChartView.zoomIn()"><span class="material-icons-round" style="font-size:16px">add</span></button>' +
            '<button class="btn btn-outline btn-sm" onclick="OrgChartView.resetZoom()">↺ Reset</button>' +
          '</div>' +
          '<button class="btn btn-outline btn-sm" onclick="OrgChartView.exportPNG()" id="org-export-btn" style="margin-left:auto"><span class="material-icons-round" style="font-size:16px">download</span> Exportar PNG</button>' +
        '</div>' +
        '<div id="org-zoom-outer" style="overflow:auto;width:100%;max-height:72vh">' +
          '<div id="org-zoom-inner" style="display:inline-block;transform-origin:top left;transition:transform .15s;width:100%">' +
            '<div id="org-tree" class="loader"><div class="spinner"></div> Construyendo organigrama...</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    OrgChartView._loadTree();
  },
  _canSeePyramid: function() {
    var u = APP.user;
    return u && (u.isAdmin || u.isHR || u.isManager || (u.hierarchyLevel === 'CEO'));
  },
  switchMode: function(mode) {
    if (mode === 'pyramid' && !OrgChartView._canSeePyramid()) return;
    OrgChartView._mode = mode;
    var treeBtn    = document.getElementById('org-btn-tree');
    var pyramidBtn = document.getElementById('org-btn-pyramid');
    var treeCtrl   = document.getElementById('org-tree-controls');
    if (treeBtn)    { treeBtn.className    = mode === 'tree'    ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'; }
    if (pyramidBtn) { pyramidBtn.className = mode === 'pyramid' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'; }
    if (treeCtrl)   { treeCtrl.style.display = 'flex'; }
    if (mode === 'tree') { OrgChartView._loadTree(); } else { OrgChartView._loadPyramid(); }
  },
  _loadTree: function() {
    var tree = document.getElementById('org-tree');
    if (!tree) return;
    tree.className = 'loader';
    tree.innerHTML = '<div class="spinner"></div> Construyendo organigrama...';
    APP.api('orgchart.get', {}, function(err, data) {
      if (err) { APP.toast(err,'error'); return; }
      var t = document.getElementById('org-tree');
      if (!t) return;

      // ── Step 1: compute subtree widths (structural, not level-based) ──
      function calcWidth(n) {
        if (!n.children || !n.children.length) { n._w = 1; return 1; }
        var w = 0;
        n.children.forEach(function(c) { w += calcWidth(c); });
        n._w = Math.max(1, w);
        return n._w;
      }
      (data.nodes || []).forEach(calcWidth);

      // ── Step 2: assign X positions (in slot units) ──
      function assignX(n, start) {
        n._xUnit = start + (n._w - 1) / 2;
        var cx = start;
        (n.children || []).forEach(function(c) { assignX(c, cx); cx += c._w; });
      }
      var xOff = 0;
      (data.nodes || []).forEach(function(r) { assignX(r, xOff); xOff += r._w; });

      // ── Step 3: flatten and compute effective levels ──
      var flat = [];
      OrgChartView._flattenTree(data.nodes, 0, flat);
      var maxLevel = 0;
      flat.forEach(function(item) {
        var n = item.node;
        var lvl = (n.orgLevel !== null && n.orgLevel !== undefined) ? n.orgLevel : item.chainDepth;
        item.effectiveLevel = lvl;
        n._effectiveLevel = lvl;
        if (lvl > maxLevel) maxLevel = lvl;
      });

      // ── Step 4: render cards with absolute positioning ──
      var CARD_W = 174; // 150px card + 24px gap
      var ROW_H  = 230; // ~170px card + 60px gap
      var PAD_X  = 48;
      var PAD_Y  = 32;
      var totalW = Math.max(600, xOff * CARD_W - 24 + PAD_X * 2);
      var totalH = PAD_Y + (maxLevel + 1) * ROW_H;

      var canEdit = APP.user && (APP.user.isAdmin || APP.user.isHR);

      // ── Hierarchy bands ──
      var BANDS_CFG = [
        { label: 'CEO',                        minLvl: 0, maxLvl: 1, color: '#6366f1' },
        { label: 'Heads',                      minLvl: 2, maxLvl: 2, color: '#8b5cf6' },
        { label: 'Managers',                   minLvl: 3, maxLvl: 3, color: '#0ea5e9' },
        { label: 'Supervisores',               minLvl: 4, maxLvl: 4, color: '#10b981' },
        { label: 'Operativo y Administrativo', minLvl: 5, maxLvl: 999, color: '#64748b' },
      ];
      var activeBands = [];
      BANDS_CFG.forEach(function(b) {
        var nodes = flat.filter(function(item) {
          return item.effectiveLevel >= b.minLvl && item.effectiveLevel <= b.maxLvl;
        });
        if (!nodes.length) return;
        var minL = Math.min.apply(null, nodes.map(function(i) { return i.effectiveLevel; }));
        var maxL = Math.max.apply(null, nodes.map(function(i) { return i.effectiveLevel; }));
        activeBands.push({ label: b.label, color: b.color, minL: minL, maxL: maxL });
      });
      var bandsHtml = '';
      activeBands.forEach(function(b, bi) {
        var top = bi === 0 ? 0 : PAD_Y + b.minL * ROW_H;
        var bot = bi === activeBands.length - 1 ? totalH : PAD_Y + (b.maxL + 1) * ROW_H;
        bandsHtml +=
          '<div style="position:absolute;left:0;top:' + top + 'px;width:100%;height:' + (bot - top) + 'px;' +
          'background:' + b.color + '0d;border-top:2px solid ' + b.color + '28;z-index:0;pointer-events:none;box-sizing:border-box">' +
          '<span style="position:absolute;left:10px;top:6px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:' + b.color + ';opacity:.7">' + b.label + '</span>' +
          '</div>';
      });

      var cardsHtml = '';
      flat.forEach(function(item) {
        var n = item.node;
        var x = PAD_X + n._xUnit * CARD_W;
        var y = PAD_Y + item.effectiveLevel * ROW_H;
        cardsHtml += '<div style="position:absolute;left:' + Math.round(x) + 'px;top:' + Math.round(y) + 'px;z-index:2">' +
          OrgChartView._renderLevelCard(n, item.effectiveLevel, canEdit) +
        '</div>';
      });

      t.className = '';
      t.style.cssText = 'position:relative;min-width:max-content';
      t.innerHTML =
        '<div id="org-tree-layout" style="position:relative;width:' + totalW + 'px;height:' + totalH + 'px;display:inline-block">' +
          bandsHtml +
          '<canvas id="org-lines-canvas" style="position:absolute;top:0;left:0;pointer-events:none;z-index:1"></canvas>' +
          cardsHtml +
        '</div>';

      var inner = document.getElementById('org-zoom-inner');
      if (inner) inner.style.width = 'max-content';
      OrgChartView._flatCache = flat;
      setTimeout(function() { OrgChartView._drawLevelLines(flat); }, 80);
    });
  },
  _flattenTree: function(nodes, depth, flat) {
    (nodes || []).forEach(function(n) {
      flat.push({ node: n, chainDepth: depth });
      if (n.children && n.children.length) OrgChartView._flattenTree(n.children, depth + 1, flat);
    });
  },
  _renderLevelCard: function(n, lvl, canEdit) {
    return '<div class="org-card' + (n.isLeader ? ' leader' : '') + '" data-emp-id="' + n.id + '" style="position:relative;z-index:1;flex-shrink:0">' +
      '<div class="oa">' + APP.initials(n.fullName) + '</div>' +
      '<div class="on">' + n.fullName + '</div>' +
      '<div class="ot">' + (n.jobTitle || '') + '</div>' +
      (n.isLeader   ? '<div class="org-badge" style="color:var(--primary)">👑 Líder</div>' : '') +
      (n.isCoLeader ? '<div class="org-badge" style="color:var(--warning)">⭐ Co-líder</div>' : '') +
      (n.department ? '<div class="org-dept">' + n.department + '</div>' : '') +
      (canEdit
        ? '<div style="display:flex;align-items:center;justify-content:center;gap:4px;margin-top:8px;border-top:1px solid var(--border);padding-top:6px" onclick="event.stopPropagation()">' +
            '<button class="btn btn-outline" style="padding:1px 7px;font-size:11px;min-width:0;height:22px;line-height:1" onclick="OrgChartView.changeLevel(\'' + n.id + '\',' + (lvl - 1) + ')"' + (lvl === 0 ? ' disabled' : '') + '>↑</button>' +
            '<span style="font-size:10px;color:var(--text-muted);min-width:44px;text-align:center">Nivel ' + lvl + '</span>' +
            '<button class="btn btn-outline" style="padding:1px 7px;font-size:11px;min-width:0;height:22px;line-height:1" onclick="OrgChartView.changeLevel(\'' + n.id + '\',' + (lvl + 1) + ')">↓</button>' +
          '</div>'
        : '') +
    '</div>';
  },
  _drawLevelLines: function(flat) {
    var layoutEl = document.getElementById('org-tree-layout');
    var canvas   = document.getElementById('org-lines-canvas');
    if (!layoutEl || !canvas) return;

    var w = layoutEl.offsetWidth, h = layoutEl.offsetHeight;
    canvas.width = w; canvas.height = h;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';

    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2; ctx.lineJoin = 'round';

    var ref = layoutEl.getBoundingClientRect();
    var sx = w / (ref.width  || w);
    var sy = h / (ref.height || h);

    function pos(el) {
      var r = el.getBoundingClientRect();
      return {
        cx:  (r.left + r.width / 2 - ref.left) * sx,
        top: (r.top    - ref.top) * sy,
        bot: (r.bottom - ref.top) * sy
      };
    }

    // Build level map and group children by parent
    var levelMap = {};
    var byParent = {};
    flat.forEach(function(item) {
      levelMap[item.node.id] = item.effectiveLevel;
      var n = item.node;
      if (!n.managerId) return;
      if (!byParent[n.managerId]) byParent[n.managerId] = [];
      byParent[n.managerId].push(n.id);
    });

    Object.keys(byParent).forEach(function(parentId) {
      var parentEl = layoutEl.querySelector('[data-emp-id="' + parentId + '"]');
      if (!parentEl) return;
      var parentLevel = levelMap[parentId] !== undefined ? levelMap[parentId] : 0;
      var pp = pos(parentEl);

      // Split children: below parent (vertical T) vs same/above level (lateral dashed)
      var below = [], lateral = [];
      byParent[parentId].forEach(function(id) {
        var el = layoutEl.querySelector('[data-emp-id="' + id + '"]');
        if (!el) return;
        var cl = levelMap[id] !== undefined ? levelMap[id] : 0;
        if (cl > parentLevel) below.push({ el: el, p: pos(el) });
        else                  lateral.push({ el: el, p: pos(el) });
      });

      // ── T-connector for children below ──
      if (below.length) {
        ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2; ctx.setLineDash([]);
        var barY = pp.bot + 28 * sy;
        ctx.beginPath(); ctx.moveTo(pp.cx, pp.bot); ctx.lineTo(pp.cx, barY); ctx.stroke();
        var xs = below.map(function(c) { return c.p.cx; });
        var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
        if (minX < maxX) {
          ctx.beginPath(); ctx.moveTo(minX, barY); ctx.lineTo(maxX, barY); ctx.stroke();
        }
        below.forEach(function(c) {
          ctx.beginPath(); ctx.moveTo(c.p.cx, barY); ctx.lineTo(c.p.cx, c.p.top); ctx.stroke();
        });
      }

      // ── Dashed U-connector for same-level or above children ──
      if (lateral.length) {
        ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
        lateral.forEach(function(c) {
          var dip = Math.max(pp.bot, c.p.bot) + 32 * sy;
          ctx.beginPath();
          ctx.moveTo(pp.cx, pp.bot); ctx.lineTo(pp.cx, dip);
          ctx.lineTo(c.p.cx, dip);  ctx.lineTo(c.p.cx, c.p.bot);
          ctx.stroke();
        });
        ctx.setLineDash([]);
      }
    });
  },
  changeLevel: function(empId, newLevel) {
    if (newLevel < 0) return;
    APP.api('orgchart.setLevel', { employeeId: empId, level: newLevel }, function(err) {
      if (err) { APP.toast(err, 'error'); return; }
      OrgChartView._loadTree();
    });
  },
  _loadPyramid: function() {
    var tree = document.getElementById('org-tree');
    if (!tree) return;
    tree.className = 'loader';
    tree.innerHTML = '<div class="spinner"></div> Cargando pirámide...';
    APP.api('employees.list', {}, function(err, emps) {
      if (err) { APP.toast(err, 'error'); return; }
      var t = document.getElementById('org-tree');
      if (!t) return;
      OrgChartView._pyramidEmps = (emps || []).filter(function(e) { return !e.status || e.status === 'activo'; });
      t.className = '';
      t.style.cssText = 'position:relative;width:100%';
      t.innerHTML = OrgChartView._renderPyramid(OrgChartView._pyramidEmps);
      var inner = document.getElementById('org-zoom-inner');
      if (inner) inner.style.width = 'max-content';
      setTimeout(function() { OrgChartView._drawPyramidLines(); }, 60);
    });
  },
  _dragEmpId: null,
  _renderPyramid: function(emps) {
    var levels = ['CEO','Heads','Managers','Supervisores','Operativo y Administrativo'];
    var colors = { 'CEO': '#6366f1', 'Heads': '#8b5cf6', 'Managers': '#0ea5e9', 'Supervisores': '#10b981', 'Operativo y Administrativo': '#64748b' };
    var grouped = {};
    levels.forEach(function(l) { grouped[l] = []; });

    // Build empMap with corrected hierarchy level
    var empMap = {};
    emps.forEach(function(e) {
      var lvl = grouped[e.hierarchyLevel] ? e.hierarchyLevel : 'Operativo y Administrativo';
      empMap[e.id] = { id: e.id, firstName: e.firstName, lastName: e.lastName, jobTitle: e.jobTitle, department: e.department, hierarchyLevel: lvl, managerId: e.managerId, children: [] };
      grouped[lvl].push(empMap[e.id]);
    });

    // Build tree via managerId relationships
    var roots = [];
    Object.keys(empMap).forEach(function(id) {
      var node = empMap[id];
      if (node.managerId && empMap[node.managerId]) {
        empMap[node.managerId].children.push(node);
      } else {
        roots.push(node);
      }
    });

    // Count leaf nodes in subtree (each leaf = 1 slot, parents span their children)
    function leafCount(node) {
      if (!node.children.length) return 1;
      return node.children.reduce(function(s, c) { return s + leafCount(c); }, 0);
    }

    // Assign horizontal slot positions top-down (center of subtree)
    var SLOT = 180;
    var PAD  = 76; // left offset so first card isn't clipped
    function assignX(nodes, startSlot) {
      nodes.sort(function(a, b) {
        return ((a.firstName||'') + ' ' + (a.lastName||'')).localeCompare((b.firstName||'') + ' ' + (b.lastName||''));
      });
      var slot = startSlot;
      nodes.forEach(function(node) {
        var lc = leafCount(node);
        node._x = Math.round((slot + (lc - 1) / 2) * SLOT) + PAD;
        assignX(node.children, slot);
        slot += lc;
      });
      return slot;
    }
    var totalSlots = assignX(roots, 0);
    var totalWidth = totalSlots * SLOT + PAD + 76;

    // Store layout metadata so _drawPyramidLines can draw without getBoundingClientRect
    var BAND_H = 170, LABEL_W = 72;
    var xMap = {}, levelIdxMap = {};
    Object.keys(empMap).forEach(function(id) {
      xMap[id] = empMap[id]._x;
      levelIdxMap[id] = levels.indexOf(empMap[id].hierarchyLevel);
    });
    OrgChartView._pyrXMap     = xMap;
    OrgChartView._pyrLevelIdx = levelIdxMap;
    OrgChartView._pyrBandH    = BAND_H;
    OrgChartView._pyrLabelW   = LABEL_W;
    OrgChartView._pyrTotalW   = LABEL_W + totalWidth;
    OrgChartView._pyrTotalH   = levels.length * (BAND_H + 1);

    var isAdmin = APP.user && APP.user.isAdmin;

    return '<div id="pyr-scroll" style="position:relative;border:1px solid var(--border);border-radius:10px;overflow:hidden">' +
      levels.map(function(lvl, i) {
        var people  = grouped[lvl];
        var color   = colors[lvl];
        var isLast  = i === levels.length - 1;
        var lvlSafe = lvl.replace(/'/g, "\\'");

        var cards = people.map(function(e) {
          var xPx = e._x != null ? e._x : PAD;
          var dragAttrs = isAdmin
            ? 'draggable="true" ondragstart="OrgChartView._pyrDragStart(event,\'' + e.id + '\')" ondragend="OrgChartView._pyrDragEnd(event)"'
            : '';
          return '<div class="org-card" id="pyr-card-' + e.id + '" data-empid="' + e.id + '" data-level="' + lvl + '" ' + dragAttrs +
            ' style="position:absolute;left:' + xPx + 'px;top:50%;transform:translate(-50%,-50%);width:160px;' + (isAdmin ? 'cursor:grab' : 'cursor:default') + '">' +
            (isAdmin ? '<div style="font-size:9px;color:var(--text-muted);text-align:right;margin-bottom:-4px">⠿</div>' : '') +
            '<div class="oa" style="background:' + color + '22;color:' + color + '">' + APP.initials((e.firstName||'') + ' ' + (e.lastName||'')) + '</div>' +
            '<div class="on">' + (e.firstName||'') + ' ' + (e.lastName||'') + '</div>' +
            (e.jobTitle   ? '<div class="ot">' + e.jobTitle   + '</div>' : '') +
            (e.department ? '<div class="org-dept">' + e.department + '</div>' : '') +
          '</div>';
        }).join('');

        var dropAttrs = isAdmin
          ? 'ondragover="OrgChartView._pyrDragOver(event)" ondragleave="OrgChartView._pyrDragLeave(event)" ondrop="OrgChartView._pyrDrop(event,\'' + lvlSafe + '\')"'
          : '';

        var emptyHint = !people.length
          ? '<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:11px;color:' + color + ';opacity:.5;font-style:italic;padding:8px 12px;border:1px dashed ' + color + ';border-radius:6px">' + (isAdmin ? 'Arrastra aquí' : 'Sin asignar') + '</div>'
          : '';

        return '<div style="display:flex;' + (isLast ? '' : 'border-bottom:1px solid var(--border)') + '">' +
          '<div style="width:' + LABEL_W + 'px;flex-shrink:0;background:' + color + ';display:flex;align-items:center;justify-content:center;padding:12px 4px">' +
            '<span style="color:#fff;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;writing-mode:vertical-lr;transform:rotate(180deg);white-space:nowrap">' + lvl + '</span>' +
          '</div>' +
          '<div id="pyr-zone-' + i + '" ' + dropAttrs + ' style="position:relative;flex:1;min-width:' + totalWidth + 'px;height:' + BAND_H + 'px;background:' + color + '0a;border:2px solid transparent;transition:border-color .15s,background .15s">' +
            cards + emptyHint +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  },

  _pyrDragStart: function(event, empId) {
    OrgChartView._dragEmpId = empId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', empId);
    // Use currentTarget (the card div) for opacity
    setTimeout(function() {
      var card = document.getElementById('pyr-card-' + empId);
      if (card) card.style.opacity = '0.4';
    }, 0);
  },
  _pyrDragEnd: function(event) {
    var empId = OrgChartView._dragEmpId;
    if (empId) {
      var card = document.getElementById('pyr-card-' + empId);
      if (card) card.style.opacity = '';
    }
  },
  _pyrDragOver: function(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    var zone = event.currentTarget;
    zone.style.borderColor = 'var(--primary)';
    zone.style.background  = 'var(--primary-light)';
  },
  _pyrDragLeave: function(event) {
    var zone = event.currentTarget;
    zone.style.borderColor = 'transparent';
    zone.style.background  = '';
  },
  _pyrDrop: function(event, targetLevel) {
    event.preventDefault();
    var zone = event.currentTarget;
    zone.style.borderColor = 'transparent';
    zone.style.background  = '';

    var empId = OrgChartView._dragEmpId || event.dataTransfer.getData('text/plain');
    OrgChartView._dragEmpId = null;
    if (!empId) return;

    var card = document.getElementById('pyr-card-' + empId);
    if (card && card.getAttribute('data-level') === targetLevel) {
      if (card) card.style.opacity = '';
      return; // No change
    }

    var emp  = (OrgChartView._pyramidEmps || []).filter(function(e) { return e.id === empId; })[0];
    var name = emp ? ((emp.firstName || '') + ' ' + (emp.lastName || '')).trim() : empId;

    APP.api('employees.update', { id: empId, hierarchyLevel: targetLevel }, function(err) {
      if (err) { APP.toast(err, 'error'); return; }
      APP.toast('✅ ' + name + ' → ' + targetLevel, 'success');
      if (emp) emp.hierarchyLevel = targetLevel;
      var t = document.getElementById('org-tree');
      if (t) {
        t.innerHTML = OrgChartView._renderPyramid(OrgChartView._pyramidEmps);
        setTimeout(function() { OrgChartView._drawPyramidLines(); }, 60);
      }
    });
  },
  _drawPyramidLines: function() {
    // SVG goes inside #pyr-scroll (the scrollable container) so it moves with the cards.
    // Coordinates come from pre-computed layout data — no getBoundingClientRect() needed.
    var scrollEl = document.getElementById('pyr-scroll');
    if (!scrollEl) return;
    var existing = document.getElementById('pyr-svg');
    if (existing) existing.remove();

    var emps      = OrgChartView._pyramidEmps || [];
    var xMap      = OrgChartView._pyrXMap     || {};
    var levelIdx  = OrgChartView._pyrLevelIdx || {};
    var bandH     = OrgChartView._pyrBandH    || 130;
    var labelW    = OrgChartView._pyrLabelW   || 72;
    var totalW    = OrgChartView._pyrTotalW   || 600;
    var totalH    = OrgChartView._pyrTotalH   || 650;
    var rowH      = bandH + 1; // band height + 1px border

    var paths = [];
    emps.forEach(function(emp) {
      if (!emp.managerId) return;
      if (xMap[emp.id] == null || xMap[emp.managerId] == null) return;
      var ei = levelIdx[emp.id], mi = levelIdx[emp.managerId];
      if (ei == null || mi == null || ei <= mi) return;

      var x1 = labelW + xMap[emp.managerId]; // manager center X
      var y1 = mi * rowH + bandH;             // manager band bottom
      var x2 = labelW + xMap[emp.id];         // employee center X
      var y2 = ei * rowH;                     // employee band top
      var cy = Math.round((y1 + y2) / 2);

      paths.push(
        '<path d="M' + x1 + ' ' + y1 + ' L' + x1 + ' ' + cy + ' L' + x2 + ' ' + cy + ' L' + x2 + ' ' + y2 + '" ' +
        'fill="none" stroke="var(--border)" stroke-width="2"/>'
      );
    });

    if (!paths.length) return;

    var svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.id = 'pyr-svg';
    svgEl.setAttribute('width',  totalW);
    svgEl.setAttribute('height', totalH);
    svgEl.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none';
    svgEl.innerHTML = paths.join('');
    scrollEl.insertBefore(svgEl, scrollEl.firstChild);
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
  },
  exportPNG: function() {
    var inner = document.getElementById('org-zoom-inner');
    if (!inner) return;
    if (!window.html2canvas) { APP.toast('La librería de exportación aún no cargó, intenta de nuevo', 'error'); return; }

    var btn = document.getElementById('org-export-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generando...'; }

    var currentZoom = OrgChartView.zoom;
    var hiddenChildren = [];
    var hiddenVlines   = [];

    // Expand all collapsed subtrees
    inner.querySelectorAll('.org-children').forEach(function(el) {
      if (el.style.display === 'none') { hiddenChildren.push(el); el.style.display = 'flex'; }
    });
    inner.querySelectorAll('.org-vline').forEach(function(el) {
      if (el.style.display === 'none') { hiddenVlines.push(el); el.style.display = 'block'; }
    });

    // Reset zoom and disable transition during capture
    inner.style.transition = 'none';
    inner.style.transform  = 'scale(1)';

    function restore() {
      hiddenChildren.forEach(function(el) { el.style.display = 'none'; });
      hiddenVlines.forEach(function(el)   { el.style.display = 'none'; });
      inner.style.transform  = 'scale(' + currentZoom + ')';
      inner.style.transition = 'transform .15s';
      if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-icons-round" style="font-size:16px">download</span> Exportar PNG'; }
    }

    setTimeout(function() {
      html2canvas(inner, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false })
        .then(function(canvas) {
          restore();
          var link = document.createElement('a');
          link.download = 'organigrama-ikan.png';
          link.href = canvas.toDataURL('image/png');
          link.click();
          APP.toast('PNG exportado correctamente', 'success');
        })
        .catch(function() {
          restore();
          APP.toast('Error al generar la imagen', 'error');
        });
    }, 150);
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
          var evalBadge = item.evaluationType === 'meta'
            ? '<span class="badge badge-success" style="font-size:11px;padding:2px 7px">🎯 Evaluación de Meta</span>'
            : '<span class="badge badge-info"    style="font-size:11px;padding:2px 7px">📈 Evaluación de Progreso</span>';
          html += '<div class="kpi-review-row">' +
            '<div class="kpi-row-name" style="display:flex;align-items:center;gap:8px">' + kpi.name + evalBadge + '</div>' +
            (kpi.description ? '<div style="font-size:12px;color:var(--text-muted);margin-top:2px;margin-bottom:4px">' + kpi.description + '</div>' : '') +
            '<div class="kpi-row-meta">' +
              (kpi.target ? '<span>🎯 ' + APP.fmtTarget(kpi.target, kpi.measureType) + '</span>' : '') +
              '<span>⚖️ ' + kpi.weight + '%</span>' +
              '<span>📆 Meta: ' + kpi.periodType + '</span>' +
            '</div>' +
            (kpi.instructions ? '<div class="alert info" style="margin-bottom:10px;font-size:12px">📋 ' + kpi.instructions + '</div>' : '') +
            KPIsView._semHtml(kpi.id, draftScore) +
            '<textarea id="sem-comment-' + kpi.id + '" class="mt-8" rows="2" placeholder="Contexto o evidencia (opcional)...">' + draftComment + '</textarea>' +
            '<div class="mt-8" id="evidence-area-' + kpi.id + '">' +
              '<div id="evidence-list-' + kpi.id + '" style="margin-bottom:6px"></div>' +
              '<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-muted);border:1px dashed var(--border);border-radius:6px;padding:6px 12px">' +
                '<span class="material-icons-round" style="font-size:16px">attach_file</span>Adjuntar evidencia' +
                '<input type="file" style="display:none" multiple onchange="KPIsView.uploadEvidence(\'' + kpi.id + '\',this)">' +
              '</label>' +
            '</div>' +
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

  _evidenceUrls: {},  // kpiId → [{ name, url }]

  uploadEvidence: function(kpiId, input) {
    var files = Array.from(input.files);
    if (!files.length) return;
    var listEl = document.getElementById('evidence-list-' + kpiId);
    files.forEach(function(file) {
      if (file.size > 20 * 1024 * 1024) { APP.toast('El archivo "' + file.name + '" supera 20 MB', 'error'); return; }
      var placeholder = document.createElement('div');
      placeholder.style.cssText = 'font-size:12px;color:var(--text-muted);margin-bottom:4px';
      placeholder.textContent = '⏳ Subiendo ' + file.name + '…';
      if (listEl) listEl.appendChild(placeholder);

      var fd = new FormData();
      fd.append('file', file);
      var token = window._sb && window._sb.auth ? null : null;
      // Get auth token from Supabase session
      (window._sb ? window._sb.auth.getSession() : Promise.resolve({ data: { session: null } }))
        .then(function(res) {
          var session = res.data && res.data.session;
          var headers = session ? { Authorization: 'Bearer ' + session.access_token } : {};
          return fetch('/api/upload-evidence', { method: 'POST', headers: headers, body: fd });
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.error) { placeholder.textContent = '❌ ' + file.name + ': ' + data.error; return; }
          if (!KPIsView._evidenceUrls[kpiId]) KPIsView._evidenceUrls[kpiId] = [];
          KPIsView._evidenceUrls[kpiId].push({ name: data.name, url: data.url });
          var dlUrl = data.url + (data.url.indexOf('?') === -1 ? '?download=' : '&download=') + encodeURIComponent(data.name);
          placeholder.innerHTML = '<a href="' + dlUrl + '" target="_blank" download="' + data.name + '" style="display:inline-flex;align-items:center;gap:4px;color:var(--primary);font-size:12px"><span class="material-icons-round" style="font-size:14px">download</span>' + data.name + '</a>';
        })
        .catch(function(e) { placeholder.textContent = '❌ Error subiendo ' + file.name; });
    });
    input.value = '';
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
        KPIsView._evidenceUrls = {};
        APP.data = null; KPIsView.loadTab('self'); return;
      }
      var kpiId    = kpiIds[idx++];
      var score    = document.getElementById('sem-val-' + kpiId).value;
      var comments = (document.getElementById('sem-comment-' + kpiId)||{}).value || '';
      var evUrls   = KPIsView._evidenceUrls[kpiId] || [];
      var selfComments = comments;
      if (evUrls.length) {
        selfComments += (comments ? '\n' : '') + '📎 Evidencia:\n' + evUrls.map(function(f){ return '• ' + f.name + ': ' + f.url; }).join('\n');
      }
      APP.api('kpi.reviews.selfSubmit', { kpiDefinitionId: kpiId, periodId: periodId, selfScore: score, selfComments: selfComments },
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
            var evalBadge = r.evaluationType === 'meta'
              ? '<span class="badge badge-success" style="font-size:10px;margin-left:6px">🎯 Meta</span>'
              : '<span class="badge badge-info" style="font-size:10px;margin-left:6px">📈 Progreso</span>';
            return '<div style="padding:8px 12px;background:var(--bg);border-radius:6px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">' +
              '<div><div class="text-sm font-600">' + r.kpiName + evalBadge + '</div>' +
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
      var evalBadge = r.evaluationType === 'meta'
        ? '<span class="badge badge-success" style="font-size:11px;margin-left:8px">🎯 Meta</span>'
        : '<span class="badge badge-info" style="font-size:11px;margin-left:8px">📈 Progreso</span>';
      return '<div style="' + sep + '">' +
        '<div class="font-600 text-sm mb-8" style="display:flex;align-items:center">' + r.kpiName + evalBadge + '</div>' +
        '<div style="background:var(--bg);border-radius:6px;padding:10px 12px;margin-bottom:12px">' +
          '<div class="text-xs" style="color:var(--text-muted)">Autoevaluación: <strong>' + APP.semLabel(r.selfScore) + '</strong>' + (r.kpiTarget ? ' · Meta: ' + APP.fmtTarget(r.kpiTarget, r.kpiMeasureType) : '') + '</div>' +
          (r.selfComments ? '<div class="text-xs mt-4" style="color:var(--text-muted);white-space:pre-line">' + APP.fmtComments(r.selfComments) + '</div>' : '') +
        '</div>' +
        '<div class="form-group"><label>Tu evaluación *</label>' +
          KPIsView._semHtml('mr-' + r.id, '') +
        '</div>' +
        '<div class="form-group"><label>Retroalimentación</label><textarea id="mr-comments-' + r.id + '" rows="2" placeholder="Comentarios para ' + empName + '..."></textarea></div>' +
      '</div>';
    }).join('');
    // Store IDs on the element to avoid double-quote conflict inside onclick attribute
    var safeIds = empReviews.map(function(r){ return r.id; }).join(',');
    APP.modal('📊 Revisión: ' + empName, body,
      '<button class="btn btn-outline" onclick="APP.closeModal()">Cancelar</button>' +
      '<button class="btn btn-primary" id="btn-submit-all-reviews" data-ids="' + safeIds + '" onclick="KPIsView.submitAllReviews(this.dataset.ids.split(\',\'),true)"><span class="material-icons-round">check_circle</span>Aprobar todas</button>'
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

// ── KPI REPORTS VIEW ─────────────────────────────────────────
var KPIReportsView = {
  _data: null,

  load: function() {
    var el = document.getElementById('kpi-reports-content');
    if (el) el.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    APP.api('kpi.reports.byDepartment', {}, function(err, data) {
      if (err) { APP.toast(err, 'error'); return; }
      KPIReportsView._data = data;
      KPIReportsView.render(data, '');
    });
  },

  reload: function(periodId) {
    var el = document.getElementById('krpt-depts');
    if (el) el.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    APP.api('kpi.reports.byDepartment', { periodId: periodId || '' }, function(err, data) {
      if (err) { APP.toast(err, 'error'); return; }
      KPIReportsView._data = data;
      var depts = data.departments || [];
      var chart = document.getElementById('krpt-chart');
      if (chart) chart.innerHTML = KPIReportsView._barChart(depts);
      var statsEl = document.getElementById('krpt-stats');
      if (statsEl) statsEl.innerHTML = KPIReportsView._statsRow(depts);
      if (el) el.innerHTML = depts.length
        ? depts.map(function(d) { return KPIReportsView._deptCard(d); }).join('')
        : '<div class="empty-state"><span class="material-icons-round">bar_chart</span><p>Sin evaluaciones en este período.</p></div>';
    });
  },

  render: function(data, periodId) {
    var depts   = data.departments || [];
    var periods = data.periods || [];
    var periodOpts = '<option value="">— Todos los períodos —</option>' +
      periods.map(function(p) {
        return '<option value="' + p.id + '"' + (p.id === periodId ? ' selected' : '') + '>' + p.name + ' (' + p.periodType + ')</option>';
      }).join('');

    var html =
      '<div class="view-title"><span class="material-icons-round">bar_chart</span>Reportes KPI por Área</div>' +
      '<div class="card mb-20" style="padding:12px 16px">' +
        '<div class="flex gap-8 items-center">' +
          '<span class="material-icons-round" style="color:var(--text-muted);font-size:18px">filter_list</span>' +
          '<select id="krpt-period" onchange="KPIReportsView.reload(this.value)" style="font-size:13px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface)">' +
            periodOpts +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div id="krpt-stats" class="grid grid-4 mb-20">' + KPIReportsView._statsRow(depts) + '</div>';

    if (depts.length > 1) {
      html += '<div class="card mb-20"><div class="card-title"><span class="material-icons-round" style="margin-right:6px">analytics</span>Comparativa por área</div>' +
        '<div id="krpt-chart" style="overflow-x:auto">' + KPIReportsView._barChart(depts) + '</div></div>';
    }

    html += '<div id="krpt-depts" class="grid grid-2 gap-16">' +
      (depts.length
        ? depts.map(function(d) { return KPIReportsView._deptCard(d); }).join('')
        : '<div class="empty-state"><span class="material-icons-round">bar_chart</span><p>Sin evaluaciones registradas aún.</p></div>') +
      '</div>';

    var el = document.getElementById('kpi-reports-content');
    if (el) el.innerHTML = html;
  },

  _statsRow: function(depts) {
    // Collect every employee across all departments (includes those with no KPIs)
    var allEmps = [];
    depts.forEach(function(d) { (d.employees || []).forEach(function(e) { allEmps.push(e); }); });
    var totalEmps  = allEmps.length;
    var withScore  = allEmps.filter(function(e) { return e.avgScore !== null; });
    var globalAvg  = withScore.length
      ? Math.round(withScore.reduce(function(s, e) { return s + e.avgScore; }, 0) / withScore.length * 10) / 10
      : null;
    var totalRevs     = depts.reduce(function(s, d) { return s + d.totalReviews; }, 0);
    var completedRevs = depts.reduce(function(s, d) { return s + d.completedReviews; }, 0);
    var globalPct  = totalRevs > 0 ? Math.round(completedRevs / totalRevs * 100) : 0;
    var semColor   = globalAvg === null ? 'var(--text-muted)' : globalAvg >= 75 ? '#16A34A' : globalAvg >= 25 ? '#D97706' : '#DC2626';
    var scoredLabel = withScore.length + ' de ' + totalEmps + ' con score';
    return '' +
      '<div class="card stat-card"><div class="stat-icon blue"><span class="material-icons-round">domain</span></div>' +
        '<div><div class="stat-value">' + depts.length + '</div><div class="stat-label">Áreas</div></div></div>' +
      '<div class="card stat-card"><div class="stat-icon green"><span class="material-icons-round">people</span></div>' +
        '<div><div class="stat-value">' + totalEmps + '</div><div class="stat-label">Total empleados</div></div></div>' +
      '<div class="card stat-card"><div class="stat-icon orange"><span class="material-icons-round">analytics</span></div>' +
        '<div><div class="stat-value" style="color:' + semColor + ';font-size:20px">' + (globalAvg !== null ? globalAvg + ' pts' : '—') + '</div>' +
        '<div class="stat-label">Score global <span style="font-size:10px;display:block;color:var(--text-muted)">' + scoredLabel + '</span></div></div></div>' +
      '<div class="card stat-card"><div class="stat-icon red"><span class="material-icons-round">task_alt</span></div>' +
        '<div><div class="stat-value">' + globalPct + '%</div><div class="stat-label">Completadas</div></div></div>';
  },

  _barChart: function(depts) {
    var scored = depts.filter(function(d) { return d.avgScore !== null; });
    if (!scored.length) return '<p class="text-muted text-sm" style="padding:8px">Sin scores disponibles.</p>';
    var rowH  = 36;
    var labelW = 160;
    var barMax = 420;
    var h = scored.length * rowH + 24;
    var rows = scored.map(function(d, i) {
      var score = d.avgScore;
      var barW  = Math.round((score / 100) * barMax);
      var color = score >= 75 ? '#16A34A' : score >= 25 ? '#D97706' : '#DC2626';
      var y     = i * rowH + 12;
      var name  = d.department.length > 22 ? d.department.slice(0, 20) + '…' : d.department;
      return '<g>' +
        '<text x="' + (labelW - 8) + '" y="' + (y + 11) + '" text-anchor="end" font-size="12" fill="currentColor" font-family="Inter,sans-serif">' + name + '</text>' +
        '<rect x="' + labelW + '" y="' + y + '" width="' + barMax + '" height="22" rx="4" fill="var(--bg)" />' +
        '<rect x="' + labelW + '" y="' + y + '" width="' + barW + '" height="22" rx="4" fill="' + color + '" opacity="0.85" />' +
        '<text x="' + (labelW + barW + 8) + '" y="' + (y + 15) + '" font-size="12" font-weight="600" fill="' + color + '" font-family="Inter,sans-serif">' + score + '</text>' +
        '</g>';
    }).join('');
    return '<svg viewBox="0 0 ' + (labelW + barMax + 60) + ' ' + h + '" style="width:100%;max-width:680px;display:block;margin:8px 0">' + rows + '</svg>';
  },

  _scoreRing: function(score) {
    if (score === null || score === undefined) {
      return '<svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--border)" stroke-width="6"/>' +
        '<text x="32" y="37" text-anchor="middle" font-size="14" fill="var(--text-muted)" font-family="Inter,sans-serif">—</text></svg>';
    }
    var color = score >= 75 ? '#16A34A' : score >= 25 ? '#D97706' : '#DC2626';
    var r = 26; var circ = 2 * Math.PI * r;
    var dash = Math.round((score / 100) * circ * 10) / 10;
    return '<svg viewBox="0 0 64 64" width="64" height="64">' +
      '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="var(--border)" stroke-width="6"/>' +
      '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="6"' +
        ' stroke-dasharray="' + dash + ' ' + circ + '" stroke-dashoffset="' + (circ * 0.25) + '"' +
        ' stroke-linecap="round" transform="rotate(-90 32 32)"/>' +
      '<text x="32" y="36" text-anchor="middle" font-size="13" font-weight="700" fill="' + color + '" font-family="Inter,sans-serif">' + score + '</text>' +
      '</svg>';
  },

  _deptCard: function(d) {
    var semLabel  = d.avgScore !== null ? APP.semLabel(d.avgScore) : '—';
    var pctColor  = d.completionPct >= 80 ? '#16A34A' : d.completionPct >= 40 ? '#D97706' : '#DC2626';
    var empList = '';
    if (d.employees && d.employees.length) {
      empList = '<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px">' +
        '<div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Empleados</div>' +
        d.employees.map(function(e) {
          var sc = e.avgScore !== null ? e.avgScore : null;
          var dot = sc === null ? 'var(--text-muted)' : sc >= 75 ? '#16A34A' : sc >= 25 ? '#D97706' : '#DC2626';
          var noKpis = e.total === 0;
          return '<div class="flex items-center gap-8" style="padding:4px 0;border-bottom:1px solid var(--border);' + (noKpis ? 'opacity:.6' : 'cursor:pointer') + '"' + (noKpis ? '' : ' onclick="KPIReportsView.openEmployeeDetail(\'' + e.id + '\',\'' + e.name.replace(/'/g,"\\'") + '\')"') + '>' +
            '<div class="td-avatar" style="width:28px;height:28px;font-size:11px;flex-shrink:0">' + APP.initials(e.name) + '</div>' +
            '<div style="flex:1;min-width:0"><div class="font-600 text-sm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + e.name + '</div>' +
            '<div class="text-xs text-muted">' + (e.jobTitle || '—') + '</div></div>' +
            '<div style="text-align:right;flex-shrink:0">' +
              (noKpis
                ? '<div style="font-size:11px;font-weight:600;color:var(--text-muted);background:var(--bg);border:1px dashed var(--border);border-radius:4px;padding:2px 7px;white-space:nowrap">Sin KPIs</div>'
                : (sc !== null ? '<div style="font-weight:700;font-size:13px;color:' + dot + '">' + sc + '</div>' : '<div class="text-muted text-sm">—</div>') +
                  '<div class="text-xs text-muted">' + e.completed + '/' + e.total + ' · <span style="color:var(--primary)">Ver →</span></div>') +
            '</div>' +
          '</div>';
        }).join('') +
        '</div>';
    }
    return '<div class="card">' +
      '<div class="flex items-center gap-12 mb-12">' +
        KPIReportsView._scoreRing(d.avgScore) +
        '<div style="flex:1">' +
          '<div class="font-600" style="font-size:15px">' + d.department + '</div>' +
          '<div class="text-sm text-muted">' + d.employeeCount + ' empleado' + (d.employeeCount !== 1 ? 's' : '') + '</div>' +
          '<div class="mt-4" style="font-size:13px">' + semLabel + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="margin-bottom:4px;display:flex;justify-content:space-between;align-items:center">' +
        '<span class="text-xs text-muted">Completado</span>' +
        '<span class="text-xs font-600" style="color:' + pctColor + '">' + d.completionPct + '% (' + d.completedReviews + '/' + d.totalReviews + ')</span>' +
      '</div>' +
      '<div style="height:6px;background:var(--border);border-radius:4px">' +
        '<div style="height:6px;background:' + pctColor + ';width:' + d.completionPct + '%;border-radius:4px;transition:width .4s"></div>' +
      '</div>' +
      empList +
    '</div>';
  },

  openEmployeeDetail: function(empId, empName) {
    APP.api('kpi.dashboard', { employeeId: empId }, function(err, data) {
      if (err) { APP.toast(err, 'error'); return; }
      var results = data.periodResults || [];
      var body = results.length === 0
        ? '<div class="empty-state"><span class="material-icons-round">bar_chart</span><p>Sin evaluaciones registradas</p></div>'
        : results.map(function(pr) {
            var scoreColor = pr.overallScore === null ? 'var(--text-muted)' : pr.overallScore >= 75 ? '#16A34A' : pr.overallScore >= 25 ? '#D97706' : '#DC2626';
            var kpiRows = (pr.reviews || []).map(function(r) {
              var sc = r.finalScore !== '' && r.finalScore !== null ? parseFloat(r.finalScore) : null;
              var c2 = sc === null ? 'var(--text-muted)' : sc >= 75 ? '#16A34A' : sc >= 25 ? '#D97706' : '#DC2626';
              return '<tr>' +
                '<td class="text-sm">' + (r.kpiName || '—') + '</td>' +
                '<td class="text-sm" style="text-align:center">' + (r.kpiWeight || 0) + '%</td>' +
                '<td class="text-sm" style="text-align:center;color:' + c2 + ';font-weight:600">' + (sc !== null ? sc : '—') + '</td>' +
                '<td class="text-xs text-muted">' + (r.managerComments || '') + '</td>' +
              '</tr>';
            }).join('');
            return '<div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)">' +
              '<div class="flex justify-between items-center mb-8">' +
                '<div class="font-600 text-sm">' + pr.period.name + '</div>' +
                '<div style="font-weight:700;font-size:15px;color:' + scoreColor + '">' + (pr.overallScore !== null ? pr.overallScore + ' pts' : '—') + '</div>' +
              '</div>' +
              (kpiRows ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>' +
                '<th class="text-xs text-muted" style="text-align:left;padding:4px 6px">KPI</th>' +
                '<th class="text-xs text-muted" style="text-align:center;padding:4px 6px">Peso</th>' +
                '<th class="text-xs text-muted" style="text-align:center;padding:4px 6px">Score</th>' +
                '<th class="text-xs text-muted" style="text-align:left;padding:4px 6px">Comentarios</th>' +
              '</tr></thead><tbody>' + kpiRows + '</tbody></table></div>' : '') +
            '</div>';
          }).join('');
      APP.modal('📊 KPI History — ' + empName, body, '<button class="btn btn-outline" onclick="APP.closeModal()">Cerrar</button>');
    });
  }
};

// ── VACATION CALENDAR VIEW ────────────────────────────────────
var VacCalendarView = {
  _year:  new Date().getFullYear(),
  _month: new Date().getMonth() + 1,

  load: function() {
    VacCalendarView._year  = new Date().getFullYear();
    VacCalendarView._month = new Date().getMonth() + 1;
    VacCalendarView._fetch();
  },

  _fetch: function() {
    var el = document.getElementById('vac-cal-content');
    if (el) el.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    APP.api('vacations.calendarMonth', { year: VacCalendarView._year, month: VacCalendarView._month }, function(err, data) {
      if (err) { APP.toast(err, 'error'); return; }
      VacCalendarView._render(data);
    });
  },

  _nav: function(delta) {
    VacCalendarView._month += delta;
    if (VacCalendarView._month > 12) { VacCalendarView._month = 1;  VacCalendarView._year++; }
    if (VacCalendarView._month < 1)  { VacCalendarView._month = 12; VacCalendarView._year--; }
    VacCalendarView._fetch();
  },

  _render: function(data) {
    var y = data.year; var m = data.month;
    var requests  = data.requests  || [];
    var holidays  = data.holidays  || [];
    var monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    var dayNames   = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

    // Map date → list of requests
    var byDay = {};
    requests.forEach(function(r) {
      var cur = new Date(r.startDate + 'T12:00:00');
      var end = new Date(r.endDate   + 'T12:00:00');
      while (cur <= end) {
        var ds = cur.toISOString().split('T')[0];
        if (!byDay[ds]) byDay[ds] = [];
        byDay[ds].push(r);
        cur.setDate(cur.getDate() + 1);
      }
    });

    // Map date → holiday name
    var holidayMap = {};
    holidays.forEach(function(h) { if (h.date) holidayMap[h.date] = h.name || 'Feriado'; });

    // Palette for employees (cycle through colors)
    var palette = ['#3B82F6','#8B5CF6','#EC4899','#F59E0B','#10B981','#EF4444','#06B6D4','#84CC16','#F97316','#6366F1'];
    var empColors = {};
    var colorIdx  = 0;
    requests.forEach(function(r) {
      if (!empColors[r.employeeId]) { empColors[r.employeeId] = palette[colorIdx % palette.length]; colorIdx++; }
    });

    // Build calendar grid
    var firstDay = new Date(y, m - 1, 1).getDay(); // 0=Sun
    var daysInMonth = new Date(y, m, 0).getDate();
    var today = new Date(); today.setHours(0,0,0,0);
    var todayStr = today.toISOString().split('T')[0];

    var header =
      '<div class="view-title"><span class="material-icons-round">event</span>Calendario de Vacaciones</div>' +
      '<div class="card mb-20" style="padding:12px 20px">' +
        '<div class="flex items-center justify-between">' +
          '<button class="btn btn-outline btn-sm" onclick="VacCalendarView._nav(-1)"><span class="material-icons-round">chevron_left</span></button>' +
          '<span class="font-600" style="font-size:16px">' + monthNames[m-1] + ' ' + y + '</span>' +
          '<button class="btn btn-outline btn-sm" onclick="VacCalendarView._nav(1)"><span class="material-icons-round">chevron_right</span></button>' +
        '</div>' +
      '</div>';

    // Legend
    var legend = '';
    if (requests.length) {
      var seen = {};
      legend = '<div class="card mb-20" style="padding:12px 16px"><div class="flex gap-12 flex-wrap">';
      requests.forEach(function(r) {
        if (seen[r.employeeId]) return; seen[r.employeeId] = true;
        var col = empColors[r.employeeId];
        legend += '<div class="flex items-center gap-6"><div style="width:10px;height:10px;border-radius:50%;background:' + col + ';flex-shrink:0"></div>' +
          '<span class="text-sm">' + r.employeeName + '</span>' +
          (r.department ? '<span class="text-xs text-muted">· ' + r.department + '</span>' : '') + '</div>';
      });
      legend += '</div></div>';
    }

    // Day headers
    var grid = '<div class="card" style="padding:16px"><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:8px">';
    dayNames.forEach(function(d) {
      grid += '<div style="text-align:center;font-size:11px;font-weight:600;color:var(--text-muted);padding:4px;text-transform:uppercase">' + d + '</div>';
    });
    grid += '</div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">';

    // Empty cells before first day
    for (var i = 0; i < firstDay; i++) grid += '<div></div>';

    for (var day = 1; day <= daysInMonth; day++) {
      var ds  = y + '-' + String(m).padStart(2,'0') + '-' + String(day).padStart(2,'0');
      var dow = new Date(ds + 'T12:00:00').getDay();
      var isWeekend  = dow === 0 || dow === 6;
      var isToday    = ds === todayStr;
      var isHoliday  = !!holidayMap[ds];
      var dayReqs    = byDay[ds] || [];

      var bg   = isToday ? 'var(--primary)' : isHoliday ? 'var(--warning-light,#FEF3C7)' : isWeekend ? 'var(--bg)' : 'var(--surface)';
      var fc   = isToday ? '#fff' : 'var(--text)';
      var border = isToday ? 'none' : '1px solid var(--border)';

      var chips = dayReqs.slice(0, 3).map(function(r) {
        var col = empColors[r.employeeId];
        return '<div title="' + r.employeeName + '" style="background:' + col + ';color:#fff;border-radius:4px;font-size:9px;font-weight:600;padding:1px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">' + r.employeeName + '</div>';
      }).join('');
      if (dayReqs.length > 3) chips += '<div style="font-size:9px;color:var(--text-muted);padding-left:2px">+' + (dayReqs.length - 3) + '</div>';

      var holidayLabel = isHoliday ? '<div style="font-size:8px;color:#92400E;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px">' + holidayMap[ds] + '</div>' : '';

      grid += '<div style="background:' + bg + ';border:' + border + ';border-radius:8px;padding:6px;min-height:72px;color:' + fc + '">' +
        '<div style="font-size:12px;font-weight:' + (isToday ? '700' : '500') + '">' + day + '</div>' +
        holidayLabel + chips +
      '</div>';
    }

    grid += '</div></div>';

    // People out this month list
    var listHTML = '';
    if (requests.length) {
      listHTML = '<div class="card mt-20"><div class="card-title"><span class="material-icons-round" style="margin-right:6px">people</span>Ausencias este mes (' + requests.length + ')</div>' +
        '<div class="table-wrap"><table><thead><tr><th>Empleado</th><th>Departamento</th><th>Inicio</th><th>Fin</th><th>Días hábiles</th></tr></thead><tbody>' +
        requests.map(function(r) {
          var col    = empColors[r.employeeId];
          var avatar = '<div class="td-avatar" style="width:28px;height:28px;font-size:11px">' + APP.initials(r.employeeName) + '</div>';
          return '<tr><td><div class="flex items-center gap-8">' +
            '<div style="width:8px;height:8px;border-radius:50%;background:' + col + ';flex-shrink:0"></div>' +
            avatar +
            '<span class="font-600 text-sm">' + r.employeeName + '</span></div></td>' +
            '<td class="text-sm text-muted">' + (r.department || '—') + '</td>' +
            '<td class="text-sm">' + APP.fmtDate(r.startDate) + '</td>' +
            '<td class="text-sm">' + APP.fmtDate(r.endDate) + '</td>' +
            '<td class="text-sm">' + (r.workingDays || '—') + '</td></tr>';
        }).join('') +
        '</tbody></table></div></div>';
    }

    var el = document.getElementById('vac-cal-content');
    if (el) el.innerHTML = header + legend + grid + listHTML;
  }
};

// ── VAC HISTORY VIEW (HR / Admin only) ───────────────────────
var VacHistoryView = {
  _data:   [],
  _filter: { status: '', search: '' },

  load: function() {
    var el = document.getElementById('vac-history-content');
    if (!el) return;
    el.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    APP.api('vacations.allRequests', {}, function(err, data) {
      if (err) {
        el.innerHTML = '<div class="empty-state"><span class="material-icons-round">error_outline</span><p>' + err + '</p></div>';
        return;
      }
      VacHistoryView._data   = data || [];
      VacHistoryView._filter = { status: '', search: '' };
      VacHistoryView._render();
    });
  },

  _render: function() {
    var el = document.getElementById('vac-history-content');
    if (!el) return;
    var f    = VacHistoryView._filter;
    var rows = VacHistoryView._data.filter(function(r) {
      if (f.status && r.status !== f.status) return false;
      if (f.search) {
        var s    = f.search.toLowerCase();
        var name = (r.employeeName || '').toLowerCase();
        var dept = (r.department   || '').toLowerCase();
        if (name.indexOf(s) === -1 && dept.indexOf(s) === -1) return false;
      }
      return true;
    });

    var statuses = ['Pendiente', 'Pendiente Manager', 'Aprobado', 'Rechazado', 'Cancelado'];

    var html = '<div class="view-title"><span class="material-icons-round">manage_search</span>Historial de Vacaciones</div>';

    html += '<div class="card mb-16" style="padding:12px 16px">' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">' +
        '<div class="form-group" style="margin:0;flex:1;min-width:200px">' +
          '<input id="vhist-search" placeholder="Buscar empleado o área..." value="' + (f.search || '') + '" ' +
          'oninput="VacHistoryView._onSearch(this.value)" style="width:100%">' +
        '</div>' +
        '<div class="form-group" style="margin:0">' +
          '<select id="vhist-status" onchange="VacHistoryView._onStatus(this.value)">' +
            '<option value="">Todos los estatus</option>' +
            statuses.map(function(s) {
              return '<option value="' + s + '"' + (f.status === s ? ' selected' : '') + '>' + s + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
        '<div style="color:var(--text-muted);font-size:13px;white-space:nowrap">' +
          rows.length + ' de ' + VacHistoryView._data.length + ' solicitudes' +
        '</div>' +
      '</div>' +
    '</div>';

    html += '<div class="card"><div class="table-wrap"><table><thead><tr>' +
      '<th>Empleado</th><th>Área</th><th>Inicio</th><th>Fin</th>' +
      '<th style="text-align:center">Días hábiles</th><th>Motivo</th><th>Estado</th><th>Solicitado</th>' +
      '</tr></thead><tbody>';

    if (!rows.length) {
      html += '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted)">Sin resultados</td></tr>';
    } else {
      html += rows.map(function(r) {
        var reqDate = r.requestedAt ? APP.fmtDate(r.requestedAt.split('T')[0]) : '—';
        return '<tr>' +
          '<td style="font-weight:500">' + (r.employeeName || '—') + '</td>' +
          '<td class="text-sm" style="color:var(--text-muted)">' + (r.department || '—') + '</td>' +
          '<td class="text-sm">' + APP.fmtDate(r.startDate) + '</td>' +
          '<td class="text-sm">' + APP.fmtDate(r.endDate) + '</td>' +
          '<td class="text-sm" style="text-align:center">' + (r.workingDays || 0) + '</td>' +
          '<td class="text-sm" style="color:var(--text-muted)">' + (r.reason || '—') + '</td>' +
          '<td>' + APP.badgeStatus(r.status) + '</td>' +
          '<td class="text-sm" style="color:var(--text-muted)">' + reqDate + '</td>' +
          '</tr>';
      }).join('');
    }

    html += '</tbody></table></div></div>';
    el.innerHTML = html;
  },

  _onSearch: function(val) { VacHistoryView._filter.search = val; VacHistoryView._render(); },
  _onStatus: function(val) { VacHistoryView._filter.status = val; VacHistoryView._render(); }
};

// ── VAC BALANCE VIEW (admin/HR) ───────────────────────────────
var VacBalanceView = {
  _data:   [],
  _search: '',

  load: function() {
    var el = document.getElementById('vac-balance-content');
    if (!el) return;
    el.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    APP.api('vacations.allBalances', {}, function(err, data) {
      if (err) { el.innerHTML = '<div class="empty-state"><p>' + err + '</p></div>'; return; }
      VacBalanceView._data   = data || [];
      VacBalanceView._search = '';
      VacBalanceView._render();
    });
  },

  _render: function() {
    var el = document.getElementById('vac-balance-content');
    if (!el) return;
    var q    = VacBalanceView._search.toLowerCase();
    var rows = VacBalanceView._data.filter(function(r) {
      return !q || r.employeeName.toLowerCase().indexOf(q) > -1 || (r.department||'').toLowerCase().indexOf(q) > -1 || (r.hierarchyLevel||'').toLowerCase().indexOf(q) > -1;
    });
    var isAdmin = APP.user && APP.user.isAdmin;

    var html =
      '<div class="view-title"><span class="material-icons-round">event_available</span>Concentrado de Vacaciones ' + (VacBalanceView._data[0] ? VacBalanceView._data[0].year : new Date().getFullYear()) + '</div>' +
      '<div class="card mb-16" style="padding:12px 16px">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span class="material-icons-round" style="color:var(--text-muted);font-size:18px">search</span>' +
          '<input placeholder="Buscar empleado, departamento o nivel..." oninput="VacBalanceView._onSearch(this.value)" style="flex:1;border:none;outline:none;background:transparent;font-size:14px;color:var(--text)">' +
          (isAdmin ? '<button class="btn btn-outline btn-sm" onclick="VacBalanceView.recalcAll()"><span class="material-icons-round" style="font-size:15px">refresh</span>Recalcular balances</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="card" style="padding:0"><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">' +
      '<thead><tr style="border-bottom:2px solid var(--border)">' +
        '<th style="text-align:left;padding:10px 14px;font-size:12px;color:var(--text-muted);white-space:nowrap">Empleado</th>' +
        '<th style="text-align:left;padding:10px 14px;font-size:12px;color:var(--text-muted);white-space:nowrap">Nivel Jerárquico</th>' +
        '<th style="text-align:left;padding:10px 14px;font-size:12px;color:var(--text-muted);white-space:nowrap">Departamento</th>' +
        '<th style="text-align:center;padding:10px 14px;font-size:12px;color:var(--text-muted);white-space:nowrap">Fecha<br>de ingreso</th>' +
        '<th style="text-align:center;padding:10px 14px;font-size:12px;color:var(--text-muted);white-space:nowrap">Antigüedad</th>' +
        '<th style="text-align:center;padding:10px 14px;font-size:12px;color:var(--text-muted)">Días<br>asignados</th>' +
        '<th style="text-align:center;padding:10px 14px;font-size:12px;color:var(--text-muted)">Usados</th>' +
        '<th style="text-align:center;padding:10px 14px;font-size:12px;color:var(--text-muted)">Pendientes</th>' +
        '<th style="text-align:center;padding:10px 14px;font-size:12px;color:var(--text-muted)">Disponibles</th>' +
        (isAdmin ? '<th style="padding:10px 14px"></th>' : '') +
      '</tr></thead><tbody>' +
      rows.map(function(r) {
        var pct = r.daysEntitled > 0 ? Math.round(r.daysUsed / r.daysEntitled * 100) : 0;
        var barColor = r.daysRemaining <= 2 ? '#DC2626' : r.daysRemaining <= 5 ? '#D97706' : '#16A34A';
        var hierColor = { 'CEO': '#6366f1', 'Heads': '#8b5cf6', 'Managers': '#0ea5e9', 'Supervisores': '#10b981', 'Operativo y Administrativo': '#64748b' }[r.hierarchyLevel] || '#94a3b8';
        var hireFmt = r.hireDate ? r.hireDate.split('T')[0] : '—';
        var seniority = r.yearsOfService === null || r.yearsOfService === undefined
          ? '—'
          : r.yearsOfService === 0 ? '< 1 año'
          : r.yearsOfService === 1 ? '1 año'
          : r.yearsOfService + ' años';
        return '<tr style="border-bottom:1px solid var(--border)">' +
          '<td style="padding:10px 14px">' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<div class="td-avatar" style="width:30px;height:30px;font-size:11px;flex-shrink:0">' + APP.initials(r.employeeName) + '</div>' +
              '<div><div style="font-weight:600;font-size:13px">' + r.employeeName + '</div>' +
              '<div style="font-size:11px;color:var(--text-muted)">' + r.jobTitle + '</div></div>' +
            '</div>' +
          '</td>' +
          '<td style="padding:10px 14px">' +
            (r.hierarchyLevel && r.hierarchyLevel !== '—' ? '<span style="font-size:11px;font-weight:600;color:' + hierColor + ';background:' + hierColor + '18;border-radius:4px;padding:2px 8px;white-space:nowrap">' + r.hierarchyLevel + '</span>' : '<span style="font-size:12px;color:var(--text-muted)">Sin asignar</span>') +
          '</td>' +
          '<td style="padding:10px 14px;font-size:13px;color:var(--text-muted)">' + r.department + '</td>' +
          '<td style="padding:10px 14px;text-align:center;font-size:13px;color:var(--text-muted);white-space:nowrap">' + hireFmt + '</td>' +
          '<td style="padding:10px 14px;text-align:center;font-size:13px;white-space:nowrap">' + seniority + '</td>' +
          '<td style="padding:10px 14px;text-align:center;font-size:13px;font-weight:600">' + r.daysEntitled + '</td>' +
          '<td style="padding:10px 14px;text-align:center;font-size:13px">' + r.daysUsed + '</td>' +
          '<td style="padding:10px 14px;text-align:center;font-size:13px;color:var(--warning)">' + (r.daysPending > 0 ? r.daysPending : '—') + '</td>' +
          '<td style="padding:10px 14px;text-align:center">' +
            '<span style="font-weight:700;font-size:15px;color:' + barColor + '">' + r.daysRemaining + '</span>' +
            '<div style="height:4px;background:var(--border);border-radius:2px;margin-top:4px;width:56px;margin-left:auto;margin-right:auto">' +
              '<div style="height:4px;background:' + barColor + ';width:' + Math.min(100,pct) + '%;border-radius:2px"></div>' +
            '</div>' +
          '</td>' +
          (isAdmin ? '<td style="padding:10px 14px;text-align:right">' +
            '<button class="btn btn-outline btn-sm" onclick="VacBalanceView.openAdjust(\'' + r.employeeId + '\',\'' + r.employeeName.replace(/'/g,"\\'") + '\',' + r.daysRemaining + ')">Ajustar</button>' +
          '</td>' : '') +
        '</tr>';
      }).join('') +
      '</tbody></table></div></div>';

    el.innerHTML = html;
  },

  _onSearch: function(val) {
    VacBalanceView._search = val;
    VacBalanceView._render();
    var inp = document.querySelector('#vac-balance-content input');
    if (inp) { inp.value = val; inp.focus(); inp.setSelectionRange(val.length, val.length); }
  },

  recalcAll: function() {
    if (!confirm('¿Recalcular los balances de vacaciones de todos los empleados según su nivel jerárquico actual?')) return;
    APP.api('vacations.recalculate', {}, function(err, data) {
      if (err) { APP.toast(err, 'error'); return; }
      APP.toast('✅ Balances recalculados: ' + (data && data.updated ? data.updated + ' empleados' : 'OK'), 'success');
      VacBalanceView.load();
    });
  },

  openAdjust: function(empId, empName, currentDays) {
    var body =
      '<p class="text-sm text-muted mb-16">Empleado: <strong>' + empName + '</strong> · Disponibles actualmente: <strong>' + currentDays + ' días</strong></p>' +
      '<div class="form-row">' +
        '<div class="form-group">' +
          '<label>Ajuste (días) *</label>' +
          '<input type="number" id="adj-delta" placeholder="Ej: 3 para agregar, -2 para quitar" style="width:100%">' +
          '<span class="text-xs text-muted">Número positivo = agregar · negativo = quitar</span>' +
        '</div>' +
      '</div>' +
      '<div class="form-group"><label>Motivo *</label><input id="adj-reason" placeholder="Ej: Días adicionales por convenio, corrección de saldo..." style="width:100%"></div>';

    APP.modal('✏️ Ajustar Vacaciones — ' + empName, body,
      '<button class="btn btn-outline" onclick="APP.closeModal()">Cancelar</button>' +
      '<button class="btn btn-primary" onclick="VacBalanceView.saveAdjust(\'' + empId + '\')"><span class="material-icons-round">save</span>Guardar ajuste</button>'
    );
  },

  saveAdjust: function(empId) {
    var delta  = parseInt((document.getElementById('adj-delta')  || {}).value);
    var reason = ((document.getElementById('adj-reason') || {}).value || '').trim();
    if (!delta || isNaN(delta)) { APP.toast('Ingresa un número de días válido', 'error'); return; }
    if (!reason) { APP.toast('El motivo es obligatorio', 'error'); return; }
    APP.api('vacations.adjustBalance', { employeeId: empId, delta: delta, reason: reason }, function(err, res) {
      if (err) { APP.toast(err, 'error'); return; }
      APP.closeModal();
      var sign = delta > 0 ? '+' : '';
      APP.toast('✅ Ajuste aplicado (' + sign + delta + ' días). Disponibles: ' + res.newRemaining, 'success');
      VacBalanceView.load();
    });
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
      (APP.user.isAdmin||APP.user.isHR ? '<button class="btn btn-outline" onclick="VacationsView.recalcBalances()"><span class="material-icons-round">sync</span>Recalcular balances</button>' : '') +
      '</div>';
    var sorted = reqs.slice().sort(function(a,b){ return (b.startDate||'') > (a.startDate||'') ? 1 : -1; });
    html += '<div class="card mb-20">' +
      '<div class="card-title"><span class="material-icons-round" style="margin-right:6px">history</span>Historial de Solicitudes</div>';
    if (!sorted.length) {
      html += '<div class="empty-state"><span class="material-icons-round">beach_access</span><p>Sin solicitudes aún</p></div>';
    } else {
      html += '<div class="table-wrap"><table><thead><tr>' +
        '<th>Inicio</th><th>Fin</th><th style="text-align:center">Días hábiles</th><th>Motivo</th><th>Estado</th><th></th>' +
        '</tr></thead><tbody>' +
        sorted.map(function(r) {
          var canCancel = r.status === 'Pendiente' || r.status === 'Pendiente Manager' || (r.status === 'Aprobado' && new Date(r.startDate) > new Date());
          return '<tr>' +
            '<td class="text-sm">' + APP.fmtDate(r.startDate) + '</td>' +
            '<td class="text-sm">' + APP.fmtDate(r.endDate) + '</td>' +
            '<td class="text-sm" style="text-align:center">' + (r.workingDays||0) + '</td>' +
            '<td class="text-sm" style="color:var(--text-muted)">' + (r.reason || '—') + '</td>' +
            '<td>' + APP.badgeStatus(r.status) + '</td>' +
            '<td>' + (canCancel ? '<button class="btn btn-outline btn-sm" onclick="VacationsView.cancelReq(\'' + r.id + '\')">Cancelar</button>' : '') + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table></div>';
    }
    html += '</div>';
    VacationsView._hols = hols;
    var _c = VacationsView._country || 'MX';
    var _countryChips = {MX:'🇲🇽 MX',AR:'🇦🇷 AR',BR:'🇧🇷 BR',US:'🇺🇸 US',JP:'🇯🇵 JP',CO:'🇨🇴 CO',PA:'🇵🇦 PA'};
    html += '<div class="card">' +
      '<div class="card-title">📅 Feriados ' + new Date().getFullYear() + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">' +
      Object.keys(_countryChips).map(function(k) {
        var on = k === _c;
        return '<button id="hol-chip-'+k+'" onclick="VacationsView._setCountry(\''+k+'\')" style="padding:5px 13px;border-radius:20px;border:2px solid '+(on?'var(--primary)':'var(--border)')+';background:'+(on?'var(--primary)':'transparent')+';color:'+(on?'#fff':'var(--text)')+';font-size:0.8rem;font-weight:'+(on?'700':'400')+';cursor:pointer;transition:all .15s">'+_countryChips[k]+'</button>';
      }).join('') +
      '</div>' +
      '<div id="hol-list">' + VacationsView._holRows(hols, _c) + '</div>' +
      '</div>';
    el.innerHTML = html;
  },
  requestCard: function(r) {
    var canCancel = r.status === 'Pendiente' || r.status === 'Pendiente Manager' || (r.status === 'Aprobado' && new Date(r.startDate) > new Date());
    return '<div class="request-card mt-8"><div>' +
      '<div class="request-dates">📅 ' + APP.fmtDate(r.startDate) + ' → ' + APP.fmtDate(r.endDate) + '</div>' +
      '<div class="request-days">' + r.workingDays + ' días hábiles' + (r.reason ? ' · ' + r.reason : '') + '</div></div>' +
      APP.badgeStatus(r.status) + (canCancel ? '<button class="btn btn-outline btn-sm" onclick="VacationsView.cancelReq(\'' + r.id + '\')">Cancelar</button>' : '') + '</div>';
  },
  openRequest: function() {
    var today = new Date().toISOString().split('T')[0];
    APP.modal('🏖️ Solicitar Vacaciones',
      '<div class="alert info mb-16">ℹ️ Solo se contarán días hábiles (lunes a viernes, excluyendo feriados).</div>' +
      '<div id="vac-short-notice-warn" class="alert warning mb-16" style="display:none">⚠️ La fecha de inicio tiene menos de 7 días de anticipación. Tu solicitud se enviará de todas formas, pero los aprobadores verán este aviso.</div>' +
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
      var warnEl = document.getElementById('vac-short-notice-warn');
      if (warnEl) {
        var today2 = new Date(); today2.setHours(0, 0, 0, 0);
        var diff = Math.ceil((new Date(s) - today2) / 86400000);
        warnEl.style.display = diff < 7 ? 'block' : 'none';
      }
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
  recalcBalances: function() {
    if (!confirm('¿Recalcular los balances de vacaciones de todos los empleados? Esto actualizará los días según su antigüedad.')) return;
    APP.api('vacations.recalcBalances', {}, function(err, result) {
      if (err) { APP.toast(err, 'error'); return; }
      var msg = '✅ Balances recalculados: ' + (result && result.updated || 0) + ' empleados actualizados.';
      APP.toast(msg, 'success');
      VacationsView.load();
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
          var daysUntil = typeof r.daysUntilStart === 'number' ? r.daysUntilStart : null;
          var urgentWarn = daysUntil !== null && daysUntil < 7
            ? '<div style="background:#FEF3C7;border-left:3px solid #D97706;padding:4px 8px;border-radius:0 4px 4px 0;font-size:12px;color:#92400E;margin:4px 0">⚠️ Solicitud urgente — inicia en ' + daysUntil + ' día' + (daysUntil !== 1 ? 's' : '') + '</div>'
            : '';
          return '<div class="request-card mt-8"><div><div class="font-600 text-sm">' + r.employeeName + '</div>' +
            '<div class="request-dates">' + APP.fmtDate(r.startDate) + ' → ' + APP.fmtDate(r.endDate) + '</div>' +
            '<div class="request-days">' + r.workingDays + ' días hábiles' + (r.reason ? ' · ' + r.reason : '') + '</div>' +
            urgentWarn + '</div>' +
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
      VacationsView.loadTeamRequests();
      APP.updateApprovalBadge();
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
      VacationsView.loadTeamRequests();
      APP.updateApprovalBadge();
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
    var deptOpts    = ['Dirección','Sales','Sales Operations','Operations','INT OPS','Nodalink','Ikan Hub','RH','Marketing','Contabilidad'].map(function(d){return{value:d,label:d};});
    var typeOpts    = ['Planta','Contrato','Por Proyecto','Temporal'].map(function(t){return{value:t,label:t};});
    var countryOpts = [{value:'MX',label:'🇲🇽 México'},{value:'AR',label:'🇦🇷 Argentina'},{value:'BR',label:'🇧🇷 Brasil'},{value:'US',label:'🇺🇸 EE.UU.'},{value:'JP',label:'🇯🇵 Japón'},{value:'CO',label:'🇨🇴 Colombia'},{value:'PA',label:'🇵🇦 Panamá'}];
    var hierOpts    = [{value:'',label:'— Sin asignar —'},{value:'CEO',label:'CEO'},{value:'Heads',label:'Heads'},{value:'Managers',label:'Managers'},{value:'Supervisores',label:'Supervisores'},{value:'Operativo y Administrativo',label:'Operativo y Administrativo'}];
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
      '<div class="form-group"><label>Nivel jerárquico</label>' + sel('ef-hier', hierOpts, v.hierarchyLevel||'') + '</div>' +
      '<div class="form-group"><label>País</label>' + sel('ef-country', countryOpts, v.country||'MX') + '</div>' +
      '<div class="form-group"><label>Status</label>' + sel('ef-status', [{value:'activo',label:'Activo'},{value:'inactivo',label:'Inactivo'}], v.status||'activo') + '</div>' +
      '</div>' +
      (function() {
        var rem = v.isRemote===true||v.isRemote==='true';
        var trackBg = rem ? '#3b82f6' : 'var(--border)';
        var knobLeft = rem ? '21px' : '3px';
        var onChange = "var c=this.checked,t=document.getElementById('ef-rt'),k=document.getElementById('ef-rk'),p=document.getElementById('ef-pin-wrap');t.style.background=c?'#3b82f6':'var(--border)';k.style.left=c?'21px':'3px';p.style.opacity=c?'0.4':'1';p.querySelector('input').disabled=c;";
        return '<div class="form-group" style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg);border-radius:6px;cursor:pointer" onclick="document.getElementById(\'ef-remote\').click()">' +
          '<div style="position:relative;width:40px;height:22px;flex-shrink:0;pointer-events:none">' +
          '<input type="checkbox" id="ef-remote" style="position:absolute;opacity:0;width:0;height:0"' + (rem?' checked':'') + ' onchange="' + onChange + '">' +
          '<div id="ef-rt" style="position:absolute;inset:0;background:' + trackBg + ';border-radius:22px;transition:.2s"></div>' +
          '<div id="ef-rk" style="position:absolute;height:16px;width:16px;left:' + knobLeft + ';bottom:3px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>' +
          '</div>' +
          '<div><strong style="font-size:13px">Empleado remoto</strong><br><span style="font-size:11px;color:var(--muted)">No usa el checador físico</span></div>' +
          '</div>';
      })() +
      (function() {
        var remDays = Array.isArray(v.remoteDays) ? v.remoteDays : [];
        var dayList = [{d:2,l:'Mar'},{d:3,l:'Mié'},{d:4,l:'Jue'},{d:6,l:'Sáb'}];
        var canEditHoDays = APP.user && (APP.user.isAdmin || APP.user.isHR || v.managerId === APP.user.id);
        var pillsHtml = '';
        if (canEditHoDays) {
          dayList.forEach(function(item) {
            var sel = remDays.indexOf(item.d) > -1;
            pillsHtml += '<button type="button" data-day="' + item.d + '" onclick="AdminHR._toggleRemoteDay(this,' + item.d + ')" ' +
              'style="padding:5px 11px;border-radius:20px;font-size:12px;cursor:pointer;transition:.15s;border:1px solid ' +
              (sel ? '#93c5fd;background:#dbeafe;color:#1d4ed8;font-weight:600' : 'var(--border);background:var(--surface);color:var(--fg);font-weight:400') + '">' +
              item.l + '</button>';
          });
        } else {
          var dayLabels = {2:'Mar',3:'Mié',4:'Jue',6:'Sáb'};
          if (remDays.length > 0) {
            remDays.forEach(function(d) {
              pillsHtml += '<span style="padding:5px 11px;border-radius:20px;font-size:12px;background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;font-weight:600">' + (dayLabels[d] || d) + '</span>';
            });
          } else {
            pillsHtml = '<span style="font-size:12px;color:var(--muted)">Sin días asignados</span>';
          }
        }
        return '<input type="hidden" id="ef-remote-days-val" value="' + JSON.stringify(remDays) + '">' +
          '<div id="ef-remote-days-wrap" style="margin-bottom:12px">' +
          '<label style="display:block;font-size:12px;color:var(--muted);margin-bottom:8px">Días de home office autorizados</label>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap">' + pillsHtml + '</div>' +
          (canEditHoDays ? '<p style="margin:6px 0 0;font-size:11px;color:var(--muted)">Sin selección = sin restricción de días. Check-in en día no autorizado requiere aprobación del manager.</p>' : '') +
          '</div>';
      })() +
      '<div id="ef-pin-wrap" style="' + (v.isRemote===true||v.isRemote==='true'?'opacity:.4':'opacity:1') + '">' +
      '<div class="form-group"><label>PIN Checador</label><input id="ef-pin" placeholder="Número de ID en el checador" value="' + (v.checadorPin||'') + '"' + (v.isRemote===true||v.isRemote==='true'?' disabled':'') + '></div>' +
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
      contractType:   (document.getElementById('ef-type')   ||{value:''}).value,
      hierarchyLevel: (document.getElementById('ef-hier')   ||{value:''}).value,
      country:        (document.getElementById('ef-country') ||{value:'MX'}).value,
      status:    (document.getElementById('ef-status')  ||{value:''}).value,
      notes:     (document.getElementById('ef-notes')||{value:''}).value,
      isRemote:    !!(document.getElementById('ef-remote')&&document.getElementById('ef-remote').checked),
      checadorPin: (document.getElementById('ef-pin')||{value:''}).value.trim() || null,
      canApproveVacations: !!(document.getElementById('ef-cap')&&document.getElementById('ef-cap').checked),
      remoteDays: (function() {
        var inp = document.getElementById('ef-remote-days-val');
        if (!inp) return null;
        try { var arr = JSON.parse(inp.value || '[]'); return arr.length > 0 ? arr : null; } catch(e) { return null; }
      })()
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

  _toggleRemoteDay: function(btn, day) {
    var inp = document.getElementById('ef-remote-days-val');
    if (!inp) return;
    var days = [];
    try { days = JSON.parse(inp.value || '[]'); } catch(e) {}
    var idx = days.indexOf(day);
    if (idx > -1) {
      days.splice(idx, 1);
      btn.style.background = 'var(--surface)';
      btn.style.color = 'var(--fg)';
      btn.style.borderColor = 'var(--border)';
      btn.style.fontWeight = '400';
    } else {
      days.push(day);
      btn.style.background = '#dbeafe';
      btn.style.color = '#1d4ed8';
      btn.style.borderColor = '#93c5fd';
      btn.style.fontWeight = '600';
    }
    inp.value = JSON.stringify(days);
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
    var kpiModal = document.querySelector('#app-modal .modal'); if (kpiModal) kpiModal.style.maxWidth = '900px';
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
            '<button class="btn btn-outline btn-sm" onclick="AdminHR.openExtendPeriod(\''+p.id+'\',\''+(p.endDate||'')+'\',\''+(p.selfAssessmentDeadline||'')+'\',\''+(p.managerReviewDeadline||'')+'\')"><span class="material-icons-round" style="font-size:14px;vertical-align:middle">edit_calendar</span> Editar fechas</button> ' +
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
    var prevM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    var evalLabel = type === 'Bimestral'
      ? MONTHS[new Date(now.getFullYear(), now.getMonth()-2, 1).getMonth()] + ' - ' + MONTHS[prevM.getMonth()] + ' ' + prevM.getFullYear()
      : type === 'Semestral'
      ? MONTHS[new Date(now.getFullYear(), now.getMonth()-6, 1).getMonth()] + ' - ' + MONTHS[prevM.getMonth()] + ' ' + prevM.getFullYear()
      : MONTHS[prevM.getMonth()] + ' ' + prevM.getFullYear();
    var name = 'Evaluación ' + evalLabel + (posName && posName.indexOf('Todos')===-1 ? ' — ' + posName : '');
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
    function dateBtn(fieldId, label, dateStr) {
      var parts = dateStr ? dateStr.split('-') : [];
      var display = parts.length === 3 ? parts[2]+'/'+parts[1]+'/'+parts[0] : '— seleccionar —';
      return '<div class="form-group">' +
        '<label style="margin-bottom:5px">' + label + '</label>' +
        '<button id="'+fieldId+'" data-orig="'+(dateStr||'')+'" data-value="'+(dateStr||'')+'" ' +
          'onclick="AdminHR._pickExtDate(\''+fieldId+'\')" ' +
          'style="width:100%;text-align:left;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);cursor:pointer;font-size:14px;display:flex;align-items:center;gap:8px">' +
          '<span class="material-icons-round" style="font-size:16px;color:var(--primary)">event</span>' +
          '<span id="'+fieldId+'-txt">'+display+'</span>' +
        '</button>' +
      '</div>';
    }
    APP.modal('📅 Editar fechas del período',
      dateBtn('epick-end',  'Fecha de fin del período', currentEnd) +
      dateBtn('epick-self', 'Límite autocalificación',  currentSelfDl) +
      dateBtn('epick-mgr',  'Límite revisión manager',  currentMgrDl),
      '<button class="btn btn-outline" onclick="APP.closeModal();MiniCal.hide()">Cancelar</button>' +
      '<button class="btn btn-primary" onclick="AdminHR.saveExtendPeriod(\''+id+'\',\''+currentEnd+'\')"><span class="material-icons-round">save</span>Guardar cambios</button>');
  },
  _pickExtDate: function(fieldId) {
    var btn = document.getElementById(fieldId);
    if (!btn) return;
    MiniCal.show(btn, btn.dataset.value || '', function(ds) {
      btn.dataset.value = ds;
      var parts = ds.split('-');
      var txt = document.getElementById(fieldId + '-txt');
      if (txt) txt.textContent = parts[2]+'/'+parts[1]+'/'+parts[0];
    });
  },
  saveExtendPeriod: function(id, originalEnd) {
    function val(fid) { var b = document.getElementById(fid); return b ? b.dataset.value : ''; }
    var endDate = val('epick-end'), selfDl = val('epick-self'), mgrDl = val('epick-mgr');
    if (endDate && endDate <= originalEnd) { APP.toast('La nueva fecha de fin debe ser posterior a '+APP.fmtDate(originalEnd),'error'); return; }
    var data = { periodId: id };
    var endOrig  = (document.getElementById('epick-end')  ||{dataset:{}}).dataset.orig  || '';
    var selfOrig = (document.getElementById('epick-self') ||{dataset:{}}).dataset.orig || '';
    var mgrOrig  = (document.getElementById('epick-mgr')  ||{dataset:{}}).dataset.orig  || '';
    if (endDate  && endDate  !== endOrig)  data.endDate               = endDate;
    if (selfDl   && selfDl   !== selfOrig) data.selfAssessmentDeadline = selfDl;
    if (mgrDl    && mgrDl    !== mgrOrig)  data.managerReviewDeadline  = mgrDl;
    if (!data.endDate && !data.selfAssessmentDeadline && !data.managerReviewDeadline) { APP.toast('No hay cambios para guardar','error'); return; }
    APP.api('kpi.periods.extend', data, function(err) {
      if (err) { APP.toast(err,'error'); return; }
      APP.closeModal(); APP.toast('✅ Fechas actualizadas','success'); AdminHR.openKPIAdmin('evaluaciones');
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
        '<button class="btn btn-outline btn-sm" onclick="AdminHR.openBatchEditKPI(\''+pId+'\')"><span class="material-icons-round" style="font-size:14px">edit</span>Editar</button>' +
        '<button class="btn btn-outline btn-sm" onclick="AdminHR.openBatchKPI(\''+pId+'\')"><span class="material-icons-round" style="font-size:14px">add</span>Agregar</button></div></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Período</th><th>Peso</th><th>Meta</th><th>Estado</th><th></th></tr></thead><tbody>' +
        pKpis.map(function(k){
          return '<tr><td><strong>'+k.name+'</strong>'+(k.category?'<br><span class="text-xs text-muted">'+k.category+'</span>':'')+
            '</td><td>'+k.periodType+'</td><td><strong>'+k.weight+'%</strong></td><td>'+(k.target||'—')+'</td>' +
            '<td>'+(String(k.isActive)==='true'?'<span class="badge badge-success">Activo</span>':'<span class="badge badge-gray">Inactivo</span>')+'</td>' +
            '<td style="white-space:nowrap">' +
              '<button class="btn btn-outline btn-sm" onclick="AdminHR.openEditKPI(\''+k.id+'\')" style="margin-right:4px">Editar</button>' +
              '<button class="btn btn-outline btn-sm" onclick="AdminHR.deleteKPI(\''+k.id+'\',\''+k.name.replace(/'/g,"\\'")+'\''+')" style="color:var(--danger)">Eliminar</button>' +
            '</td></tr>';
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
      '<div class="form-group"><label>Periodicidad de meta <span style="font-size:11px;font-weight:400;color:var(--text-muted)">(todos evalúan mensualmente)</span></label>'+sel('kf-period',[{value:'Mensual',label:'Mensual'},{value:'Bimestral',label:'Bimestral'},{value:'Semestral',label:'Semestral'},{value:'Anual',label:'Anual'}],v.periodType||'Mensual')+'<span style="font-size:11px;color:var(--text-muted);display:block;margin-top:3px">Mensual: la meta se evalúa cada mes · Bimestral: mes 1 es progreso, mes 2 es meta · Semestral: meta cada 6 meses · Anual: meta en diciembre</span></div>' +
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
      AdminHR._batchPeriodOpts='<option>Mensual</option><option>Bimestral</option><option>Semestral</option><option>Anual</option>';
      var body='<div class="form-group" style="margin-bottom:12px"><label>Puesto al que aplican los KPIs</label>'+posSel+'</div>' +
        '<div id="bk-pos-info" style="margin-bottom:14px"></div>' +
        '<div class="flex justify-between items-center mb-8"><span class="font-600 text-sm">Nuevos KPIs</span>' +
        '<button class="btn btn-outline btn-sm" onclick="AdminHR.addBatchRow()"><span class="material-icons-round">add</span>Agregar fila</button></div>' +
        '<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse"><thead>' +
        '<tr style="border-bottom:2px solid var(--border)"><th style="text-align:left;padding:4px 6px;min-width:180px">Nombre *</th>' +
        '<th style="text-align:left;padding:4px 6px;min-width:200px">Descripción</th>' +
        '<th style="text-align:left;padding:4px 6px;min-width:110px">Período</th>' +
        '<th style="text-align:left;padding:4px 6px;min-width:65px">Peso %</th><th style="text-align:left;padding:4px 6px;min-width:100px">Meta</th>' +
        '<th style="text-align:left;padding:4px 6px;min-width:110px">Unidad</th>' +
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
      '<td style="padding:4px 4px"><input class="bk-desc" placeholder="Descripción (opcional)" '+s+'></td>' +
      '<td style="padding:4px 4px"><select class="bk-period" '+s+'>'+po+'</select></td>' +
      '<td style="padding:4px 4px"><input type="number" class="bk-weight" min="1" max="100" value="20" style="width:58px;padding:5px 4px;font-size:12px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)" oninput="AdminHR.updateBatchWeightTotal()"></td>' +
      '<td style="padding:4px 4px"><input class="bk-target" placeholder="Meta" '+s+'></td>' +
      '<td style="padding:4px 4px"><select class="bk-measure" '+s+'>' +
        '<option value="Numérico">Numérico</option>' +
        '<option value="Porcentual">Porcentual (%)</option>' +
        '<option value="Monetario">Monetario ($)</option>' +
        '<option value="Booleano">Sí / No</option>' +
      '</select></td>' +
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
      toSave.push({ name:name, description:(tr.querySelector('.bk-desc')||{value:''}).value.trim(),
        periodType:(tr.querySelector('.bk-period')||{value:'Mensual'}).value,
        weight:(tr.querySelector('.bk-weight')||{value:'20'}).value, target:(tr.querySelector('.bk-target')||{value:''}).value.trim(),
        measureType:(tr.querySelector('.bk-measure')||{value:'Numérico'}).value, positionId:positionId, isActive:true });
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

  _bePositionId:   null,
  _bePositionName: null,
  _beDeletedIds:   [],

  openBatchEditKPI: function(positionId) {
    APP.api('kpi.definitions.list', {}, function(err, kpis) {
      if (err) { APP.toast(err, 'error'); return; }
      var posKpis = (kpis || []).filter(function(k) { return (k.positionId || '') === positionId; });
      AdminHR._withPositions(function(positions) {
        var posName = (positions.filter(function(p) { return p.id === positionId; })[0] || {}).name || 'Sin puesto específico';
        AdminHR._bePositionId   = positionId;
        AdminHR._bePositionName = posName;
        AdminHR._beDeletedIds   = [];

        var s = 'style="padding:5px 6px;font-size:12px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);width:100%"';
        var measureLabel = function(v) { return v === 'Porcentual' ? 'Porcentual (%)' : v === 'Monetario' ? 'Monetario ($)' : v === 'Booleano' ? 'Sí / No' : v; };
        var makeRow = function(k) {
          var mSel = '<select class="be-measure" ' + s + '>' +
            ['Numérico','Porcentual','Monetario','Booleano'].map(function(v) {
              return '<option value="' + v + '"' + (v === (k.measureType || 'Numérico') ? ' selected' : '') + '>' + measureLabel(v) + '</option>';
            }).join('') + '</select>';
          var perSel = '<select class="be-period" ' + s + '>' +
            ['Mensual','Bimestral','Semestral','Anual'].map(function(v) {
              return '<option value="' + v + '"' + (v === (k.periodType || 'Mensual') ? ' selected' : '') + '>' + v + '</option>';
            }).join('') + '</select>';
          return '<tr' + (k.id ? ' data-id="' + k.id + '"' : '') + ' style="border-bottom:1px solid var(--border)">' +
            '<td style="padding:4px 4px"><input class="be-name" value="' + (k.name || '').replace(/"/g, '&quot;') + '" placeholder="Nombre *" ' + s + ' oninput="AdminHR.updateBatchEditWeightTotal()"></td>' +
            '<td style="padding:4px 4px"><input class="be-desc" value="' + (k.description || '').replace(/"/g, '&quot;') + '" placeholder="Descripción" ' + s + '></td>' +
            '<td style="padding:4px 4px">' + perSel + '</td>' +
            '<td style="padding:4px 4px"><input type="number" class="be-weight" min="1" max="100" value="' + (k.weight || 20) + '" style="width:58px;padding:5px 4px;font-size:12px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)" oninput="AdminHR.updateBatchEditWeightTotal()"></td>' +
            '<td style="padding:4px 4px"><input class="be-target" value="' + (k.target || '') + '" placeholder="Meta" ' + s + '></td>' +
            '<td style="padding:4px 4px">' + mSel + '</td>' +
            '<td style="padding:4px 2px;text-align:center">' +
              '<button onclick="AdminHR.deleteBatchEditRow(this)" title="Eliminar" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:16px;line-height:1;padding:4px">×</button>' +
            '</td>' +
          '</tr>';
        };
        var rows = posKpis.map(makeRow).join('');
        var body =
          '<div style="overflow-x:auto"><table id="be-table" style="width:100%;font-size:12px;border-collapse:collapse"><thead>' +
          '<tr style="border-bottom:2px solid var(--border)">' +
          '<th style="text-align:left;padding:4px 6px;min-width:180px">Nombre *</th>' +
          '<th style="text-align:left;padding:4px 6px;min-width:160px">Descripción</th>' +
          '<th style="text-align:left;padding:4px 6px;min-width:110px">Período</th>' +
          '<th style="text-align:left;padding:4px 6px;min-width:65px">Peso %</th>' +
          '<th style="text-align:left;padding:4px 6px;min-width:90px">Meta</th>' +
          '<th style="text-align:left;padding:4px 6px;min-width:110px">Unidad</th>' +
          '<th style="padding:4px 6px;width:32px"></th>' +
          '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
          '<div style="margin-top:10px;display:flex;align-items:center;gap:12px">' +
            '<button class="btn btn-outline btn-sm" onclick="AdminHR.addBatchEditRow()"><span class="material-icons-round" style="font-size:14px">add</span>Agregar KPI</button>' +
            '<div id="be-weight-info" style="font-size:12px"></div>' +
          '</div>';
        APP.modal('✏️ Editar KPIs: ' + posName, body,
          '<button class="btn btn-outline" onclick="AdminHR.openKPIAdmin()">← Volver</button>' +
          '<button class="btn btn-primary" onclick="AdminHR.saveBatchEditKPIs()"><span class="material-icons-round">save</span>Guardar cambios</button>');
        var modalEl = document.querySelector('#app-modal .modal'); if (modalEl) modalEl.style.maxWidth = '960px';
        AdminHR.updateBatchEditWeightTotal();
      });
    });
  },

  addBatchEditRow: function() {
    var tbody = document.querySelector('#be-table tbody');
    if (!tbody) return;
    var s = 'style="padding:5px 6px;font-size:12px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);width:100%"';
    var tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border)';
    tr.innerHTML =
      '<td style="padding:4px 4px"><input class="be-name" placeholder="Nombre *" ' + s + ' oninput="AdminHR.updateBatchEditWeightTotal()"></td>' +
      '<td style="padding:4px 4px"><input class="be-desc" placeholder="Descripción" ' + s + '></td>' +
      '<td style="padding:4px 4px"><select class="be-period" ' + s + '>' +
        ['Mensual','Bimestral','Semestral','Anual'].map(function(v){ return '<option>' + v + '</option>'; }).join('') +
      '</select></td>' +
      '<td style="padding:4px 4px"><input type="number" class="be-weight" min="1" max="100" value="0" style="width:58px;padding:5px 4px;font-size:12px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)" oninput="AdminHR.updateBatchEditWeightTotal()"></td>' +
      '<td style="padding:4px 4px"><input class="be-target" placeholder="Meta" ' + s + '></td>' +
      '<td style="padding:4px 4px"><select class="be-measure" ' + s + '>' +
        [['Numérico','Numérico'],['Porcentual','Porcentual (%)'],['Monetario','Monetario ($)'],['Booleano','Sí / No']].map(function(v){ return '<option value="' + v[0] + '">' + v[1] + '</option>'; }).join('') +
      '</select></td>' +
      '<td style="padding:4px 2px;text-align:center"><button onclick="AdminHR.deleteBatchEditRow(this)" title="Eliminar" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:16px;line-height:1;padding:4px">×</button></td>';
    tbody.appendChild(tr);
    tr.querySelector('.be-name').focus();
    AdminHR.updateBatchEditWeightTotal();
  },

  deleteBatchEditRow: function(btn) {
    var tr = btn.closest('tr');
    if (!tr) return;
    var id = tr.getAttribute('data-id');
    if (id) AdminHR._beDeletedIds.push(id);
    tr.remove();
    AdminHR.updateBatchEditWeightTotal();
  },

  updateBatchEditWeightTotal: function() {
    var infoEl = document.getElementById('be-weight-info'); if (!infoEl) return;
    var total = 0; document.querySelectorAll('.be-weight').forEach(function(el) { total += parseFloat(el.value || 0) || 0; });
    var col = total === 100 ? 'var(--success)' : total > 100 ? 'var(--danger)' : 'var(--text-muted)';
    var msg = total === 100 ? '✅ Peso total: 100% — perfecto' : total > 100 ? '⚠️ Peso total: ' + total + '% — excede 100%' : 'Peso total: ' + total + '%';
    infoEl.innerHTML = '<span style="color:' + col + ';font-weight:' + (total >= 100 ? '600' : '400') + '">' + msg + '</span>';
  },

  saveBatchEditKPIs: function() {
    var toUpdate = [], toCreate = [];
    document.querySelectorAll('#be-table tbody tr').forEach(function(tr) {
      var id   = tr.getAttribute('data-id');
      var name = (tr.querySelector('.be-name') || {value: ''}).value.trim();
      if (!name) return;
      var rec = {
        name:        name,
        description: (tr.querySelector('.be-desc')    || {value: ''}).value.trim(),
        periodType:  (tr.querySelector('.be-period')  || {value: 'Mensual'}).value,
        weight:      (tr.querySelector('.be-weight')  || {value: '20'}).value,
        target:      (tr.querySelector('.be-target')  || {value: ''}).value.trim(),
        measureType: (tr.querySelector('.be-measure') || {value: 'Numérico'}).value
      };
      if (id) { rec.id = id; toUpdate.push(rec); }
      else    { rec.positionId = AdminHR._bePositionId; rec.isActive = true; toCreate.push(rec); }
    });
    var toDelete = AdminHR._beDeletedIds.slice();
    if (!toUpdate.length && !toCreate.length && !toDelete.length) { APP.toast('Sin cambios para guardar', 'warning'); return; }

    var saveBtn = document.querySelector('#app-modal .modal-footer .btn-primary');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando...'; }

    var saved = 0, failed = 0;
    var ops = [];
    toUpdate.forEach(function(r) { ops.push({ action: 'kpi.definitions.update', data: r }); });
    toCreate.forEach(function(r) { ops.push({ action: 'kpi.definitions.create', data: r }); });
    toDelete.forEach(function(id) { ops.push({ action: 'kpi.definitions.delete', data: { id: id } }); });

    function runNext(i) {
      if (i >= ops.length) {
        APP.toast((failed ? '⚠️ ' : '✅ ') + saved + ' op(s) correctas' + (failed ? ', ' + failed + ' error(es)' : ''), failed ? 'warning' : 'success');
        AdminHR.openKPIAdmin('defs');
        return;
      }
      APP.api(ops[i].action, ops[i].data, function(err) { if (err) failed++; else saved++; runNext(i + 1); });
    }
    runNext(0);
  },

  // ── SCHEDULES ──────────────────────────────────────────────
  _schedulesTable: function(schedules, kpis, positions) {
    var posNames={}; (positions||AdminHR._cachedPositions||[]).forEach(function(p){posNames[p.id]=p.name;});
    var freqIcon={Mensual:'🗓',Bimestral:'📆',Semestral:'📅',Anual:'📆'};
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
        '<button class="btn btn-primary btn-sm" onclick="AdminHR.runScheduleNow(\''+s.id+'\',\''+s.name+'\')"><span class="material-icons-round" style="font-size:14px">play_arrow</span></button> ' +
        '<button class="btn btn-outline btn-sm" onclick="AdminHR.deleteSchedule(\''+s.id+'\',\''+s.name.replace(/'/g,"\\'")+'\')" style="color:var(--danger);border-color:var(--danger)" title="Eliminar"><span class="material-icons-round" style="font-size:14px">delete</span></button></td></tr>';
    });
    return html+'</tbody></table></div>';
  },
  _calcNextDate: function(dayOfMonth, periodType, lastActivatedAt) {
    var today=new Date(); var day=Math.max(1,Math.min(28,parseInt(dayOfMonth)||1));
    var windowDays={Mensual:27,Bimestral:54,Semestral:170,Anual:335}; var skip=false;
    if (lastActivatedAt){var last=new Date(lastActivatedAt);var win=(windowDays[periodType]||27)*86400000;skip=!isNaN(last.getTime())&&(today.getTime()-last.getTime())<win;}
    var next=new Date(today.getFullYear(),today.getMonth(),day);
    if (skip||next<=today){var ma=periodType==='Anual'?12:periodType==='Semestral'?6:periodType==='Bimestral'?2:1;next.setMonth(next.getMonth()+ma);}
    return next.toISOString().split('T')[0];
  },
  deleteSchedule: function(id, name) {
    if (!confirm('¿Eliminar la programación "'+name+'"?\nEsta acción no se puede deshacer.')) return;
    APP.api('kpi.schedules.remove',{id:id},function(err){
      if(err){APP.toast(err,'error');return;}
      APP.toast('✅ Programación eliminada','success'); AdminHR.openKPIAdmin('schedules');
    });
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
      '<div class="form-group"><label>Frecuencia</label>'+sel('sf-freq',[{value:'Mensual',label:'Mensual'},{value:'Bimestral',label:'Bimestral'},{value:'Semestral',label:'Semestral'},{value:'Anual',label:'Anual'}],v.periodType||'Mensual')+'</div></div>' +
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
    if (!confirm('⚠️ ¿Eliminar el puesto "'+name+'"?\n\nLos empleados activos con este puesto quedarán SIN PUESTO y SIN KPIs asignados.\nLos KPIs asociados al puesto también serán desactivados.\nEsta acción no se puede deshacer.')) return;
    APP.api('positions.remove',{id:id},function(err,res){
      if(err){APP.toast(err,'error');return;}
      AdminHR._cachedPositions=null;
      var parts=[];
      if(res&&res.kpisRemoved)         parts.push(res.kpisRemoved+' KPI(s) eliminados');
      if(res&&res.employeesUnassigned) parts.push(res.employeesUnassigned+' empleado(s) desasignados');
      APP.toast('✅ Puesto eliminado'+(parts.length?' ('+parts.join(', ')+')':''),'success');
      AdminHR.openPositionsAdmin();
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
    var results = {};
    var pending = 2;
    function done() {
      if (--pending > 0) return;
      AdminHR._renderSystemConfig(results.emailEnabled, results.contabilidadEmail);
    }
    APP.api('email.getEnabled', {}, function(err, val) { results.emailEnabled = val; done(); });
    APP.api('config.get', { key: 'contabilidadEmail' }, function(err, val) { results.contabilidadEmail = val || ''; done(); });
  },

  _renderSystemConfig: function(emailEnabledVal, contabilidadEmail) {
    var val = emailEnabledVal;
    {
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
        '<div class="card mb-12" style="padding:16px">' +
          '<div style="font-weight:600;margin-bottom:4px">Correo de prueba general</div>' +
          '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Se enviará a <strong>' + emailAddr + '</strong></div>' +
          '<button class="btn btn-outline" id="cfg-test-btn" onclick="AdminHR.sendTestEmail()">' +
            '<span class="material-icons-round">send</span>Enviar correo de prueba' +
          '</button>' +
          '<div id="cfg-test-result" style="margin-top:8px;font-size:13px"></div>' +
        '</div>' +
        '<div class="card mb-12" style="padding:16px">' +
          '<div style="font-weight:600;margin-bottom:4px">Correo de contabilidad</div>' +
          '<div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">Destinatario del reporte quincenal de asistencia (CSV adjunto, se envía el día 14 y el penúltimo día de cada mes a las 12:00 PM)</div>' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
            '<input id="cfg-contabilidad-email" type="email" placeholder="contabilidad@empresa.com" value="' + (contabilidadEmail || '') + '" ' +
              'style="flex:1;min-width:200px;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px">' +
            '<button class="btn btn-primary btn-sm" onclick="AdminHR.saveContabilidadEmail()">Guardar</button>' +
          '</div>' +
          '<div id="cfg-contabilidad-result" style="margin-top:8px;font-size:13px"></div>' +
        '</div>' +
        '<div class="card" style="padding:16px">' +
          '<div style="font-weight:600;margin-bottom:4px">Probar escenarios de correo</div>' +
          '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Todos se envían a <strong>' + emailAddr + '</strong></div>' +
          '<div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Vacaciones</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">' +
            '<button class="btn btn-outline btn-sm" onclick="AdminHR.sendTestScenario(\'vacation_request_manager\',this)">Solicitud (como manager)</button>' +
            '<button class="btn btn-outline btn-sm" onclick="AdminHR.sendTestScenario(\'vacation_request_hr\',this)">Solicitud (como RRHH)</button>' +
            '<button class="btn btn-outline btn-sm" onclick="AdminHR.sendTestScenario(\'vacation_approved\',this)">Aprobada</button>' +
            '<button class="btn btn-outline btn-sm" onclick="AdminHR.sendTestScenario(\'vacation_rejected\',this)">Rechazada</button>' +
          '</div>' +
          '<div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">KPIs</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">' +
            '<button class="btn btn-outline btn-sm" onclick="AdminHR.sendTestScenario(\'kpi_self_submit\',this)">Autocalificación enviada</button>' +
            '<button class="btn btn-outline btn-sm" onclick="AdminHR.sendTestScenario(\'kpi_review_complete\',this)">Revisión completada</button>' +
            '<button class="btn btn-outline btn-sm" onclick="AdminHR.sendTestScenario(\'kpi_period_open\',this)">Período abierto</button>' +
          '</div>' +
          '<div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Cumpleaños</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">' +
            '<button class="btn btn-outline btn-sm" onclick="AdminHR.sendTestScenario(\'birthday_greeting\',this)">Felicitación (al cumpleañero)</button>' +
            '<button class="btn btn-outline btn-sm" onclick="AdminHR.sendTestScenario(\'birthday_notification\',this)">Aviso de cumpleaños (a todos)</button>' +
          '</div>' +
          '<div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Comunicados</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">' +
            '<button class="btn btn-outline btn-sm" onclick="AdminHR.sendTestScenario(\'announcement\',this)">Nuevo comunicado</button>' +
          '</div>' +
          '<div id="cfg-scenario-result" style="font-size:13px;margin-top:4px"></div>' +
        '</div>' +
        '</div>';
      APP.modal('Configuración del sistema', html,
        '<button class="btn btn-primary" onclick="APP.closeModal()">Cerrar</button>');
    }
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

  saveContabilidadEmail: function() {
    var input  = document.getElementById('cfg-contabilidad-email');
    var result = document.getElementById('cfg-contabilidad-result');
    if (!input) return;
    var email = input.value.trim();
    if (result) result.textContent = 'Guardando...';
    APP.api('config.set', { key: 'contabilidadEmail', value: email }, function(err) {
      var el = document.getElementById('cfg-contabilidad-result');
      if (err) {
        if (el) el.innerHTML = '<span style="color:var(--danger)">Error: ' + err + '</span>';
        return;
      }
      if (el) el.innerHTML = '<span style="color:var(--success)">✅ Guardado</span>';
      APP.toast('Correo de contabilidad actualizado', 'success');
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
      var msgId = data && data.messageId ? ' <span style="color:var(--text-muted);font-size:11px">(id: ' + data.messageId + ')</span>' : '';
      if (el) el.innerHTML = '<span style="color:var(--success)">✅ Enviado a ' + ((data && data.sentTo) || APP.user.email) + '</span>' + msgId;
    });
  },

  sendTestScenario: function(scenario, btn) {
    var result = document.getElementById('cfg-scenario-result');
    if (btn) btn.disabled = true;
    if (result) result.textContent = 'Enviando...';
    APP.api('email.testScenario', { scenario: scenario }, function(err, data) {
      if (btn) btn.disabled = false;
      var el = document.getElementById('cfg-scenario-result');
      if (err) {
        if (el) el.innerHTML = '<span style="color:var(--danger)">Error: ' + err + '</span>';
        return;
      }
      if (el) el.innerHTML = '<span style="color:var(--success)">✅ Enviado a ' + ((data && data.sentTo) || APP.user.email) + '</span>';
    });
  },

  deleteKPI: function(id, name) {
    if (!confirm('¿Eliminar el KPI "' + name + '"? Esta acción no se puede deshacer.')) return;
    APP.api('kpi.definitions.delete', { id: id }, function(err) {
      if (err) { APP.toast(err, 'error'); return; }
      APP.toast('✅ KPI eliminado', 'success');
      AdminHR.openKPIAdmin('defs');
    });
  }
};

// ── DEBUG VIEW (admin impersonation) ─────────────────────────
var DebugView = {
  _realUser: null,

  open: function() {
    if (!APP.user || !APP.user.isAdmin) { APP.toast('Solo admin puede usar Debug', 'error'); return; }
    APP.api('employees.list', {}, function(err, emps) {
      if (err) { APP.toast(err, 'error'); return; }
      emps = (emps || []).filter(function(e) { return e.status === 'activo'; });
      var rows = emps.map(function(e) {
        var safeName = (e.firstName + ' ' + e.lastName).replace(/'/g, "\\'");
        return '<div class="debug-row" data-name="' + safeName.toLowerCase() + '" style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">' +
          '<div>' +
            '<div style="font-weight:500">' + e.firstName + ' ' + e.lastName + '</div>' +
            '<div style="font-size:12px;color:var(--text-muted)">' + (e.department || '') + (e.roleName ? ' · ' + e.roleName : '') + '</div>' +
          '</div>' +
          '<button class="btn btn-outline btn-sm" onclick="DebugView.activate(\'' + e.id + '\')">Ver como este usuario</button>' +
        '</div>';
      }).join('');
      var html =
        '<div style="padding:8px 12px;background:#fef3c7;border-radius:6px;font-size:13px;margin-bottom:12px;color:#92400e">' +
          '⚠️ Selecciona un empleado para ver la plataforma desde su perspectiva.' +
        '</div>' +
        '<input type="text" placeholder="Buscar empleado..." oninput="DebugView._filter(this.value)" style="width:100%;margin-bottom:10px">' +
        '<div style="max-height:380px;overflow-y:auto" id="debug-emp-list">' + rows + '</div>';
      APP.modal('🔍 Debug — Ver como usuario', html,
        '<button class="btn btn-primary" onclick="APP.closeModal()">Cancelar</button>');
    });
  },

  _filter: function(q) {
    q = (q || '').toLowerCase();
    document.querySelectorAll('.debug-row').forEach(function(row) {
      row.style.display = !q || (row.dataset.name || '').indexOf(q) > -1 ? '' : 'none';
    });
  },

  activate: function(empId) {
    APP.api('admin.viewAsUser', { employeeId: empId }, function(err, viewUser) {
      if (err) { APP.toast(err, 'error'); return; }
      APP.closeModal();
      DebugView._realUser = Object.assign({}, APP.user);
      APP.impersonateId = empId;
      APP.user = viewUser;
      ClientCache.flush();
      APP.data = null;
      APP.renderSidebar();
      DebugView._showBanner(viewUser.fullName || viewUser.email);
      APP.navigate('dashboard');
    });
  },

  deactivate: function() {
    if (!DebugView._realUser) return;
    APP.user = DebugView._realUser;
    APP.impersonateId = null;
    DebugView._realUser = null;
    ClientCache.flush();
    APP.data = null;
    var banner = document.getElementById('debug-banner');
    if (banner) banner.remove();
    APP.renderSidebar();
    APP.navigate('dashboard');
  },

  _showBanner: function(name) {
    var old = document.getElementById('debug-banner');
    if (old) old.remove();
    var content = document.getElementById('content');
    if (!content) return;
    var banner = document.createElement('div');
    banner.id = 'debug-banner';
    banner.style.cssText = 'background:#dc2626;color:#fff;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:500;border-radius:8px;margin-bottom:16px';
    banner.innerHTML = '🔍 Modo debug — Viendo como: <strong style="margin:0 6px">' + name + '</strong>' +
      '<button onclick="DebugView.deactivate()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;padding:3px 12px;border-radius:4px;cursor:pointer;font-size:12px;margin-left:auto">Salir del modo debug</button>';
    content.prepend(banner);
  }
};

// ── POLICIES VIEW ─────────────────────────────────────────────
var PoliciesView = {
  _policies: [],
  _depts: [],
  _filterDept: 'Todas',

  load: function() {
    var el = document.getElementById('policies-content');
    if (!el) return;
    el.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    APP.api('policies.list', {}, function(err, policies) {
      if (err) { el.innerHTML = '<div class="empty-state">Error al cargar políticas</div>'; return; }
      PoliciesView._policies = policies || [];
      // Collect unique departments for filter
      var depts = [];
      (policies || []).forEach(function(p) { if (p.department && depts.indexOf(p.department) === -1) depts.push(p.department); });
      depts.sort(function(a,b){ return a === 'General' ? -1 : b === 'General' ? 1 : a.localeCompare(b); });
      PoliciesView._depts = depts;
      PoliciesView._render();
    });
  },

  _render: function() {
    var el = document.getElementById('policies-content');
    if (!el) return;
    var u        = APP.user;
    var canEdit  = u && (u.isAdmin || u.isHR);
    var filter   = PoliciesView._filterDept;
    var policies = PoliciesView._policies.filter(function(p) {
      return filter === 'Todas' || p.department === filter;
    });
    var depts  = ['Todas'].concat(PoliciesView._depts);
    var tabs   = depts.map(function(d) {
      return '<button onclick="PoliciesView._setFilter(\'' + d.replace(/'/g,"\\'") + '\')" ' +
        'style="padding:6px 14px;border-radius:20px;border:none;cursor:pointer;font-size:12px;font-weight:600;transition:background .15s;' +
        (filter === d ? 'background:var(--primary);color:#fff' : 'background:var(--bg-secondary);color:var(--text-muted)') + '">' + d + '</button>';
    }).join('');

    var cards = policies.length === 0
      ? '<div class="empty-state" style="grid-column:1/-1">No hay políticas en esta categoría.</div>'
      : policies.map(function(p) { return PoliciesView._card(p, canEdit); }).join('');

    el.innerHTML =
      '<div class="view-title"><span class="material-icons-round">policy</span>Políticas</div>' +
      '<div class="card mb-20" style="padding:16px 20px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' + tabs + '</div>' +
          (canEdit ? '<button class="btn btn-primary btn-sm" onclick="PoliciesView.openForm(null)">' +
            '<span class="material-icons-round" style="font-size:16px">add</span>Agregar política</button>' : '') +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:20px">' +
        cards +
      '</div>';
  },

  _card: function(p, canEdit) {
    var deptColor = { 'General': '#6366f1' };
    var color = deptColor[p.department] || '#0ea5e9';
    return '<div class="card" style="display:flex;flex-direction:column;gap:0;padding:20px">' +
      '<div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:14px;flex:1">' +
        '<div style="width:48px;height:48px;flex-shrink:0;background:#fee2e2;border-radius:10px;display:flex;align-items:center;justify-content:center">' +
          '<span class="material-icons-round" style="color:#ef4444;font-size:26px">picture_as_pdf</span>' +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:700;font-size:15px;line-height:1.4;margin-bottom:8px">' + (p.name||'Sin nombre') + '</div>' +
          (p.description ? '<div style="font-size:13px;color:var(--text-muted);line-height:1.6">' + p.description + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;padding-top:14px;border-top:1px solid var(--border)">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:11px;font-weight:700;color:' + color + ';background:' + color + '18;border-radius:4px;padding:3px 10px">' + (p.department||'General') + '</span>' +
          (p.fileName ? '<span style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0">' + p.fileName + '</span>' : '') +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn btn-primary btn-sm" style="flex:1;justify-content:center" onclick="PoliciesView.viewPDF(\'' + p.id + '\')">' +
            '<span class="material-icons-round" style="font-size:15px">visibility</span>Ver</button>' +
          '<a href="' + (p.fileUrl||'#') + '" download="' + (p.fileName||'politica.pdf') + '" class="btn btn-outline btn-sm">' +
            '<span class="material-icons-round" style="font-size:15px">download</span></a>' +
          (canEdit
            ? '<button class="btn btn-outline btn-sm" onclick="PoliciesView.openForm(\'' + p.id + '\')">' +
                '<span class="material-icons-round" style="font-size:15px">edit</span></button>' +
              '<button class="btn btn-outline btn-sm" style="color:var(--danger)" onclick="PoliciesView.deletePolicy(\'' + p.id + '\')">' +
                '<span class="material-icons-round" style="font-size:15px">delete</span></button>'
            : '') +
        '</div>' +
      '</div>' +
    '</div>';
  },

  _setFilter: function(dept) {
    PoliciesView._filterDept = dept;
    PoliciesView._render();
  },

  viewPDF: function(id) {
    var p = PoliciesView._policies.filter(function(x){ return x.id === id; })[0];
    if (!p) return;
    var url = p.fileUrl;
    var overlay = document.createElement('div');
    overlay.id = 'pdf-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.7);display:flex;flex-direction:column';
    overlay.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:var(--card);flex-shrink:0">' +
        '<span style="font-weight:700;font-size:15px">' + p.name + '</span>' +
        '<div style="display:flex;gap:8px">' +
          '<a href="' + url + '" download="' + (p.fileName||'politica.pdf') + '" class="btn btn-outline btn-sm">' +
            '<span class="material-icons-round" style="font-size:16px">download</span> Descargar</a>' +
          '<button class="btn btn-outline btn-sm" onclick="document.getElementById(\'pdf-overlay\').remove()">' +
            '<span class="material-icons-round" style="font-size:16px">close</span></button>' +
        '</div>' +
      '</div>' +
      '<iframe src="' + url + '" style="flex:1;border:none;background:#525659"></iframe>';
    document.body.appendChild(overlay);
  },

  openForm: function(id) {
    var p = id ? PoliciesView._policies.filter(function(x){ return x.id === id; })[0] : null;
    // Build department options from unique departments in employees + General
    APP.api('employees.list', {}, function(err, emps) {
      var depts = ['General'];
      (emps||[]).forEach(function(e){ if (e.department && depts.indexOf(e.department) === -1) depts.push(e.department); });
      depts.sort(function(a,b){ return a === 'General' ? -1 : b === 'General' ? 1 : a.localeCompare(b); });

      var deptSel = depts.map(function(d){
        return '<option value="' + d + '"' + ((p && p.department === d) ? ' selected' : ((!p && d === 'General') ? ' selected' : '')) + '>' + d + '</option>';
      }).join('');

      var html =
        '<div class="modal-overlay" id="policy-modal" onclick="if(event.target===this)this.remove()">' +
          '<div class="modal" style="max-width:480px">' +
            '<div class="modal-header"><h3>' + (p ? 'Editar política' : 'Nueva política') + '</h3>' +
              '<button class="modal-close" onclick="document.getElementById(\'policy-modal\').remove()">×</button></div>' +
            '<div class="modal-body" style="display:flex;flex-direction:column;gap:14px">' +
              '<div class="form-group"><label>Nombre *</label>' +
                '<input id="pol-name" class="form-control" value="' + (p ? p.name||'' : '') + '" placeholder="Nombre de la política"></div>' +
              '<div class="form-group"><label>Descripción</label>' +
                '<textarea id="pol-desc" class="form-control" rows="2" placeholder="Descripción breve (opcional)">' + (p ? p.description||'' : '') + '</textarea></div>' +
              '<div class="form-group"><label>Departamento</label>' +
                '<select id="pol-dept" class="form-control">' + deptSel + '</select></div>' +
              (!p ? '<div class="form-group"><label>Archivo PDF *</label>' +
                '<input id="pol-file" type="file" accept=".pdf,application/pdf" class="form-control"></div>' : '') +
            '</div>' +
            '<div class="modal-footer">' +
              '<button class="btn btn-outline" onclick="document.getElementById(\'policy-modal\').remove()">Cancelar</button>' +
              '<button class="btn btn-primary" id="pol-save-btn" onclick="PoliciesView.saveForm(\'' + (id||'') + '\')">' +
                (p ? 'Guardar cambios' : 'Subir política') + '</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      document.body.insertAdjacentHTML('beforeend', html);
    });
  },

  saveForm: function(id) {
    var name  = (document.getElementById('pol-name')||{value:''}).value.trim();
    var desc  = (document.getElementById('pol-desc')||{value:''}).value.trim();
    var dept  = (document.getElementById('pol-dept')||{value:'General'}).value;
    var fileEl = document.getElementById('pol-file');
    var btn   = document.getElementById('pol-save-btn');

    if (!name) { APP.toast('El nombre es requerido', 'error'); return; }
    if (!id && (!fileEl || !fileEl.files || !fileEl.files[0])) { APP.toast('Selecciona un archivo PDF', 'error'); return; }

    if (btn) { btn.disabled = true; btn.textContent = 'Subiendo...'; }

    if (id) {
      // Update metadata only
      APP.api('policies.update', { id: id, name: name, description: desc, department: dept }, function(err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios'; }
        if (err) { APP.toast(err, 'error'); return; }
        var modal = document.getElementById('policy-modal');
        if (modal) modal.remove();
        APP.toast('Política actualizada', 'success');
        PoliciesView.load();
      });
    } else {
      // Upload file to Supabase Storage then save metadata
      var file = fileEl.files[0];
      var path = 'policies/' + Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
      window._sb.storage.from('policies').upload(path, file, { upsert: false })
        .then(function(res) {
          if (res.error) throw res.error;
          var pub = window._sb.storage.from('policies').getPublicUrl(path);
          var fileUrl = pub.data.publicUrl;
          return APP.apiPromise('policies.create', { name: name, description: desc, department: dept, fileUrl: fileUrl, fileName: file.name, fileSize: file.size });
        })
        .then(function() {
          if (btn) { btn.disabled = false; }
          var modal = document.getElementById('policy-modal');
          if (modal) modal.remove();
          APP.toast('Política subida correctamente', 'success');
          PoliciesView.load();
        })
        .catch(function(e) {
          if (btn) { btn.disabled = false; btn.textContent = 'Subir política'; }
          APP.toast((e && e.message) || 'Error al subir el archivo', 'error');
        });
    }
  },

  deletePolicy: function(id) {
    var p = PoliciesView._policies.filter(function(x){ return x.id === id; })[0];
    if (!p) return;
    if (!confirm('¿Eliminar la política "' + p.name + '"? Esta acción no se puede deshacer.')) return;
    APP.api('policies.delete', { id: id }, function(err) {
      if (err) { APP.toast(err, 'error'); return; }
      APP.toast('Política eliminada', 'success');
      PoliciesView.load();
    });
  }
};

// ── ANNOUNCEMENTS VIEW ────────────────────────────────────────
var AnnouncementsView = {
  load: function() {
    var el = document.getElementById('ann-content'); if (!el) return;
    el.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    APP.api('announcements.list', {}, function(err, items) {
      if (err) { el.innerHTML = '<div class="empty-state"><span class="material-icons-round">error_outline</span><p>No se pudo cargar</p></div>'; return; }
      if (!items || items.length === 0) {
        el.innerHTML = '<div class="empty-state"><span class="material-icons-round">campaign</span><p>No hay comunicados activos</p></div>';
        return;
      }
      el.innerHTML = items.map(function(a) {
        window['_ann_' + a.id] = a;
        return '<div class="card" style="margin-bottom:12px;cursor:pointer" onclick="AnnouncementsView.openModal(window[\'_ann_\' + \'' + a.id + '\'])">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">' +
            '<div>' +
              (a.pinned ? '<span style="color:var(--warning);margin-right:4px">📌</span>' : '') +
              '<span class="font-600" style="color:var(--primary)">' + a.title + '</span>' +
            '</div>' +
            '<span class="text-xs text-muted" style="flex-shrink:0">' + APP.fmtDate((a.publishedAt || '').split('T')[0]) + '</span>' +
          '</div>' +
          '<p class="text-sm text-muted mt-8">' + (a.body || '').substring(0, 160) + (a.body && a.body.length > 160 ? '…' : '') + '</p>' +
          '<p class="text-xs text-muted mt-4">' + (a.authorName || 'HR') + ' · <span style="color:var(--primary)">Leer más →</span></p>' +
        '</div>';
      }).join('');
    });
  },

  openModal: function(a) {
    if (!a) return;
    var bodyHtml = (a.body || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    var date = APP.fmtDate((a.publishedAt || '').split('T')[0]);
    APP.modal(
      (a.pinned ? '📌 ' : '📢 ') + a.title,
      '<p class="text-xs text-muted" style="margin-bottom:16px">' + date + ' · ' + (a.authorName || 'HR') + '</p>' +
      '<div style="color:var(--text-secondary);font-size:15px;line-height:1.75;border-top:1px solid var(--border);padding-top:16px">' + bodyHtml + '</div>',
      '<button class="btn btn-primary" onclick="APP.closeModal()">Cerrar</button>'
    );
  }
};

// ── ATTENDANCE VIEW ───────────────────────────────────────────
var AttendanceView = {
  _timer: null,
  _empView: 'calendar',
  _rState: null,

  load: function() {
    var el = document.getElementById('att-content'); if (!el) return;
    if (AttendanceView._timer) { clearInterval(AttendanceView._timer); AttendanceView._timer = null; }
    el.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    var today = AttendanceView._todayCdmx();
    if (APP.user && (APP.user.isAdmin || APP.user.isHR)) {
      AttendanceView._loadAdmin(today);
    } else {
      AttendanceView._loadEmployee();
    }
    // Check for pending remote/justified approvals and tardiness appeals
    AttendanceView._checkManagerPending();
    AttendanceView._checkManagerAppeals();
  },

  _loadAdmin: function(date) {
    var el = document.getElementById('att-content'); if (!el) return;
    el.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    APP.api('attendance.getDay', { date: date }, function(err, rows) {
      if (err) { el.innerHTML = '<div class="empty-state"><span class="material-icons-round">error_outline</span><p>' + err + '</p></div>'; return; }
      el.innerHTML = AttendanceView._renderAdmin(rows || [], date);
      AttendanceView._scheduleRefresh(date);
    });
  },

  _renderAdmin: function(rows, date) {
    var today = AttendanceView._todayCdmx();
    var isToday = date === today;

    var withPin = rows.filter(function(r) { return !!r.checadorPin; });
    var present = withPin.filter(function(r) { return r.status === 'a_tiempo' || r.status === 'retardo'; }).length;
    var aTime   = withPin.filter(function(r) { return r.status === 'a_tiempo'; }).length;
    var retardo = withPin.filter(function(r) { return r.status === 'retardo'; }).length;
    var absent  = withPin.filter(function(r) { return r.status === 'ausente'; }).length;
    var pend    = withPin.filter(function(r) { return r.status === 'pendiente'; }).length;
    var sinPin  = rows.filter(function(r) { return !r.checadorPin && !r.isRemote; }).length;

    var html = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px">';
    html += '<input type="date" value="' + date + '" max="' + today + '" ';
    html += 'onchange="AttendanceView._loadAdmin(this.value)" ';
    html += 'style="padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px">';
    if (!isToday) {
      html += '<button onclick="AttendanceView._loadAdmin(\'' + today + '\')" ';
      html += 'style="padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;font-size:13px">Hoy</button>';
    }
    if (isToday) html += '<span style="font-size:12px;color:var(--muted)">Actualiza cada 60s</span>';
    html += '<div style="flex:1"></div>';
    html += '<button onclick="AttendanceView._loadEmployee()" ';
    html += 'style="padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;font-size:13px">Mi asistencia →</button>';
    html += '<button onclick="AttendanceView._loadDashboard()" ';
    html += 'style="padding:6px 14px;border-radius:6px;border:1px solid var(--primary);background:var(--primary);color:#fff;cursor:pointer;font-size:13px;font-weight:500">Dashboard →</button>';
    html += '<button onclick="AttendanceView._loadTardinessReport()" ';
    html += 'style="padding:6px 14px;border-radius:6px;border:1px solid #dc2626;background:#dc2626;color:#fff;cursor:pointer;font-size:13px;font-weight:500">Retardos →</button>';
    html += '</div>';

    html += '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">';
    html += AttendanceView._pill(present + ' presentes', '#16a34a');
    html += AttendanceView._pill(aTime + ' a tiempo', '#3b82f6');
    html += AttendanceView._pill(retardo + ' retardo' + (retardo !== 1 ? 's' : ''), '#f59e0b');
    html += AttendanceView._pill(absent + ' ausente' + (absent !== 1 ? 's' : ''), '#ef4444');
    if (isToday && pend > 0) html += AttendanceView._pill(pend + ' pendiente' + (pend !== 1 ? 's' : ''), '#94a3b8');
    if (sinPin > 0) html += AttendanceView._pill(sinPin + ' sin huella', '#94a3b8');
    html += '</div>';

    // Sort: a_tiempo → retardo → pendiente → ausente → remoto → sin huella
    var order = { a_tiempo: 0, retardo: 1, pendiente: 2, ausente: 3 };
    rows = rows.slice().sort(function(a, b) {
      var oa = !a.checadorPin ? (a.isRemote ? 4 : 5) : (order[a.status] !== undefined ? order[a.status] : 3);
      var ob = !b.checadorPin ? (b.isRemote ? 4 : 5) : (order[b.status] !== undefined ? order[b.status] : 3);
      if (oa !== ob) return oa - ob;
      return ((a.firstName || '') + (a.lastName || '')).localeCompare((b.firstName || '') + (b.lastName || ''));
    });

    html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">';
    html += '<thead><tr style="border-bottom:2px solid var(--border);text-align:left">';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted)">Empleado</th>';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted)">Depto.</th>';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted)">Entrada</th>';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted)">Salida</th>';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted)">Estado</th>';
    html += '</tr></thead><tbody>';

    var canOverride = APP.user && (APP.user.isAdmin || APP.user.isHR);
    rows.forEach(function(r) {
      var name = (r.firstName || '') + ' ' + (r.lastName || '');
      var ci = r.checkIn  ? AttendanceView._fmtTime(r.checkIn)  + (r.status === 'remoto' || r.source === 'remoto' ? ' 🏠' : '') : '—';
      var co = r.checkOut ? AttendanceView._fmtTime(r.checkOut) : '—';
      html += '<tr style="border-bottom:1px solid var(--border)">';
      html += '<td style="padding:8px 10px">' + name + '</td>';
      html += '<td style="padding:8px 10px;color:var(--muted)">' + (r.department || '—') + '</td>';
      html += '<td style="padding:8px 10px;font-variant-numeric:tabular-nums">' + ci + '</td>';
      html += '<td style="padding:8px 10px;font-variant-numeric:tabular-nums">' + co + '</td>';
      var badge = (r.checadorPin || r.isRemote)
        ? AttendanceView._badge(r.status)
        : '<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:#f1f5f9;color:#94a3b8;border:1px solid #e2e8f0">Sin huella</span>';
      var overrideBtn = (canOverride && r.status === 'ausente')
        ? '<button onclick="AttendanceView._openOverrideModal(' +
            '\'' + r.employeeId + '\',\'' + date + '\',\'' + (r.rcId || '') + '\',' +
            '\'' + name.replace(/'/g, '') + '\'' +
          ')" style="margin-left:6px;padding:2px 7px;border-radius:4px;border:1px solid #94a3b8;background:none;cursor:pointer;font-size:11px;color:#64748b;vertical-align:middle">⚙ Corregir</button>'
        : '';
      html += '<td style="padding:8px 10px">' + badge + overrideBtn + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  },

  _loadEmployee: function() {
    var cm = AttendanceView._currentMonthCdmx();
    AttendanceView._loadEmployeeMonth(cm.year, cm.month);
  },

  _currentMonthCdmx: function() {
    var d = new Date(new Date().getTime() - 6 * 3600 * 1000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  },

  _loadEmployeeMonth: function(year, month) {
    var el = document.getElementById('att-content'); if (!el) return;
    el.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    var cm = AttendanceView._currentMonthCdmx();
    var isCurrentMonth = (year === cm.year && month === cm.month);
    var reqs = [
      new Promise(function(res) { APP.api('attendance.getMonth', { year: year, month: month, personal: true }, function(e, d) { res(e ? null : d); }); })
    ];
    if (isCurrentMonth) {
      var today = AttendanceView._todayCdmx();
      reqs.push(new Promise(function(res) { APP.api('attendance.getDay', { date: today }, function(e, d) { res(e ? [] : (d || [])); }); }));
    }
    Promise.all(reqs).then(function(results) {
      var monthData = results[0];
      var todayRec  = isCurrentMonth ? (results[1] || [])[0] || null : null;
      if (!monthData) { el.innerHTML = '<div class="empty-state"><p>Error cargando datos</p></div>'; return; }
      AttendanceView._empMonthData = monthData;
      AttendanceView._empTodayRec  = todayRec;
      el.innerHTML = AttendanceView._renderEmployee(monthData, todayRec);
      AttendanceView._loadTardinessBanner();
    });
  },

  _renderEmployee: function(monthData, todayRec) {
    var MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    var year  = monthData.year;
    var month = monthData.month;
    var cm    = AttendanceView._currentMonthCdmx();
    var isCurrentMonth = (year === cm.year && month === cm.month);

    var prevYear  = month === 1 ? year - 1 : year;
    var prevMonth = month === 1 ? 12 : month - 1;
    var nextYear  = month === 12 ? year + 1 : year;
    var nextMonth = month === 12 ? 1 : month + 1;

    var html = '';

    // Detail card — shows today on load, updates when a calendar day is clicked
    var todayStr = AttendanceView._todayCdmx();
    AttendanceView._selectedDate = isCurrentMonth ? todayStr : null;
    html += AttendanceView._dayCard(isCurrentMonth ? 'Hoy' : null, isCurrentMonth ? (todayRec || null) : null);

    // Month navigation + view toggle
    var isCal  = AttendanceView._empView === 'calendar';
    var btnBase = 'padding:5px 8px;border:none;cursor:pointer;font-size:13px;display:flex;align-items:center';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">';
    if (APP.user && (APP.user.isAdmin || APP.user.isHR)) {
      html += '<button onclick="AttendanceView._loadAdmin(AttendanceView._todayCdmx())" ';
      html += 'style="padding:5px 12px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;font-size:13px">← Empresa</button>';
    }
    html += '<div style="display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:8px;overflow:hidden">';
    html += '<button onclick="AttendanceView._loadEmployeeMonth(' + prevYear + ',' + prevMonth + ')" ';
    html += 'style="padding:6px 14px;border:none;border-right:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;font-size:14px">‹</button>';
    html += '<span style="padding:6px 18px;font-weight:600;font-size:14px;background:var(--surface)">' + MONTHS_ES[month - 1] + ' ' + year + '</span>';
    html += '<button onclick="AttendanceView._loadEmployeeMonth(' + nextYear + ',' + nextMonth + ')" ';
    html += 'style="padding:6px 14px;border:none;border-left:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;font-size:14px">›</button>';
    html += '</div>';
    html += '<div style="flex:1"></div>';
    html += '<div style="display:inline-flex;border:1px solid var(--border);border-radius:8px;overflow:hidden">';
    html += '<button id="att-v-cal" onclick="AttendanceView._switchEmpView(\'calendar\')" title="Vista calendario" ';
    html += 'style="' + btnBase + ';border-right:1px solid var(--border);background:' + (isCal ? 'var(--primary)' : 'var(--surface)') + ';color:' + (isCal ? '#fff' : 'var(--muted)') + '">';
    html += '<span class="material-icons-round" style="font-size:16px">calendar_month</span></button>';
    html += '<button id="att-v-list" onclick="AttendanceView._switchEmpView(\'list\')" title="Vista lista" ';
    html += 'style="' + btnBase + ';background:' + (!isCal ? 'var(--primary)' : 'var(--surface)') + ';color:' + (!isCal ? '#fff' : 'var(--muted)') + '">';
    html += '<span class="material-icons-round" style="font-size:16px">view_list</span></button>';
    html += '</div></div>';

    // Summary pills
    var s = monthData.summary;
    html += '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">';
    html += AttendanceView._pill(s.workdays + ' laborable' + (s.workdays !== 1 ? 's' : ''), '#475569');
    html += AttendanceView._pill(s.aTime + ' a tiempo', '#3b82f6');
    if (s.retardo > 0)    html += AttendanceView._pill(s.retardo + ' retardo' + (s.retardo !== 1 ? 's' : ''), '#f59e0b');
    if (s.ausente > 0)    html += AttendanceView._pill(s.ausente + ' ausente' + (s.ausente !== 1 ? 's' : ''), '#ef4444');
    if (s.vacaciones > 0) html += AttendanceView._pill(s.vacaciones + ' día' + (s.vacaciones !== 1 ? 's' : '') + ' vacaciones', '#0ea5e9');
    html += '</div>';

    html += '<div id="att-tardiness-banner" style="margin-bottom:14px"></div>';

    html += '<div id="att-emp-body">';
    html += isCal
      ? AttendanceView._renderEmployeeCalendar(monthData)
      : AttendanceView._renderEmployeeList(monthData);
    html += '</div>';
    return html;
  },

  _dayCard: function(dateLabel, rec) {
    var ST = {
      a_tiempo:              { bg: '#ecfdf5', color: '#16a34a', text: 'A tiempo' },
      retardo:               { bg: '#fffbeb', color: '#d97706', text: 'Retardo' },
      retardo_apelado:       { bg: '#fefce8', color: '#16a34a', text: 'Retardo apelado ✓' },
      ausente:               { bg: '#fef2f2', color: '#dc2626', text: 'Ausente' },
      vacaciones:            { bg: '#e0f2fe', color: '#0284c7', text: 'Vacaciones' },
      remoto:                { bg: '#eff6ff', color: '#2563eb', text: 'Remoto ✓' },
      justificada:           { bg: '#f5f3ff', color: '#7c3aed', text: 'Justificada ✓' },
      pendiente_remoto:      { bg: '#fff7ed', color: '#ea580c', text: 'Pendiente (remoto)' },
      pendiente_justificada: { bg: '#fdf4ff', color: '#c026d3', text: 'Pendiente (just.)' },
      pendiente:             { bg: '#f8fafc', color: '#64748b', text: 'Sin registro aún' }
    };
    if (!dateLabel) {
      return '<div id="att-day-card" class="card" style="margin-bottom:16px;min-height:76px;display:flex;align-items:center;justify-content:center">' +
        '<span style="color:var(--muted);font-size:13px">Selecciona un día en el calendario</span></div>';
    }
    var s  = rec ? (ST[rec.status] || ST.ausente) : ST.pendiente;
    var ci = rec && rec.checkIn  ? AttendanceView._fmtTime(rec.checkIn)  : '—';
    var co = rec && rec.checkOut ? AttendanceView._fmtTime(rec.checkOut) : '—';

    var curStatus  = rec ? rec.status : 'pendiente';
    var showBtns   = dateLabel === 'Hoy' && (curStatus === 'ausente' || curStatus === 'pendiente');
    var appealStatus = rec && rec.appeal ? rec.appeal.status : null;
    var canAppeal  = curStatus === 'retardo' && appealStatus !== 'pendiente' && appealStatus !== 'aprobado';
    var appealDate = (dateLabel === 'Hoy') ? AttendanceView._todayCdmx() : (rec && rec.date ? rec.date : '');

    var html = '<div id="att-day-card" class="card" style="margin-bottom:16px;background:' + s.bg + ';border-color:' + s.color + '33">';
    html += '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:' + s.color + ';margin-bottom:4px">' + dateLabel + '</div>';
    html += '<div style="font-size:26px;font-weight:700;color:' + s.color + ';margin-bottom:12px">' + s.text + '</div>';
    html += '<div style="display:flex;gap:28px">';
    html += '<div><div style="font-size:11px;color:var(--muted);margin-bottom:2px">Entrada</div><div style="font-size:16px;font-weight:600;font-variant-numeric:tabular-nums">' + ci + '</div></div>';
    html += '<div><div style="font-size:11px;color:var(--muted);margin-bottom:2px">Salida</div><div style="font-size:16px;font-weight:600;font-variant-numeric:tabular-nums">' + co + '</div></div>';
    html += '</div>';
    if (showBtns) {
      html += '<div style="display:flex;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid ' + s.color + '33">';
      html += '<button onclick="AttendanceView._openRemoteModal()" style="flex:1;padding:8px 6px;border-radius:8px;border:none;background:#2563eb;color:#fff;cursor:pointer;font-size:12px;font-weight:600">🏠 Check-in remoto</button>';
      html += '<button onclick="AttendanceView._openJustifiedModal()" style="flex:1;padding:8px 6px;border-radius:8px;border:none;background:#7c3aed;color:#fff;cursor:pointer;font-size:12px;font-weight:600">📋 Falta justificada</button>';
      html += '</div>';
    }
    if (canAppeal && appealDate) {
      html += '<div style="margin-top:10px;padding-top:10px;border-top:1px solid ' + s.color + '33">';
      html += '<button onclick="AttendanceView._openAppealModal(\'' + appealDate + '\')" style="width:100%;padding:8px 6px;border-radius:8px;border:none;background:#d97706;color:#fff;cursor:pointer;font-size:12px;font-weight:600">⚠ Apelar tardanza</button>';
      html += '</div>';
    }
    if (appealStatus === 'pendiente') {
      html += '<div style="margin-top:8px;font-size:11px;color:#d97706;text-align:center">⏳ Apelación pendiente de revisión</div>';
    }
    html += '</div>';
    return html;
  },

  _selectDay: function(dateStr) {
    // Swap selection ring
    var old = AttendanceView._selectedDate;
    if (old) {
      var oldCell = document.getElementById('att-cd-' + old.replace(/-/g, ''));
      if (oldCell) oldCell.style.outline = '';
    }
    AttendanceView._selectedDate = dateStr;
    var newCell = document.getElementById('att-cd-' + dateStr.replace(/-/g, ''));
    if (newCell) newCell.style.outline = '2px solid var(--primary)';

    // Update card
    var card = document.getElementById('att-day-card');
    if (!card || !AttendanceView._empMonthData) return;
    var rec = null;
    AttendanceView._empMonthData.days.forEach(function(d) { if (d.date === dateStr) rec = d; });
    var label = dateStr === AttendanceView._todayCdmx() ? 'Hoy' : AttendanceView._fmtDate(dateStr);
    var tmp = document.createElement('div');
    tmp.innerHTML = AttendanceView._dayCard(label, rec);
    card.replaceWith(tmp.firstChild);
  },

  _switchEmpView: function(view) {
    AttendanceView._empView = view;
    var body = document.getElementById('att-emp-body');
    if (body && AttendanceView._empMonthData) {
      body.innerHTML = view === 'calendar'
        ? AttendanceView._renderEmployeeCalendar(AttendanceView._empMonthData)
        : AttendanceView._renderEmployeeList(AttendanceView._empMonthData);
    }
    var calBtn  = document.getElementById('att-v-cal');
    var listBtn = document.getElementById('att-v-list');
    if (calBtn)  { calBtn.style.background  = view === 'calendar' ? 'var(--primary)' : 'var(--surface)'; calBtn.style.color  = view === 'calendar' ? '#fff' : 'var(--muted)'; }
    if (listBtn) { listBtn.style.background = view === 'list'     ? 'var(--primary)' : 'var(--surface)'; listBtn.style.color = view === 'list'     ? '#fff' : 'var(--muted)'; }
  },

  _renderEmployeeList: function(monthData) {
    if (!monthData.days || monthData.days.length === 0) {
      return '<div class="empty-state"><span class="material-icons-round">fingerprint</span><p>Sin registros este mes</p></div>';
    }
    var html = '<div class="card" style="padding:0;overflow:hidden">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
    html += '<thead><tr style="border-bottom:1px solid var(--border)">';
    html += '<th style="padding:10px 14px;font-weight:600;color:var(--muted);text-align:left">Fecha</th>';
    html += '<th style="padding:10px 14px;font-weight:600;color:var(--muted);text-align:left">Entrada</th>';
    html += '<th style="padding:10px 14px;font-weight:600;color:var(--muted);text-align:left">Salida</th>';
    html += '<th style="padding:10px 14px;font-weight:600;color:var(--muted);text-align:left">Estado</th>';
    html += '</tr></thead><tbody>';
    monthData.days.forEach(function(r) {
      var ciStr = r.checkIn  ? AttendanceView._fmtTime(r.checkIn)  + (r.source === 'remoto' ? ' 🏠' : '') : '—';
      var coStr = r.checkOut ? AttendanceView._fmtTime(r.checkOut) : '—';
      html += '<tr style="border-bottom:1px solid var(--border)">';
      html += '<td style="padding:8px 14px">' + AttendanceView._fmtDate(r.date) + '</td>';
      html += '<td style="padding:8px 14px;font-variant-numeric:tabular-nums">' + ciStr + '</td>';
      html += '<td style="padding:8px 14px;font-variant-numeric:tabular-nums">' + coStr + '</td>';
      html += '<td style="padding:8px 14px">' + AttendanceView._badge(r.status) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  },

  _renderEmployeeCalendar: function(monthData) {
    var year  = monthData.year;
    var month = monthData.month;
    var today = AttendanceView._todayCdmx();
    var mon   = String(month).padStart(2, '0');
    var userHoDays = Array.isArray(monthData.remoteDays) ? monthData.remoteDays
                   : (APP.user && Array.isArray(APP.user.remoteDays)) ? APP.user.remoteDays : [];

    // Build lookup by date
    var byDate = {};
    monthData.days.forEach(function(d) { byDate[d.date] = d; });

    var DAYS_ES = ['Lu','Ma','Mi','Ju','Vi','Sa','Do'];
    var firstDow = new Date(year, month - 1, 1).getDay(); // 0=Sun
    var startPad = (firstDow + 6) % 7; // empty cells before day 1 (Mon-first)
    var lastDay  = new Date(year, month, 0).getDate();

    var ST = {
      a_tiempo:              { bg: '#ecfdf5', fg: '#16a34a', brd: '#bbf7d0' },
      retardo:               { bg: '#fffbeb', fg: '#d97706', brd: '#fde68a' },
      retardo_apelado:       { bg: '#fefce8', fg: '#16a34a', brd: '#bbf7d0' },
      ausente:               { bg: '#fef2f2', fg: '#dc2626', brd: '#fecaca' },
      vacaciones:            { bg: '#e0f2fe', fg: '#0284c7', brd: '#bae6fd' },
      remoto:                { bg: '#eff6ff', fg: '#2563eb', brd: '#bfdbfe' },
      justificada:           { bg: '#f5f3ff', fg: '#7c3aed', brd: '#ddd6fe' },
      pendiente_remoto:      { bg: '#fff7ed', fg: '#ea580c', brd: '#fed7aa' },
      pendiente_justificada: { bg: '#fdf4ff', fg: '#c026d3', brd: '#f0abfc' }
    };

    var hoDayNames = {1:'Lun',2:'Mar',3:'Mié',4:'Jue',5:'Vie',6:'Sáb',0:'Dom'};
    var html = '';
    if (userHoDays.length > 0) {
      var hoPills = userHoDays.map(function(d){ return '<span style="padding:3px 9px;border-radius:12px;font-size:11px;background:#ecfeff;color:#0891b2;border:1px solid #a5f3fc;font-weight:600">' + (hoDayNames[d]||d) + '</span>'; }).join(' ');
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:8px 10px;background:#ecfeff;border:1px solid #a5f3fc;border-radius:8px;font-size:12px;color:#0e7490">';
      html += '🏠 <strong>Días de home office:</strong> ' + hoPills + '</div>';
    }
    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">';

    // Day headers
    DAYS_ES.forEach(function(d, i) {
      html += '<div style="text-align:center;font-size:11px;font-weight:700;letter-spacing:.04em;color:var(--muted);padding:4px 0;text-transform:uppercase">' + d + '</div>';
    });

    // Empty cells before day 1
    for (var p = 0; p < startPad; p++) html += '<div></div>';

    // Day cells
    for (var d = 1; d <= lastDay; d++) {
      var dateStr  = year + '-' + mon + '-' + String(d).padStart(2, '0');
      var dow      = new Date(dateStr + 'T12:00:00').getDay();
      var isWeekend = dow === 0 || dow === 6;
      var isFuture  = dateStr > today;
      var isToday   = dateStr === today;
      var rec       = byDate[dateStr];

      var isHoDay = userHoDays.length > 0 && userHoDays.indexOf(dow) > -1;

      if (isWeekend) {
        html += '<div style="border-radius:6px;padding:6px 4px;min-height:52px;opacity:0.3;text-align:center">';
        html += '<div style="font-size:12px;color:var(--muted)">' + d + '</div></div>';
      } else if (isFuture) {
        if (isHoDay) {
          html += '<div style="border-radius:6px;padding:6px 4px;min-height:52px;text-align:center;background:#ecfeff;border:1px solid #a5f3fc;border-top:3px solid #0891b2">';
          html += '<div style="font-size:12px;color:#0891b2;font-weight:500">' + d + '</div>';
          html += '<div style="font-size:10px;margin-top:3px">🏠</div></div>';
        } else {
          html += '<div style="border-radius:6px;padding:6px 4px;min-height:52px;opacity:0.25;text-align:center">';
          html += '<div style="font-size:12px;color:var(--muted)">' + d + '</div></div>';
        }
      } else if (rec) {
        var c   = ST[rec.status] || { bg: 'var(--surface)', fg: 'var(--muted)', brd: 'var(--border)' };
        var ci  = rec.checkIn ? AttendanceView._fmtTime(rec.checkIn) : '';
        var sel = dateStr === AttendanceView._selectedDate ? ';outline:2px solid var(--primary);outline-offset:1px' : '';
        var cid = 'att-cd-' + dateStr.replace(/-/g, '');
        var hoTop = isHoDay ? 'border-top:3px solid #0891b2;' : 'border-top:1px solid ' + c.brd + ';';
        html += '<div id="' + cid + '" onclick="AttendanceView._selectDay(\'' + dateStr + '\')" ';
        html += 'style="border-radius:6px;padding:6px 4px;min-height:52px;background:' + c.bg + ';' + hoTop + 'border-right:1px solid ' + c.brd + ';border-bottom:1px solid ' + c.brd + ';border-left:1px solid ' + c.brd + sel + ';text-align:center;cursor:pointer">';
        html += '<div style="font-size:12px;font-weight:' + (isToday ? '700' : '500') + ';color:' + c.fg + '">' + d + '</div>';
        if (ci) html += '<div style="font-size:10px;color:' + c.fg + ';margin-top:3px;font-variant-numeric:tabular-nums">' + ci + '</div>';
        if (rec.status === 'remoto' || rec.source === 'remoto') html += '<div style="font-size:10px;margin-top:2px">🏠</div>';
        if (rec.status === 'justificada') html += '<div style="font-size:10px;margin-top:2px">📋</div>';
        if (rec.status === 'pendiente_remoto') html += '<div style="font-size:10px;margin-top:2px">⏳</div>';
        if (rec.status === 'pendiente_justificada') html += '<div style="font-size:10px;margin-top:2px">⏳</div>';
        html += '</div>';
      } else {
        var sel2 = dateStr === AttendanceView._selectedDate ? ';outline:2px solid var(--primary);outline-offset:1px' : '';
        var cid2 = 'att-cd-' + dateStr.replace(/-/g, '');
        var hoTop2 = isHoDay ? 'border-top:3px solid #0891b2;' : 'border-top:1px solid var(--border);';
        html += '<div id="' + cid2 + '" onclick="AttendanceView._selectDay(\'' + dateStr + '\')" ';
        html += 'style="border-radius:6px;padding:6px 4px;min-height:52px;background:var(--surface);' + hoTop2 + 'border-right:1px solid var(--border);border-bottom:1px solid var(--border);border-left:1px solid var(--border)' + sel2 + ';text-align:center;cursor:pointer">';
        html += '<div style="font-size:12px;color:var(--muted)">' + d + '</div></div>';
      }
    }
    html += '</div>';

    // Legend
    html += '<div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap">';
    html += '<div style="display:flex;align-items:center;gap:5px"><div style="width:10px;height:10px;border-radius:3px;background:#ecfdf5;border:1px solid #bbf7d0"></div><span style="font-size:12px;color:var(--muted)">A tiempo</span></div>';
    html += '<div style="display:flex;align-items:center;gap:5px"><div style="width:10px;height:10px;border-radius:3px;background:#fffbeb;border:1px solid #fde68a"></div><span style="font-size:12px;color:var(--muted)">Retardo</span></div>';
    html += '<div style="display:flex;align-items:center;gap:5px"><div style="width:10px;height:10px;border-radius:3px;background:#fefce8;border:1px solid #bbf7d0"></div><span style="font-size:12px;color:var(--muted)">Retardo apelado</span></div>';
    html += '<div style="display:flex;align-items:center;gap:5px"><div style="width:10px;height:10px;border-radius:3px;background:#fef2f2;border:1px solid #fecaca"></div><span style="font-size:12px;color:var(--muted)">Ausente</span></div>';
    html += '<div style="display:flex;align-items:center;gap:5px"><div style="width:10px;height:10px;border-radius:3px;background:#eff6ff;border:1px solid #bfdbfe"></div><span style="font-size:12px;color:var(--muted)">Remoto</span></div>';
    html += '<div style="display:flex;align-items:center;gap:5px"><div style="width:10px;height:10px;border-radius:3px;background:#f5f3ff;border:1px solid #ddd6fe"></div><span style="font-size:12px;color:var(--muted)">Justificada</span></div>';
    if (userHoDays.length > 0) {
      html += '<div style="display:flex;align-items:center;gap:5px"><div style="width:10px;height:10px;border-radius:3px;background:#ecfeff;border-top:3px solid #0891b2;border-right:1px solid #a5f3fc;border-bottom:1px solid #a5f3fc;border-left:1px solid #a5f3fc"></div><span style="font-size:12px;color:var(--muted)">Día home office</span></div>';
    }
    html += '</div>';
    return html;
  },

  _loadDashboard: function(year, month) {
    var el = document.getElementById('att-content'); if (!el) return;
    var cm = AttendanceView._currentMonthCdmx();
    year  = year  || cm.year;
    month = month || cm.month;
    el.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    var isAdminHR = APP.user && (APP.user.isAdmin || APP.user.isHR);
    var reqs = [
      new Promise(function(res) { APP.api('attendance.getMonth', { year: year, month: month }, function(e, d) { res(e ? null : d); }); })
    ];
    if (isAdminHR) {
      reqs.push(new Promise(function(res) { APP.api('tardiness.getAllStatus', {}, function(e, d) { res(e ? null : d); }); }));
    }
    Promise.all(reqs).then(function(results) {
      var data = results[0];
      if (!data) { el.innerHTML = '<div class="empty-state"><p>Error cargando datos</p></div>'; return; }
      AttendanceView._tardinessData = results[1] || null;
      el.innerHTML = AttendanceView._renderDashboard(data, year, month);
    });
  },

  _renderDashboard: function(data, year, month) {
    var MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    var cm = AttendanceView._currentMonthCdmx();
    var isCurrentMonth = (year === cm.year && month === cm.month);

    var prevYear  = month === 1 ? year - 1 : year;
    var prevMonth = month === 1 ? 12 : month - 1;
    var nextYear  = month === 12 ? year + 1 : year;
    var nextMonth = month === 12 ? 1 : month + 1;

    var s = data.summary;
    var n = (data.workdays || 0) * (s.total || 1);
    var pct = n > 0 ? Math.round((s.aTime / n) * 100) : 0;

    AttendanceView._dashData = { data: data, year: year, month: month, label: MONTHS_ES[month - 1] + ' ' + year };

    var html = '';

    // Header: back + export + month nav
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;flex-wrap:wrap">';
    html += '<button onclick="AttendanceView._loadAdmin(AttendanceView._todayCdmx())" ';
    html += 'style="padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;font-size:13px">← Hoy</button>';
    html += '<div style="position:relative;display:inline-block">';
    html += '<button onclick="AttendanceView._toggleExportMenu()" ';
    html += 'style="padding:6px 14px;border-radius:6px;border:1px solid #16a34a;background:#16a34a;color:#fff;cursor:pointer;font-size:13px;font-weight:500">↓ Exportar CSV ▾</button>';
    html += '<div id="att-export-menu" style="display:none;position:absolute;top:calc(100% + 4px);left:0;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:200px;z-index:200;overflow:hidden">';
    html += '<div onclick="AttendanceView._exportDashboard(null)" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'" style="padding:10px 16px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border)">📅 Mes completo</div>';
    html += '<div onclick="AttendanceView._exportDashboard(1)" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'" style="padding:10px 16px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border)">1ª quincena (días 1-15)</div>';
    html += '<div onclick="AttendanceView._exportDashboard(2)" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'" style="padding:10px 16px;cursor:pointer;font-size:13px">2ª quincena (días 16-fin)</div>';
    html += '</div></div>';
    html += '<div style="display:inline-flex;align-items:center;gap:0;border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-left:auto">';
    html += '<button onclick="AttendanceView._loadDashboard(' + prevYear + ',' + prevMonth + ')" ';
    html += 'style="padding:6px 14px;border:none;border-right:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;font-size:14px">‹</button>';
    html += '<span style="padding:6px 18px;font-weight:600;font-size:14px;background:var(--surface)">' + MONTHS_ES[month - 1] + ' ' + year + '</span>';
    if (!isCurrentMonth) {
      html += '<button onclick="AttendanceView._loadDashboard(' + nextYear + ',' + nextMonth + ')" ';
      html += 'style="padding:6px 14px;border:none;border-left:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;font-size:14px">›</button>';
    } else {
      html += '<button disabled style="padding:6px 14px;border:none;border-left:1px solid var(--border);background:var(--surface);color:var(--muted);font-size:14px;opacity:0.35">›</button>';
    }
    html += '</div></div>';

    // Summary tiles
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:12px;margin-bottom:20px">';
    html += AttendanceView._tile(pct + '%', 'Puntualidad', '#3b82f6');
    html += AttendanceView._tile(s.retardo, 'Retardos', '#f59e0b');
    html += AttendanceView._tile(s.ausente, 'Ausencias', '#ef4444');
    html += AttendanceView._tile(s.vacaciones || 0, 'Vacaciones', '#0ea5e9');
    html += AttendanceView._tile(s.remoto || 0, 'Remotos', '#2563eb');
    html += AttendanceView._tile(s.justificada || 0, 'Justificadas', '#7c3aed');
    html += AttendanceView._tile(data.workdays, 'Días lab.', '#64748b');
    html += AttendanceView._tile(s.total, 'Empleados', '#475569');
    html += '</div>';

    if (!data.employees || data.employees.length === 0) {
      html += '<div class="empty-state"><span class="material-icons-round">people</span><p>Sin empleados con huella registrada</p></div>';
      return html;
    }

    // Build tardiness lookup for dashboard column
    var tardMap = {};
    var tardItems = (AttendanceView._tardinessData && AttendanceView._tardinessData.items) || [];
    tardItems.forEach(function(t) { tardMap[t.employeeId] = t; });
    var hasTard = tardItems.length > 0;

    html += '<div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
    html += '<thead><tr style="border-bottom:2px solid var(--border);text-align:left">';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted)">Empleado</th>';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted)">Depto.</th>';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted);text-align:center">A tiempo</th>';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted);text-align:center">Retardos</th>';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted);text-align:center">Ausentes</th>';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted);text-align:center">Vacaciones</th>';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted);text-align:center">Remotos</th>';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted);text-align:center">Justificadas</th>';
    if (hasTard) {
      html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted);text-align:center" title="Retardos acumulados en 6 meses · días a descontar por política">Retardos acum. / Días desc.</th>';
    }
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted);text-align:right">% Puntual</th>';
    html += '</tr></thead><tbody>';

    data.employees.forEach(function(e) {
      var name = (e.firstName || '') + ' ' + (e.lastName || '');
      var pctE = e.workdays > 0 ? Math.round((e.aTime / e.workdays) * 100) : 0;
      var pctColor = pctE >= 90 ? '#16a34a' : pctE >= 75 ? '#d97706' : '#dc2626';
      var tard = tardMap[e.employeeId] || null;
      html += '<tr style="border-bottom:1px solid var(--border)">';
      html += '<td style="padding:8px 10px">' + name + '</td>';
      html += '<td style="padding:8px 10px;color:var(--muted)">' + (e.department || '—') + '</td>';
      html += '<td style="padding:8px 10px;text-align:center;font-variant-numeric:tabular-nums">' + e.aTime + '</td>';
      html += '<td style="padding:8px 10px;text-align:center;font-variant-numeric:tabular-nums' + (e.retardo > 0 ? ';color:#d97706;font-weight:600' : '') + '">' + e.retardo + '</td>';
      html += '<td style="padding:8px 10px;text-align:center;font-variant-numeric:tabular-nums' + (e.ausente > 0 ? ';color:#dc2626;font-weight:600' : '') + '">' + e.ausente + '</td>';
      html += '<td style="padding:8px 10px;text-align:center;font-variant-numeric:tabular-nums' + ((e.vacaciones || 0) > 0 ? ';color:#0284c7;font-weight:600' : '') + '">' + (e.vacaciones || 0) + '</td>';
      html += '<td style="padding:8px 10px;text-align:center;font-variant-numeric:tabular-nums' + ((e.remoto || 0) > 0 ? ';color:#2563eb;font-weight:600' : '') + '">' + (e.remoto || 0) + '</td>';
      html += '<td style="padding:8px 10px;text-align:center;font-variant-numeric:tabular-nums' + ((e.justificada || 0) > 0 ? ';color:#7c3aed;font-weight:600' : '') + '">' + (e.justificada || 0) + '</td>';
      if (hasTard) {
        if (tard && (tard.count > 0 || tard.daysToDeduct > 0)) {
          var descColor = tard.daysToDeduct > 0 ? '#7e22ce' : '#64748b';
          html += '<td style="padding:8px 10px;text-align:center;font-variant-numeric:tabular-nums">';
          html += '<span style="color:#d97706;font-weight:600">' + tard.count + '</span>';
          html += '<span style="color:#94a3b8;margin:0 3px">/</span>';
          html += '<span style="color:' + descColor + ';font-weight:' + (tard.daysToDeduct > 0 ? '700' : '400') + '">' + tard.daysToDeduct + 'd</span>';
          html += '</td>';
        } else {
          html += '<td style="padding:8px 10px;text-align:center;color:#94a3b8">—</td>';
        }
      }
      html += '<td style="padding:8px 10px;text-align:right;font-weight:600;color:' + pctColor + '">' + pctE + '%</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div></div>';
    return html;
  },

  _toggleExportMenu: function() {
    var menu = document.getElementById('att-export-menu');
    if (!menu) return;
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    if (menu.style.display === 'block') {
      function closeMenu(e) {
        if (!menu.contains(e.target)) {
          menu.style.display = 'none';
          document.removeEventListener('click', closeMenu);
        }
      }
      setTimeout(function() { document.addEventListener('click', closeMenu); }, 0);
    }
  },

  _exportDashboard: function(quincena) {
    var menu = document.getElementById('att-export-menu');
    if (menu) menu.style.display = 'none';

    var d = AttendanceView._dashData;
    if (!d || !d.data) return;

    function doExport(data, periodLabel) {
      // Build tardiness lookup by employeeId
      var tardMap = {};
      var tardItems = (AttendanceView._tardinessData && AttendanceView._tardinessData.items) || [];
      tardItems.forEach(function(t) { tardMap[t.employeeId] = t; });

      var rows = [
        ['Empleado', 'Departamento', 'Días Laborables', 'A Tiempo', 'Retardos', 'Ausencias', 'Retardos acum. (6m)', 'Días a desc. esta quincena', '% Puntualidad']
      ];

      // Only include employees with at least one retardo or ausencia
      var filtered = (data.employees || []).filter(function(e) {
        return e.retardo > 0 || e.ausente > 0;
      });

      filtered.forEach(function(e) {
        var pct = e.workdays > 0 ? Math.round((e.aTime / e.workdays) * 100) : 0;
        var tard = tardMap[e.employeeId] || tardMap[e.id] || null;
        rows.push([
          (e.firstName + ' ' + e.lastName).trim(),
          e.department || '',
          e.workdays,
          e.aTime,
          e.retardo,
          e.ausente,
          tard ? tard.count       : '',
          tard ? tard.daysToDeduct : '',
          pct + '%'
        ]);
      });

      var s = data.summary;
      var n = (data.workdays || 0) * (filtered.length || 1);
      var pctTotal = n > 0 ? Math.round(
        filtered.reduce(function(acc, e) { return acc + e.aTime; }, 0) / n * 100
      ) : 0;
      var totalDesc = tardItems.reduce(function(acc, t) { return acc + (t.daysToDeduct || 0); }, 0);
      rows.push(['TOTAL', filtered.length + ' empleados', data.workdays, s.aTime, s.retardo, s.ausente, '', totalDesc + ' días', pctTotal + '%']);

      var csv = '﻿' + rows.map(function(r) {
        return r.map(function(v) {
          var str = String(v);
          return str.indexOf(',') > -1 || str.indexOf('"') > -1 ? '"' + str.replace(/"/g, '""') + '"' : str;
        }).join(',');
      }).join('\r\n');

      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href   = url;
      a.download = 'asistencia-' + periodLabel + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    // If full month, use cached data
    if (!quincena) {
      doExport(d.data, d.label.toLowerCase().replace(/ /g, '-'));
      return;
    }

    // Quincena: re-fetch from API with the quincena parameter
    var qLabel = (quincena === 1 ? '1q-' : '2q-') + d.label.toLowerCase().replace(/ /g, '-');
    APP.api('attendance.getMonth', { year: d.year, month: d.month, quincena: quincena }, function(err, data) {
      if (err) { APP.toast('Error al obtener datos: ' + err, 'error'); return; }
      doExport(data, qLabel);
    });
  },

  _tile: function(value, label, color) {
    return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">' +
      '<div style="font-size:28px;font-weight:700;color:' + color + ';font-variant-numeric:tabular-nums">' + value + '</div>' +
      '<div style="font-size:12px;color:var(--muted);margin-top:4px">' + label + '</div>' +
      '</div>';
  },

  _scheduleRefresh: function(date) {
    if (AttendanceView._timer) clearInterval(AttendanceView._timer);
    if (date !== AttendanceView._todayCdmx()) return;
    AttendanceView._timer = setInterval(function() {
      var viewEl = document.getElementById('view-attendance');
      if (viewEl && viewEl.classList.contains('active')) {
        AttendanceView._loadAdmin(AttendanceView._todayCdmx());
      } else {
        clearInterval(AttendanceView._timer);
        AttendanceView._timer = null;
      }
    }, 60000);
  },

  _todayCdmx: function() {
    var d = new Date(new Date().getTime() - 6 * 3600 * 1000);
    return d.toISOString().split('T')[0];
  },

  _fmtTime: function(utcTs) {
    try {
      return new Date(utcTs).toLocaleTimeString('es-MX', {
        timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit'
      });
    } catch(e) { return '—'; }
  },

  _fmtDate: function(dateStr) {
    try {
      return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-MX', {
        weekday: 'short', day: 'numeric', month: 'short'
      });
    } catch(e) { return dateStr; }
  },

  _pill: function(text, color) {
    return '<div style="padding:4px 12px;border-radius:20px;background:' + color + '20;color:' + color + ';font-size:12px;font-weight:600">' + text + '</div>';
  },

  // ── Override ausencia (HR/Admin) ──────────────────────────────

  _openOverrideModal: function(employeeId, date, rcId, empName) {
    var existing = document.getElementById('att-override-modal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'att-override-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9200;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';

    var html = '<div style="background:var(--card);border-radius:16px;max-width:420px;width:100%;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)">';
    html += '<div><div style="font-weight:700;font-size:15px">Corregir ausencia</div>';
    html += '<div style="font-size:12px;color:var(--muted);margin-top:1px">Esta acción queda registrada con tu nombre</div></div>';
    html += '<button onclick="document.getElementById(\'att-override-modal\').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:22px;line-height:1;padding:2px">×</button>';
    html += '</div><div style="padding:20px">';
    html += '<div style="background:var(--bg);border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:13px">';
    html += '<div style="color:var(--muted);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Empleado</div>';
    html += '<strong>' + empName + '</strong>';
    html += '<div style="color:var(--muted);font-size:11px;margin-top:4px">' + date + '</div>';
    html += '</div>';
    html += '<div style="margin-bottom:16px">';
    html += '<label style="font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:6px">Justificación <span style="color:#dc2626">*</span></label>';
    html += '<textarea id="att-override-notes" rows="3" placeholder="Describe la razón por la que se corrige esta ausencia…" ';
    html += 'oninput="AttendanceView._onOverrideInput()" ';
    html += 'style="width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;background:var(--surface);color:var(--text);resize:vertical"></textarea>';
    html += '</div>';
    html += '<button id="att-override-submit" onclick="AttendanceView._submitOverride(\'' + employeeId + '\',\'' + date + '\',\'' + (rcId || '') + '\')" disabled ';
    html += 'style="width:100%;padding:10px;border-radius:8px;border:none;background:#cbd5e1;color:#fff;cursor:default;font-weight:600;font-size:14px">Confirmar corrección</button>';
    html += '<p style="font-size:11px;color:var(--muted);margin:10px 0 0;text-align:center">El día quedará registrado como <strong>Remoto ✓</strong> en el historial de asistencia</p>';
    html += '</div></div>';

    overlay.innerHTML = html;
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    setTimeout(function() { var t = document.getElementById('att-override-notes'); if (t) t.focus(); }, 50);
  },

  _onOverrideInput: function() {
    var ta  = document.getElementById('att-override-notes');
    var btn = document.getElementById('att-override-submit');
    if (!ta || !btn) return;
    var hasText = ta.value.trim().length > 0;
    btn.disabled   = !hasText;
    btn.style.background = hasText ? '#dc2626' : '#cbd5e1';
    btn.style.cursor     = hasText ? 'pointer'  : 'default';
  },

  _submitOverride: function(employeeId, date, rcId) {
    var ta  = document.getElementById('att-override-notes');
    var btn = document.getElementById('att-override-submit');
    if (!ta || !ta.value.trim()) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

    var payload = { notes: ta.value.trim() };
    if (rcId) payload.id         = rcId;
    else      { payload.employeeId = employeeId; payload.date = date; }

    APP.api('remote.override', payload, function(err) {
      if (err) {
        APP.toast(err, 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Confirmar corrección'; }
        return;
      }
      APP.toast('Ausencia corregida ✓', 'success');
      var m = document.getElementById('att-override-modal');
      if (m) m.remove();
      AttendanceView._loadAdmin(date);
    });
  },

  // ── Manager pending-approval popup ────────────────────────────

  _checkManagerPending: function() {
    APP.api('remote.getPending', {}, function(err, items) {
      if (err || !items || items.length === 0) return;
      AttendanceView._renderManagerPopup(items);
    });
  },

  _renderManagerPopup: function(items) {
    var existing = document.getElementById('att-mgr-popup');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'att-mgr-popup';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';

    var html = '<div style="background:var(--card);border-radius:16px;max-width:560px;width:100%;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border);flex-shrink:0">';
    html += '<div><div style="font-weight:700;font-size:15px">Solicitudes pendientes</div>';
    html += '<div style="font-size:12px;color:var(--muted);margin-top:1px">' + items.length + ' solicitud' + (items.length !== 1 ? 'es' : '') + ' esperan tu respuesta hoy</div></div>';
    html += '<button onclick="document.getElementById(\'att-mgr-popup\').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:22px;line-height:1;padding:2px 6px">×</button>';
    html += '</div><div style="overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px">';

    items.forEach(function(item) {
      var name = (item.firstName + ' ' + item.lastName).trim();
      var isRemoto = item.type === 'remoto';
      var typeLabel = isRemoto ? 'Check-in remoto' : 'Falta justificada';
      var typeColor = isRemoto ? '#2563eb' : '#7c3aed';

      html += '<div id="att-mgr-' + item.id + '" style="border:1px solid var(--border);border-radius:10px;padding:14px">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
      html += '<div style="font-weight:600;font-size:14px">' + name + '</div>';
      html += '<span style="padding:2px 8px;border-radius:4px;background:' + typeColor + '20;color:' + typeColor + ';font-size:12px;font-weight:600">' + typeLabel + '</span>';
      html += '</div>';
      if (item.reason) {
        html += '<div style="font-size:12px;color:var(--muted);margin-bottom:10px">📝 ' + item.reason + '</div>';
      }
      if (isRemoto && (item.photoSelfUrl || item.photoEnvUrl)) {
        html += '<div style="display:flex;gap:8px;margin-bottom:10px">';
        if (item.photoSelfUrl) {
          html += '<div><div style="font-size:10px;color:var(--muted);margin-bottom:2px">Selfie</div>';
          html += '<img src="' + item.photoSelfUrl + '" style="width:80px;height:60px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" /></div>';
        }
        if (item.photoEnvUrl) {
          html += '<div><div style="font-size:10px;color:var(--muted);margin-bottom:2px">Entorno</div>';
          html += '<img src="' + item.photoEnvUrl + '" style="width:80px;height:60px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" /></div>';
        }
        html += '</div>';
      }
      if (!isRemoto && item.documentUrl) {
        html += '<div style="margin-bottom:10px"><div style="font-size:10px;color:var(--muted);margin-bottom:2px">Justificante</div>';
        html += '<img src="' + item.documentUrl + '" style="width:80px;height:60px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" /></div>';
      }
      html += '<div style="display:flex;gap:8px">';
      html += '<button onclick="AttendanceView._reviewRequest(\'' + item.id + '\',\'aprobar\')" ';
      html += 'style="flex:1;padding:8px;border-radius:7px;border:none;background:#16a34a;color:#fff;cursor:pointer;font-weight:600;font-size:13px">✓ Aprobar</button>';
      html += '<button onclick="AttendanceView._reviewRequest(\'' + item.id + '\',\'denegar\')" ';
      html += 'style="flex:1;padding:8px;border-radius:7px;border:1px solid #dc2626;background:transparent;color:#dc2626;cursor:pointer;font-weight:600;font-size:13px">✗ Denegar</button>';
      html += '</div></div>';
    });

    html += '</div></div>';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
  },

  _reviewRequest: function(id, action) {
    var notes = '';
    if (action === 'denegar') {
      notes = window.prompt('Motivo del rechazo (opcional):') || '';
    }
    var itemEl = document.getElementById('att-mgr-' + id);
    if (itemEl) itemEl.innerHTML = '<div style="text-align:center;padding:10px;color:var(--muted);font-size:13px">Procesando…</div>';

    APP.api('remote.review', { id: id, action: action, notes: notes }, function(err) {
      if (err) { APP.toast(err, 'error'); AttendanceView._checkManagerPending(); return; }
      if (itemEl) {
        var color = action === 'aprobar' ? '#16a34a' : '#dc2626';
        itemEl.style.opacity = '.5';
        itemEl.innerHTML = '<div style="text-align:center;padding:12px;font-size:13px;font-weight:600;color:' + color + '">' + (action === 'aprobar' ? '✓ Aprobado' : '✗ Denegado') + '</div>';
      }
      APP.toast(action === 'aprobar' ? 'Aprobado ✓' : 'Denegado', 'success');
      setTimeout(function() {
        var popup = document.getElementById('att-mgr-popup');
        if (!popup) return;
        var all = popup.querySelectorAll('[id^="att-mgr-"]');
        var done = true;
        all.forEach(function(el) { if (parseFloat(el.style.opacity || '1') > 0.6) done = false; });
        if (done) popup.remove();
      }, 1200);
    });
  },

  // ── Remote check-in multi-step modal ──────────────────────────

  _openRemoteModal: function() {
    var remoteDays = (APP.user && Array.isArray(APP.user.remoteDays)) ? APP.user.remoteDays : [];
    var todayDow = new Date().getDay();
    var authorizedDay = remoteDays.length === 0 || remoteDays.indexOf(todayDow) > -1;
    AttendanceView._rState = { step: 1, reason: '', photoSelf: null, photoEnv: null, stream: null, reasons: [], authorizedDay: authorizedDay };
    APP.api('remote.getConfig', {}, function(err, cfg) {
      AttendanceView._rState.reasons = (cfg && cfg.reasons) || ['Visita a cliente','Trámite personal / médico','Trabajo desde casa','Evento o capacitación externa','Otro'];
      AttendanceView._drawRemoteModal();
    });
  },

  _drawRemoteModal: function() {
    var st = AttendanceView._rState;
    if (!st) return;

    var existing = document.getElementById('att-rmodal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'att-rmodal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9100;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';

    var pct = Math.round((st.step / 3) * 100);
    var html = '<div style="background:var(--card);border-radius:16px;max-width:400px;width:100%;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)">';
    html += '<div><div style="font-weight:700;font-size:15px">Check-in remoto</div>';
    html += '<div style="font-size:11px;color:var(--muted);margin-top:1px">Paso ' + st.step + ' de 3</div></div>';
    html += '<button onclick="AttendanceView._closeRemoteModal()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:22px;line-height:1;padding:2px">×</button>';
    html += '</div>';
    html += '<div style="height:3px;background:var(--border)"><div style="height:100%;width:' + pct + '%;background:#2563eb"></div></div>';
    html += '<div style="padding:20px">';

    if (!st.authorizedDay) {
      html += '<div style="background:#fef9c3;border:1px solid #fef08a;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#92400e">⚠️ Hoy no es uno de tus días de home office autorizados. Tu solicitud requerirá aprobación del manager.</div>';
    }

    if (st.step === 1) {
      html += '<p style="font-size:13px;color:var(--muted);margin:0 0 12px">Selecciona el motivo de tu check-in:</p>';
      st.reasons.forEach(function(r) {
        var sel = st.reason === r;
        var safeR = r.replace(/'/g, '&#39;');
        html += '<div onclick="AttendanceView._setRemoteReason(\'' + safeR + '\')" ';
        html += 'style="padding:10px 14px;border:2px solid ' + (sel ? '#2563eb' : 'var(--border)') + ';border-radius:8px;cursor:pointer;margin-bottom:8px;font-size:13px;background:' + (sel ? '#eff6ff' : 'var(--surface)') + ';color:' + (sel ? '#2563eb' : 'var(--text)') + ';font-weight:' + (sel ? '600' : '400') + '">' + r + '</div>';
      });
      var canNext = !!st.reason;
      html += '<button onclick="AttendanceView._remoteNext()" ' + (canNext ? '' : 'disabled ');
      html += 'style="width:100%;padding:10px;border-radius:8px;border:none;background:' + (canNext ? '#2563eb' : '#cbd5e1') + ';color:#fff;cursor:' + (canNext ? 'pointer' : 'default') + ';font-weight:600;font-size:14px;margin-top:4px">Continuar →</button>';

    } else if (st.step === 2 || st.step === 3) {
      var isStep2 = st.step === 2;
      var photo   = isStep2 ? st.photoSelf : st.photoEnv;
      var tip     = isStep2 ? 'Toma una selfie para verificar tu identidad.' : 'Toma una foto de tu entorno de trabajo.';
      html += '<p style="font-size:13px;color:var(--muted);margin:0 0 12px">' + tip + '</p>';

      if (!photo) {
        html += '<div style="background:#000;border-radius:10px;overflow:hidden;aspect-ratio:4/3;margin-bottom:12px">';
        html += '<video id="att-rv" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover"></video></div>';
        html += '<button onclick="AttendanceView._captureRemote(\'' + (isStep2 ? 'self' : 'env') + '\')" ';
        html += 'style="width:100%;padding:10px;border-radius:8px;border:none;background:#2563eb;color:#fff;cursor:pointer;font-weight:600;font-size:14px;margin-bottom:10px">📷 Tomar foto</button>';
      } else {
        html += '<div style="border-radius:10px;overflow:hidden;aspect-ratio:4/3;margin-bottom:8px">';
        html += '<img src="' + photo + '" style="width:100%;height:100%;object-fit:cover" /></div>';
        html += '<button onclick="AttendanceView._retakeRemote(\'' + (isStep2 ? 'self' : 'env') + '\')" ';
        html += 'style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;font-size:13px;margin-bottom:10px">↺ Repetir foto</button>';
      }

      if (isStep2) {
        var can2 = !!st.photoSelf;
        html += '<button onclick="AttendanceView._remoteNext()" ' + (can2 ? '' : 'disabled ');
        html += 'style="width:100%;padding:10px;border-radius:8px;border:none;background:' + (can2 ? '#2563eb' : '#cbd5e1') + ';color:#fff;cursor:' + (can2 ? 'pointer' : 'default') + ';font-weight:600;font-size:14px">Continuar →</button>';
      } else {
        var can3 = !!st.photoEnv;
        html += '<button id="att-rsubmit" onclick="AttendanceView._submitRemote()" ' + (can3 ? '' : 'disabled ');
        html += 'style="width:100%;padding:10px;border-radius:8px;border:none;background:' + (can3 ? '#16a34a' : '#cbd5e1') + ';color:#fff;cursor:' + (can3 ? 'pointer' : 'default') + ';font-weight:600;font-size:14px">✓ Enviar solicitud</button>';
      }
    }

    html += '</div></div>';
    overlay.innerHTML = html;
    overlay.addEventListener('click', function(e) { if (e.target === overlay) AttendanceView._closeRemoteModal(); });
    document.body.appendChild(overlay);

    if ((st.step === 2 && !st.photoSelf) || (st.step === 3 && !st.photoEnv)) {
      var facingMode = st.step === 2 ? 'user' : 'environment';
      navigator.mediaDevices.getUserMedia({ video: { facingMode: facingMode }, audio: false })
        .then(function(s) {
          st.stream = s;
          var v = document.getElementById('att-rv');
          if (v) v.srcObject = s;
        })
        .catch(function() { APP.toast('No se pudo acceder a la cámara', 'error'); });
    }
  },

  _closeRemoteModal: function() {
    var st = AttendanceView._rState;
    if (st && st.stream) { st.stream.getTracks().forEach(function(t) { t.stop(); }); }
    AttendanceView._rState = null;
    var m = document.getElementById('att-rmodal');
    if (m) m.remove();
  },

  _setRemoteReason: function(reason) {
    if (!AttendanceView._rState) return;
    AttendanceView._rState.reason = reason;
    AttendanceView._drawRemoteModal();
  },

  _remoteNext: function() {
    var st = AttendanceView._rState;
    if (!st) return;
    if (st.step === 1 && !st.reason) return;
    if (st.step === 2 && !st.photoSelf) return;
    if (st.stream) { st.stream.getTracks().forEach(function(t) { t.stop(); }); st.stream = null; }
    st.step++;
    AttendanceView._drawRemoteModal();
  },

  _captureRemote: function(which) {
    var v = document.getElementById('att-rv');
    if (!v || !v.srcObject) { APP.toast('Cámara no disponible', 'error'); return; }
    var canvas = document.createElement('canvas');
    canvas.width  = v.videoWidth  || 640;
    canvas.height = v.videoHeight || 480;
    canvas.getContext('2d').drawImage(v, 0, 0);
    var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    var st = AttendanceView._rState;
    if (!st) return;
    if (which === 'self') st.photoSelf = dataUrl;
    else                  st.photoEnv  = dataUrl;
    if (st.stream) { st.stream.getTracks().forEach(function(t) { t.stop(); }); st.stream = null; }
    AttendanceView._drawRemoteModal();
  },

  _retakeRemote: function(which) {
    var st = AttendanceView._rState;
    if (!st) return;
    if (which === 'self') st.photoSelf = null;
    else                  st.photoEnv  = null;
    AttendanceView._drawRemoteModal();
  },

  _dataUrlToBlob: function(dataUrl) {
    var parts = dataUrl.split(',');
    var mimeMatch = parts[0].match(/:(.*?);/);
    var mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    var binary = atob(parts[1]);
    var arr = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return new Blob([arr], { type: mime });
  },

  _uploadPhoto: function(dataUrl, filename, callback) {
    var blob = AttendanceView._dataUrlToBlob(dataUrl);
    var fd = new FormData();
    fd.append('file', blob, filename);
    var doUpload = function(token) {
      var headers = token ? { 'Authorization': 'Bearer ' + token } : {};
      fetch('/api/upload-evidence', { method: 'POST', body: fd, headers: headers })
        .then(function(r) { return r.json(); })
        .then(function(j) { j.url ? callback(null, j.url) : callback(j.error || 'Error al subir'); })
        .catch(function(e) { callback(e.message); });
    };
    if (_sb) {
      _sb.auth.getSession().then(function(res) { doUpload(res.data.session ? res.data.session.access_token : null); });
    } else { doUpload(null); }
  },

  _submitRemote: function() {
    var st = AttendanceView._rState;
    if (!st || !st.photoSelf || !st.photoEnv) return;
    var btn = document.getElementById('att-rsubmit');
    if (btn) { btn.disabled = true; btn.textContent = 'Subiendo fotos…'; }

    AttendanceView._uploadPhoto(st.photoSelf, 'selfie.jpg', function(err1, url1) {
      if (err1) { APP.toast('Error subiendo foto: ' + err1, 'error'); if (btn) { btn.disabled = false; btn.textContent = '✓ Enviar solicitud'; } return; }
      AttendanceView._uploadPhoto(st.photoEnv, 'entorno.jpg', function(err2, url2) {
        if (err2) { APP.toast('Error subiendo foto: ' + err2, 'error'); if (btn) { btn.disabled = false; btn.textContent = '✓ Enviar solicitud'; } return; }
        if (btn) btn.textContent = 'Enviando solicitud…';
        APP.api('remote.request', { type: 'remoto', reason: st.reason, photoSelfUrl: url1, photoEnvUrl: url2 }, function(err3) {
          if (err3) { APP.toast(err3, 'error'); if (btn) { btn.disabled = false; btn.textContent = '✓ Enviar solicitud'; } return; }
          APP.toast('Solicitud enviada. Tu manager recibirá un correo ✓', 'success');
          AttendanceView._closeRemoteModal();
          AttendanceView._loadEmployee();
        });
      });
    });
  },

  // ── Justified absence modal ────────────────────────────────────

  _openJustifiedModal: function() {
    var existing = document.getElementById('att-jmodal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'att-jmodal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9100;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';

    var html = '<div style="background:var(--card);border-radius:16px;max-width:400px;width:100%;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)">';
    html += '<div style="font-weight:700;font-size:15px">Falta justificada</div>';
    html += '<button onclick="document.getElementById(\'att-jmodal\').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:22px;line-height:1;padding:2px">×</button>';
    html += '</div><div style="padding:20px">';
    html += '<p style="font-size:13px;color:var(--muted);margin:0 0 16px">Sube tu justificante (receta, comprobante, etc.). El área de RH lo revisará y aprobará tu ausencia.</p>';
    html += '<div style="margin-bottom:14px">';
    html += '<label style="font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:4px">Motivo (opcional)</label>';
    html += '<input type="text" id="att-jreason" placeholder="Ej: Cita médica" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text)" />';
    html += '</div>';
    html += '<div style="margin-bottom:16px">';
    html += '<label style="font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:4px">Justificante <span style="color:#dc2626">*</span></label>';
    html += '<input type="file" id="att-jfile" accept="image/*,application/pdf" onchange="AttendanceView._onJustifiedFileChange()" ';
    html += 'style="width:100%;box-sizing:border-box;padding:8px;border:1px dashed var(--border);border-radius:8px;font-size:13px;cursor:pointer;background:var(--surface);color:var(--text)" />';
    html += '<div id="att-jpreview" style="margin-top:8px"></div>';
    html += '</div>';
    html += '<button id="att-jsubmit" onclick="AttendanceView._submitJustified()" disabled ';
    html += 'style="width:100%;padding:10px;border-radius:8px;border:none;background:#cbd5e1;color:#fff;cursor:default;font-weight:600;font-size:14px">Enviar solicitud</button>';
    html += '</div></div>';

    overlay.innerHTML = html;
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  },

  _onJustifiedFileChange: function() {
    var input = document.getElementById('att-jfile');
    var btn   = document.getElementById('att-jsubmit');
    var prev  = document.getElementById('att-jpreview');
    if (!input || !input.files || !input.files[0]) return;
    var file = input.files[0];
    if (btn) { btn.disabled = false; btn.style.background = '#7c3aed'; btn.style.cursor = 'pointer'; }
    if (prev && file.type.startsWith('image/')) {
      var reader = new FileReader();
      reader.onload = function(ev) {
        prev.innerHTML = '<img src="' + ev.target.result + '" style="max-width:100%;border-radius:6px;border:1px solid var(--border)" />';
      };
      reader.readAsDataURL(file);
    } else if (prev) {
      prev.innerHTML = '<div style="padding:8px;background:var(--surface);border-radius:6px;font-size:12px;color:var(--muted)">' + file.name + '</div>';
    }
  },

  _submitJustified: function() {
    var reasonEl = document.getElementById('att-jreason');
    var fileEl   = document.getElementById('att-jfile');
    var btn      = document.getElementById('att-jsubmit');
    if (!fileEl || !fileEl.files || !fileEl.files[0]) { APP.toast('Debes subir un justificante', 'error'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Subiendo…'; }
    var reason = reasonEl ? reasonEl.value.trim() : '';
    var file   = fileEl.files[0];
    var fd = new FormData();
    fd.append('file', file, file.name);
    var doJUpload = function(token) {
      var headers = token ? { 'Authorization': 'Bearer ' + token } : {};
      fetch('/api/upload-evidence', { method: 'POST', body: fd, headers: headers })
        .then(function(r) { return r.json(); })
        .then(function(j) {
          if (!j.url) { APP.toast('Error al subir: ' + (j.error || 'desconocido'), 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Enviar solicitud'; } return; }
          APP.api('remote.request', { type: 'falta_justificada', reason: reason, documentUrl: j.url }, function(err) {
            if (err) { APP.toast(err, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Enviar solicitud'; } return; }
            APP.toast('Solicitud enviada a RH ✓', 'success');
            var m = document.getElementById('att-jmodal');
            if (m) m.remove();
            AttendanceView._loadEmployee();
          });
        })
        .catch(function(e) { APP.toast('Error: ' + e.message, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Enviar solicitud'; } });
    };
    if (_sb) {
      _sb.auth.getSession().then(function(res) { doJUpload(res.data.session ? res.data.session.access_token : null); });
    } else { doJUpload(null); }
  },

  // ─────────────────────────────────────────────────────────────

  // ── APPEAL MODAL ─────────────────────────────────────────────
  _openAppealModal: function(dateStr) {
    var existing = document.getElementById('att-appeal-modal');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'att-appeal-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9100;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';

    var html = '<div style="background:var(--card);border-radius:16px;max-width:400px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:24px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<div><div style="font-weight:700;font-size:15px">Apelar tardanza</div>';
    html += '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + dateStr + '</div></div>';
    html += '<button onclick="document.getElementById(\'att-appeal-modal\').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:22px;line-height:1">×</button>';
    html += '</div>';
    html += '<p style="font-size:13px;color:var(--muted);margin:0 0 12px">Explica por qué llegaste tarde. Tu manager revisará la solicitud.</p>';
    html += '<textarea id="appeal-reason" placeholder="Escribe tu justificación..." style="width:100%;min-height:90px;border-radius:8px;border:1px solid var(--border);padding:10px;font-size:13px;resize:vertical;box-sizing:border-box;background:var(--surface);color:var(--fg)" oninput="var b=document.getElementById(\'appeal-submit\');if(b)b.disabled=!this.value.trim()"></textarea>';
    html += '<div class="form-group" style="margin-top:10px"><label style="font-size:12px;color:var(--muted)">Documento de soporte (opcional)</label>';
    html += '<input type="file" id="appeal-file" accept=".pdf,.jpg,.jpeg,.png" style="font-size:12px"></div>';
    html += '<button id="appeal-submit" disabled onclick="AttendanceView._submitAppeal(\'' + dateStr + '\')" ';
    html += 'style="width:100%;margin-top:14px;padding:11px;border-radius:8px;border:none;background:#d97706;color:#fff;cursor:pointer;font-weight:700;font-size:14px;opacity:1" ';
    html += 'onmouseover="if(!this.disabled)this.style.background=\'#b45309\'" onmouseout="this.style.background=\'#d97706\'">Enviar apelación</button>';
    html += '</div>';

    overlay.innerHTML = html;
    document.body.appendChild(overlay);
  },

  _submitAppeal: function(dateStr) {
    var reasonEl = document.getElementById('appeal-reason');
    var fileEl   = document.getElementById('appeal-file');
    var btn      = document.getElementById('appeal-submit');
    var reason   = reasonEl ? reasonEl.value.trim() : '';
    if (!reason) { APP.toast('Escribe una justificación', 'error'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

    var doSubmit = function(docUrl) {
      APP.api('appeal.request', { date: dateStr, reason: reason, documentUrl: docUrl || null }, function(err) {
        if (err) {
          APP.toast(err, 'error');
          if (btn) { btn.disabled = false; btn.textContent = 'Enviar apelación'; }
          return;
        }
        var modal = document.getElementById('att-appeal-modal');
        if (modal) modal.remove();
        APP.toast('✅ Apelación enviada — tu manager la revisará', 'success');
        if (AttendanceView._empMonthData) {
          AttendanceView._loadEmployeeMonth(AttendanceView._empMonthData.year, AttendanceView._empMonthData.month);
        }
      });
    };

    var file = fileEl && fileEl.files && fileEl.files[0];
    if (file) {
      var fd = new FormData();
      fd.append('file', file, 'appeal-' + dateStr + '-' + Date.now() + '.' + (file.name.split('.').pop() || 'pdf'));
      var doUpload = function(token) {
        var headers = token ? { 'Authorization': 'Bearer ' + token } : {};
        fetch('/api/upload-evidence', { method: 'POST', body: fd, headers: headers })
          .then(function(r) { return r.json(); })
          .then(function(j) {
            if (j.error) { APP.toast('Error subiendo documento: ' + j.error, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Enviar apelación'; } return; }
            doSubmit(j.url);
          })
          .catch(function(e) { APP.toast('Error subiendo documento', 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Enviar apelación'; } });
      };
      if (typeof _sb !== 'undefined' && _sb) {
        _sb.auth.getSession().then(function(res) { doUpload(res && res.data && res.data.session ? res.data.session.access_token : null); });
      } else { doUpload(null); }
    } else {
      doSubmit(null);
    }
  },

  // ── APPEAL MANAGER REVIEW ────────────────────────────────────
  _checkManagerAppeals: function() {
    if (!APP.user || (!APP.user.isAdmin && !APP.user.isHR && !APP.user.isManager)) return;
    APP.api('appeal.getPending', {}, function(err, data) {
      if (err || !data || !data.items || data.items.length === 0) return;
      AttendanceView._renderAppealsPopup(data.items);
    });
  },

  _renderAppealsPopup: function(items) {
    var existing = document.getElementById('att-appeals-popup');
    if (existing) existing.remove();

    var popup = document.createElement('div');
    popup.id = 'att-appeals-popup';
    popup.style.cssText = 'position:fixed;bottom:24px;right:24px;width:320px;background:var(--card);border:1px solid var(--border);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.18);z-index:8900;overflow:hidden';

    var html = '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border)">';
    html += '<div style="font-weight:700;font-size:14px">⚠ Apelaciones de tardanza <span style="background:#d97706;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px">' + items.length + '</span></div>';
    html += '<button onclick="document.getElementById(\'att-appeals-popup\').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:20px;line-height:1">×</button>';
    html += '</div>';
    html += '<div style="max-height:340px;overflow-y:auto">';

    items.forEach(function(item) {
      html += '<div id="appeal-item-' + item.id + '" style="padding:14px 16px;border-bottom:1px solid var(--border)">';
      html += '<div style="font-weight:600;font-size:13px">' + item.employeeName + '</div>';
      html += '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">' + item.date + (item.department ? ' · ' + item.department : '') + '</div>';
      html += '<div style="font-size:12px;color:var(--fg);margin-bottom:10px;line-height:1.4">' + (item.reason || '') + '</div>';
      if (item.documentUrl) {
        html += '<a href="' + item.documentUrl + '" target="_blank" style="font-size:11px;color:#2563eb;display:block;margin-bottom:8px">📎 Ver documento</a>';
      }
      html += '<div style="display:flex;gap:8px">';
      html += '<button onclick="AttendanceView._reviewAppeal(\'' + item.id + '\',\'approve\')" style="flex:1;padding:6px;border-radius:6px;border:none;background:#16a34a;color:#fff;cursor:pointer;font-size:12px;font-weight:600">✓ Aprobar</button>';
      html += '<button onclick="AttendanceView._reviewAppeal(\'' + item.id + '\',\'deny\')" style="flex:1;padding:6px;border-radius:6px;border:none;background:#dc2626;color:#fff;cursor:pointer;font-size:12px;font-weight:600">✗ Denegar</button>';
      html += '</div></div>';
    });

    html += '</div>';
    popup.innerHTML = html;
    document.body.appendChild(popup);
  },

  _reviewAppeal: function(id, action) {
    var itemEl = document.getElementById('appeal-item-' + id);
    if (itemEl) itemEl.style.opacity = '0.5';
    APP.api('appeal.review', { id: id, action: action }, function(err) {
      if (err) { APP.toast(err, 'error'); if (itemEl) itemEl.style.opacity = '1'; return; }
      if (itemEl) itemEl.remove();
      APP.toast(action === 'approve' ? '✅ Apelación aprobada' : '✅ Apelación denegada', 'success');
      var popup = document.getElementById('att-appeals-popup');
      if (popup && !popup.querySelector('[id^="appeal-item-"]')) popup.remove();
    });
  },

  _loadTardinessBanner: function() {
    var el = document.getElementById('att-tardiness-banner');
    if (!el) return;
    APP.api('tardiness.getStatus', {}, function(err, d) {
      var bannerEl = document.getElementById('att-tardiness-banner');
      if (!bannerEl || err || !d) return;
      var count = d.count || 0;
      if (count === 0) return;
      bannerEl.innerHTML =
        '<div style="background:' + d.bg + ';color:' + d.fg + ';border-radius:8px;padding:10px 14px;font-size:13px;display:flex;align-items:center;gap:10px">' +
        '<strong style="font-size:22px;line-height:1;min-width:24px;text-align:center">' + count + '</strong>' +
        '<div>' +
        '<div style="font-weight:700;font-size:13px">Retardo' + (count !== 1 ? 's' : '') + ' en los últimos 6 meses (desde oct 2026)</div>' +
        '<div style="opacity:.85;font-size:12px;margin-top:2px">' + d.label + '</div>' +
        '</div></div>';
    });
  },

  _loadTardinessReport: function() {
    var el = document.getElementById('att-content'); if (!el) return;
    el.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    APP.api('tardiness.getAllStatus', {}, function(err, data) {
      if (err) { el.innerHTML = '<div class="empty-state"><p>' + err + '</p></div>'; return; }
      el.innerHTML = AttendanceView._renderTardinessReport(data);
    });
  },

  _renderTardinessReport: function(data) {
    var items = data.items || [];
    var windowStart = data.windowStart || '2026-10-01';
    var html = '';

    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap">';
    html += '<button onclick="AttendanceView._loadAdmin(AttendanceView._todayCdmx())" ';
    html += 'style="padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;font-size:13px">← Hoy</button>';
    html += '<h3 style="margin:0;font-size:16px;font-weight:700">Reporte de Retardos</h3>';
    html += '<span style="font-size:12px;color:var(--muted)">Ventana: ' + windowStart + ' → hoy (6 meses)</span>';
    html += '</div>';

    // Tier legend
    var TIERS = [
      { min: 17, label: 'Rescisión de la relación laboral',              bg: '#450a0a', fg: '#fca5a5' },
      { min: 16, label: 'Suspensión 3 días sin goce',                    bg: '#7f1d1d', fg: '#fecaca' },
      { min: 15, label: 'Suspensión hasta 3 días + instrucción formal',  bg: '#991b1b', fg: '#fecaca' },
      { min: 12, label: 'Descuento 1 día + exhorto por escrito',         bg: '#dc2626', fg: '#fff' },
      { min:  9, label: 'Descuento 3 días + llamada de atención',        bg: '#ea580c', fg: '#fff' },
      { min:  6, label: 'Descuento 2 días de salario',                   bg: '#f97316', fg: '#fff' },
      { min:  3, label: 'Descuento 1 día de salario',                    bg: '#f59e0b', fg: '#fff' }
    ];
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">';
    TIERS.forEach(function(t) {
      html += '<span style="padding:3px 9px;border-radius:12px;font-size:11px;font-weight:600;background:' + t.bg + ';color:' + t.fg + '">' + t.min + '+ retardos: ' + t.label + '</span>';
    });
    html += '</div>';

    if (items.length === 0) {
      html += '<div class="empty-state"><p>No hay empleados con seguimiento de retardos.</p></div>';
      return html;
    }

    // Summary counts
    var sinCons = items.filter(function(i) { return i.severity === 'ok'; }).length;
    var conCons  = items.length - sinCons;
    html += '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">';
    html += AttendanceView._pill(items.length + ' empleados', '#475569');
    if (conCons > 0) html += AttendanceView._pill(conCons + ' con consecuencia', '#dc2626');
    html += AttendanceView._pill(sinCons + ' sin consecuencia', '#16a34a');
    html += '</div>';

    html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">';
    html += '<thead><tr style="border-bottom:2px solid var(--border)">';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted);text-align:left">Empleado</th>';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted);text-align:left">Depto.</th>';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted);text-align:center">Retardos</th>';
    html += '<th style="padding:8px 10px;font-weight:600;color:var(--muted);text-align:left">Consecuencia</th>';
    html += '</tr></thead><tbody>';

    items.forEach(function(item) {
      html += '<tr style="border-bottom:1px solid var(--border)">';
      html += '<td style="padding:8px 10px;font-weight:500">' + item.name + '</td>';
      html += '<td style="padding:8px 10px;color:var(--muted)">' + (item.department || '—') + '</td>';
      html += '<td style="padding:8px 10px;text-align:center;font-variant-numeric:tabular-nums;font-weight:700;color:' + (item.count > 0 ? item.fg : 'var(--muted)') + '">';
      if (item.count > 0) {
        html += '<span style="display:inline-block;min-width:28px;padding:2px 8px;border-radius:12px;background:' + item.bg + ';color:' + item.fg + '">' + item.count + '</span>';
      } else {
        html += '0';
      }
      html += '</td>';
      if (item.severity === 'ok') {
        html += '<td style="padding:8px 10px;color:#16a34a;font-size:12px">Sin consecuencias</td>';
      } else {
        html += '<td style="padding:8px 10px"><span style="padding:2px 8px;border-radius:4px;background:' + item.bg + ';color:' + item.fg + ';font-size:11px;font-weight:600">' + item.label + '</span></td>';
      }
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  },

  _badge: function(status) {
    var map = {
      a_tiempo:              ['#ecfdf5', '#16a34a', 'A tiempo'],
      retardo:               ['#fffbeb', '#d97706', 'Retardo'],
      retardo_apelado:       ['#fefce8', '#16a34a', 'Retardo apelado ✓'],
      ausente:               ['#fef2f2', '#dc2626', 'Ausente'],
      vacaciones:            ['#e0f2fe', '#0284c7', 'Vacaciones'],
      remoto:                ['#eff6ff', '#2563eb', 'Remoto'],
      justificada:           ['#f5f3ff', '#7c3aed', 'Justificada'],
      pendiente_remoto:      ['#fff7ed', '#ea580c', 'Pendiente (remoto)'],
      pendiente_justificada: ['#fdf4ff', '#c026d3', 'Pendiente (just.)'],
      pendiente:             ['#f8fafc', '#64748b', 'Pendiente']
    };
    var s = map[status] || ['#f8fafc', '#64748b', status];
    return '<span style="padding:2px 8px;border-radius:4px;background:' + s[0] + ';color:' + s[1] + ';font-size:12px;font-weight:600">' + s[2] + '</span>';
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


// ── INIT ──────────────────────────────────────────────────────
// scripts.js loads with strategy="afterInteractive" — DOM is already
// ready, so we call APP.init() directly instead of waiting for 'load'.
APP.init();
