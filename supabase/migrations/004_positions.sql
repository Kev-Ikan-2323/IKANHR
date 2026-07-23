-- ============================================================
-- 004_positions.sql
-- Job positions table — KPI assignment by position instead of role
-- ============================================================

CREATE TABLE IF NOT EXISTS positions (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL,
  department  TEXT DEFAULT '',
  description TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'activo',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON positions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Add position_id to employees (alongside existing role_id which controls permissions)
ALTER TABLE employees        ADD COLUMN IF NOT EXISTS position_id TEXT REFERENCES positions(id);

-- Replace role_id usage in KPI definitions with position_id
ALTER TABLE kpi_definitions  ADD COLUMN IF NOT EXISTS position_id TEXT REFERENCES positions(id);

-- Replace role_id usage in KPI schedules and periods
ALTER TABLE kpi_schedules    ADD COLUMN IF NOT EXISTS position_id TEXT REFERENCES positions(id);
ALTER TABLE kpi_periods      ADD COLUMN IF NOT EXISTS position_id TEXT REFERENCES positions(id);
