import Head from 'next/head'
import Script from 'next/script'

// The sidebar + main HTML shell (mirrors the GAS pages/index.html structure).
// Inline onclick handlers work because scripts.js is loaded as a static file
// and the browser processes them natively.
var SHELL = `
<aside id="sidebar">
  <div class="sidebar-logo" style="padding:14px 16px;display:flex;align-items:center;gap:8px">
    <div style="width:32px;height:32px;background:var(--primary);border-radius:8px;display:flex;align-items:center;justify-content:center">
      <span style="color:#fff;font-weight:800;font-size:14px">IK</span>
    </div>
    <span class="sidebar-logo-text">IKAN<span style="color:var(--primary)">HR</span></span>
  </div>

  <div class="sidebar-user">
    <div class="sidebar-avatar" id="sidebar-initials">?</div>
    <div class="sidebar-user-info">
      <div class="name" id="sidebar-name">Cargando...</div>
      <div class="role" id="sidebar-role"></div>
    </div>
  </div>

  <nav>
    <div class="nav-section">
      <div class="nav-label">Principal</div>
      <div class="nav-item active" data-view="dashboard" onclick="APP.navigate('dashboard')">
        <span class="material-icons-round">dashboard</span><span>Mi Dashboard</span>
      </div>
      <div class="nav-item" data-view="employees" onclick="APP.navigate('employees')">
        <span class="material-icons-round">people</span><span>Directorio</span>
      </div>
      <div class="nav-item" data-view="orgchart" onclick="APP.navigate('orgchart')">
        <span class="material-icons-round">account_tree</span><span>Organigrama</span>
      </div>
    </div>

    <div class="nav-section">
      <div class="nav-label">Mi Trabajo</div>
      <div class="nav-item" data-view="kpis" onclick="APP.navigate('kpis')">
        <span class="material-icons-round">analytics</span><span>KPIs</span>
        <span class="nav-badge" id="nav-kpi-badge" style="display:none"></span>
      </div>
      <div class="nav-item" data-view="vacations" onclick="APP.navigate('vacations')">
        <span class="material-icons-round">beach_access</span><span>Vacaciones</span>
      </div>
      <div class="nav-item" data-view="birthdays" onclick="APP.navigate('birthdays')">
        <span class="material-icons-round">cake</span><span>Cumpleaños</span>
      </div>
    </div>

    <div class="nav-section">
      <div class="nav-label">Mi Equipo</div>
      <div class="nav-item" data-view="team" onclick="APP.navigate('team')">
        <span class="material-icons-round">group</span><span>Mi Equipo</span>
      </div>
    </div>

    <div id="approver-section" style="display:none">
      <div class="nav-section">
        <div class="nav-label">Aprobaciones</div>
        <div class="nav-item" onclick="APP.navigate('vacations');setTimeout(function(){VacationsView.loadTeamRequests()},600)">
          <span class="material-icons-round">event_available</span><span>Aprobaciones</span>
        </div>
      </div>
    </div>

    <div id="admin-section" style="display:none">
      <div class="nav-section">
        <div class="nav-label">Administración</div>
        <div class="nav-item" onclick="AdminHR.openNewEmployee()">
          <span class="material-icons-round">person_add</span><span>Agregar Empleado</span>
        </div>
        <div class="nav-item" onclick="APP.navigate('employees')">
          <span class="material-icons-round">manage_accounts</span><span>Directorio (Admin)</span>
        </div>
        <div class="nav-item" onclick="AdminHR.openKPIAdmin()">
          <span class="material-icons-round">tune</span><span>Configurar KPIs</span>
        </div>
        <div class="nav-item" onclick="AdminHR.openRolesAdmin()">
          <span class="material-icons-round">badge</span><span>Configurar Roles</span>
        </div>
        <div class="nav-item" onclick="AdminHR.openPositionsAdmin()">
          <span class="material-icons-round">work</span><span>Configurar Puestos</span>
        </div>
        <div class="nav-item" onclick="AdminHR.openAnnouncementsAdmin()">
          <span class="material-icons-round">campaign</span><span>Comunicados</span>
        </div>
        <div class="nav-item" onclick="APP.navigate('vacations');setTimeout(function(){VacationsView.loadTeamRequests()},600)">
          <span class="material-icons-round">event_available</span><span>Aprobaciones</span>
        </div>
      </div>
    </div>
  </nav>

  <div style="padding:12px 16px;border-top:1px solid #334155">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <span style="color:#475569;font-size:11px">IKAN HR · v2.0</span>
      <button onclick="window._sb&&window._sb.auth.signOut().then(function(){window.location.reload()})" style="background:none;border:none;cursor:pointer;color:#475569;font-size:11px;padding:2px 4px">
        Salir
      </button>
    </div>
  </div>
</aside>

<div id="main">
  <header>
    <button class="icon-btn" onclick="(function(){var s=document.getElementById('sidebar');s.style.display=s.style.display==='none'?'flex':'none'})()">
      <span class="material-icons-round">menu</span>
    </button>
    <div class="header-title" id="header-title">HR Platform</div>
    <div class="header-actions">
      <div class="header-search">
        <span class="material-icons-round">search</span>
        <input placeholder="Buscar empleado..." id="global-search">
      </div>
      <button class="icon-btn" title="Notificaciones" style="position:relative">
        <span class="material-icons-round">notifications</span>
        <span id="notif-dot" style="display:none" class="notif-dot"></span>
      </button>
    </div>
  </header>

  <div id="content">

    <!-- DASHBOARD -->
    <div id="view-dashboard" class="view active">
      <div class="view-title"><span class="material-icons-round">dashboard</span>Mi Dashboard</div>
      <div id="dash-alerts" class="mb-20"></div>
      <div class="grid grid-4 mb-20">
        <div class="card stat-card" onclick="APP.navigate('vacations')" style="cursor:pointer">
          <div class="stat-icon blue"><span class="material-icons-round">beach_access</span></div>
          <div><div class="stat-value" id="dash-vac-days">—</div><div class="stat-label">Días de vacaciones</div></div>
        </div>
        <div class="card stat-card" onclick="APP.navigate('kpis')" style="cursor:pointer">
          <div class="stat-icon green"><span class="material-icons-round">analytics</span></div>
          <div><div class="stat-value" id="dash-kpi-score">—</div><div class="stat-label">Score KPI <span id="dash-kpi-label" style="font-size:11px;display:block;color:var(--text-muted)"></span></div></div>
        </div>
        <div class="card stat-card" onclick="APP.navigate('kpis')" style="cursor:pointer">
          <div class="stat-icon orange"><span class="material-icons-round">pending_actions</span></div>
          <div><div class="stat-value" id="dash-pending-kpi">0</div><div class="stat-label">KPIs pendientes</div></div>
        </div>
        <div class="card stat-card" onclick="APP.navigate('vacations')" style="cursor:pointer">
          <div class="stat-icon red"><span class="material-icons-round">hourglass_empty</span></div>
          <div><div class="stat-value" id="dash-pending-vac">0</div><div class="stat-label">Solicitudes pendientes</div></div>
        </div>
      </div>
      <div class="grid grid-2 gap-16">
        <div class="card">
          <div class="card-title"><span class="material-icons-round" style="margin-right:6px">assignment</span>Mis KPIs Pendientes</div>
          <div id="dash-pending-list"><div class="loader"><div class="spinner"></div></div></div>
        </div>
        <div class="card">
          <div class="card-title"><span class="material-icons-round" style="margin-right:6px">cake</span>Próximos Cumpleaños</div>
          <div id="dash-birthdays"><div class="loader"><div class="spinner"></div></div></div>
        </div>
        <div class="card">
          <div class="card-title"><span class="material-icons-round" style="margin-right:6px">campaign</span>Comunicados</div>
          <div id="dash-announcements"><div class="loader"><div class="spinner"></div></div></div>
        </div>
        <div class="card">
          <div class="card-title"><span class="material-icons-round" style="margin-right:6px">bolt</span>Accesos Rápidos</div>
          <div class="grid grid-2 gap-8 mt-8">
            <button class="btn btn-outline" onclick="VacationsView.openRequest()"><span class="material-icons-round">add</span>Solicitar vacaciones</button>
            <button class="btn btn-outline" onclick="APP.navigate('kpis')"><span class="material-icons-round">analytics</span>Ver mis KPIs</button>
            <button class="btn btn-outline" onclick="APP.navigate('employees')"><span class="material-icons-round">people</span>Directorio</button>
            <button class="btn btn-outline" onclick="APP.navigate('birthdays')"><span class="material-icons-round">cake</span>Cumpleaños</button>
          </div>
        </div>
      </div>
    </div>

    <!-- EMPLOYEES -->
    <div id="view-employees" class="view">
      <div class="loader"><div class="spinner"></div></div>
    </div>

    <!-- ORG CHART -->
    <div id="view-orgchart" class="view">
      <div class="loader"><div class="spinner"></div></div>
    </div>

    <!-- KPIs -->
    <div id="view-kpis" class="view">
      <div class="view-title"><span class="material-icons-round">analytics</span>KPIs &amp; Evaluaciones</div>
      <div id="kpi-content"></div>
    </div>

    <!-- VACATIONS -->
    <div id="view-vacations" class="view">
      <div class="view-title"><span class="material-icons-round">beach_access</span>Vacaciones</div>
      <div id="vac-content"></div>
    </div>

    <!-- BIRTHDAYS -->
    <div id="view-birthdays" class="view">
      <div class="view-title"><span class="material-icons-round">cake</span>Calendario de Cumpleaños</div>
      <div id="bday-content"></div>
    </div>

    <!-- TEAM -->
    <div id="view-team" class="view">
      <div class="view-title"><span class="material-icons-round">group</span>Mi Equipo</div>
      <div id="team-content"></div>
    </div>

  </div>
</div>
`

