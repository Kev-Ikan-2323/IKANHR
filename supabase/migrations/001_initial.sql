-- ============================================================
-- 001_initial.sql — HR Platform full schema
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── ROLES ────────────────────────────────────────────────────
CREATE TABLE roles (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]',
  description TEXT DEFAULT '',
  level       INT DEFAULT 3,
  department  TEXT DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── EMPLOYEES ─────────────────────────────────────────────────
CREATE TABLE employees (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  employee_number       TEXT DEFAULT '',
  first_name            TEXT NOT NULL,
  last_name             TEXT NOT NULL,
  email                 TEXT NOT NULL UNIQUE,
  photo_url             TEXT DEFAULT '',
  phone                 TEXT DEFAULT '',
  birth_date            DATE,
  hire_date             DATE,
  emergency_contact     TEXT DEFAULT '',
  emergency_phone       TEXT DEFAULT '',
  role_id               TEXT REFERENCES roles(id),
  team_id               TEXT DEFAULT '',
  manager_id            TEXT DEFAULT '',
  department            TEXT DEFAULT '',
  job_title             TEXT DEFAULT '',
  contract_type         TEXT DEFAULT 'Planta',
  status                TEXT NOT NULL DEFAULT 'activo',
  notes                 TEXT DEFAULT '',
  address               TEXT DEFAULT '',
  bank_account          TEXT DEFAULT '',
  curp                  TEXT DEFAULT '',
  rfc                   TEXT DEFAULT '',
  personal_email        TEXT DEFAULT '',
  can_approve_vacations BOOLEAN NOT NULL DEFAULT TRUE,
  vacation_days_per_year INT DEFAULT 12,
  termination_date      DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TEAMS ─────────────────────────────────────────────────────
CREATE TABLE teams (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  department  TEXT DEFAULT '',
  leader_id   TEXT DEFAULT '',
  co_leader_id TEXT DEFAULT '',
  status      TEXT DEFAULT 'activo',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── ORG CHART ─────────────────────────────────────────────────
CREATE TABLE org_chart (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  employee_id        TEXT NOT NULL,
  parent_employee_id TEXT DEFAULT '',
  team_id            TEXT DEFAULT '',
  level              INT DEFAULT 0,
  effective_date     DATE,
  end_date           DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── KPI DEFINITIONS ───────────────────────────────────────────
CREATE TABLE kpi_definitions (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name         TEXT NOT NULL,
  description  TEXT DEFAULT '',
  category     TEXT DEFAULT '',
  type         TEXT NOT NULL,
  period_type  TEXT NOT NULL,
  weight       NUMERIC(5,2) DEFAULT 0,
  target       TEXT DEFAULT '',
  min_value    NUMERIC(10,2) DEFAULT 0,
  max_value    NUMERIC(10,2) DEFAULT 10,
  role_id      TEXT DEFAULT '',
  instructions TEXT DEFAULT '',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  active_months TEXT DEFAULT 'all',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── KPI PERIODS ───────────────────────────────────────────────
CREATE TABLE kpi_periods (
  id                        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name                      TEXT NOT NULL,
  period_type               TEXT NOT NULL,
  role_id                   TEXT DEFAULT '',
  start_date                DATE NOT NULL,
  end_date                  DATE NOT NULL,
  self_assessment_deadline  DATE,
  manager_review_deadline   DATE,
  status                    TEXT NOT NULL DEFAULT 'borrador',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── KPI REVIEWS ───────────────────────────────────────────────
CREATE TABLE kpi_reviews (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  period_id          TEXT NOT NULL,
  kpi_definition_id  TEXT NOT NULL,
  employee_id        TEXT NOT NULL,
  manager_id         TEXT DEFAULT '',
  self_score         NUMERIC(10,2),
  self_comments      TEXT DEFAULT '',
  self_submitted_at  TIMESTAMPTZ,
  manager_score      NUMERIC(10,2),
  manager_comments   TEXT DEFAULT '',
  manager_reviewed_at TIMESTAMPTZ,
  final_score        NUMERIC(10,2),
  status             TEXT NOT NULL DEFAULT 'Borrador',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── KPI SCHEDULES ─────────────────────────────────────────────
CREATE TABLE kpi_schedules (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name                 TEXT NOT NULL,
  role_id              TEXT DEFAULT '',
  department           TEXT DEFAULT '',
  period_type          TEXT DEFAULT 'Mensual',
  day_of_month         INT DEFAULT 1,
  self_assessment_days INT DEFAULT 25,
  manager_review_days  INT DEFAULT 30,
  kpi_definition_ids   JSONB DEFAULT '[]',
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  last_activated_at    TIMESTAMPTZ,
  created_by           TEXT DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── VACATION BALANCE ──────────────────────────────────────────
CREATE TABLE vacation_balance (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  employee_id    TEXT NOT NULL,
  year           INT NOT NULL,
  days_entitled  INT DEFAULT 12,
  days_used      INT DEFAULT 0,
  days_pending   INT DEFAULT 0,
  days_remaining INT DEFAULT 12,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, year)
);

-- ── VACATION REQUESTS ─────────────────────────────────────────
CREATE TABLE vacation_requests (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  employee_id          TEXT NOT NULL,
  manager_id           TEXT DEFAULT '',
  start_date           DATE NOT NULL,
  end_date             DATE NOT NULL,
  total_days           INT DEFAULT 0,
  working_days         INT DEFAULT 0,
  reason               TEXT DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'Pendiente',
  approver_manager_id  TEXT DEFAULT '',
  approver_notes       TEXT DEFAULT '',
  requested_at         TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── HOLIDAYS ─────────────────────────────────────────────────
CREATE TABLE holidays (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  date         DATE NOT NULL,
  name         TEXT NOT NULL,
  type         TEXT DEFAULT '',
  year         INT,
  is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  status       TEXT DEFAULT 'activo',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── ANNOUNCEMENTS ─────────────────────────────────────────────
CREATE TABLE announcements (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title           TEXT NOT NULL,
  body            TEXT DEFAULT '',
  author_id       TEXT DEFAULT '',
  target_audience TEXT NOT NULL DEFAULT 'all',
  pinned          BOOLEAN NOT NULL DEFAULT FALSE,
  status          TEXT NOT NULL DEFAULT 'publicado',
  published_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CONFIG ───────────────────────────────────────────────────
CREATE TABLE config (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key         TEXT NOT NULL UNIQUE,
  value       TEXT DEFAULT '',
  description TEXT DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AUDIT LOG ────────────────────────────────────────────────
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  timestamp  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action     TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id  TEXT,
  user_email TEXT DEFAULT '',
  data       JSONB
);

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
ALTER TABLE roles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees         ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams             ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_chart         ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_definitions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_periods       ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_reviews       ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_schedules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacation_balance  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays          ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE config            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log         ENABLE ROW LEVEL SECURITY;

-- Permissive policies for authenticated role (app layer handles authz)
CREATE POLICY "authenticated_all" ON roles             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON employees         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON teams             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON org_chart         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON kpi_definitions   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON kpi_periods       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON kpi_reviews       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON kpi_schedules     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON vacation_balance  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON vacation_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON holidays          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON announcements     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON config            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON audit_log         FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Service role (used by server-side code) bypasses RLS by default
-- No policy needed for service_role — it ignores RLS.

-- ── DEFAULT CONFIG VALUES ─────────────────────────────────────
INSERT INTO config (key, value, description) VALUES
  ('vacation_request_days', '3', 'Días mínimos de anticipación para solicitar vacaciones'),
  ('company_name', 'HR Platform', 'Nombre de la empresa'),
  ('timezone', 'America/Mexico_City', 'Zona horaria de la empresa');