export default function Home() {
  return (
    <>
      <Head>
        <title>IKAN HR Platform</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta charSet="UTF-8" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/icon?family=Material+Icons+Round"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/styles.css" />
      </Head>

      {/* Full-screen loader (shown while APP.init() runs) */}
      <div
        id="app-loader"
        style={{
          display: 'flex',
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'var(--bg)',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
        }}
      >
        <div
          className="spinner"
          style={{ width: '48px', height: '48px', borderWidth: '4px' }}
        ></div>
        <div
          id="loader-msg"
          style={{ color: 'var(--text-muted)', fontSize: '14px' }}
        >
          Cargando...
        </div>
      </div>

      {/* Toast container */}
      <div id="toast-container"></div>

      {/* App shell — sidebar + main + all views */}
      <div
        id="app-shell"
        dangerouslySetInnerHTML={{ __html: SHELL }}
        suppressHydrationWarning
      />

      {/* Expose public Supabase config for scripts.js */}
      <script dangerouslySetInnerHTML={{ __html:
        `window.__SB_URL__='${process.env.NEXT_PUBLIC_SUPABASE_URL}';window.__SB_KEY__='${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}';`
      }} />
      {/* Supabase browser SDK — handles PKCE OAuth automatically */}
      <Script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js" strategy="beforeInteractive" />
      {/* Client-side app logic; loads after page is interactive */}
      <Script src="/scripts.js" strategy="afterInteractive" />
    </>
  )
}
