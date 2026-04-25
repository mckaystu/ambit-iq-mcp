-- Ambit.IQ — Live Policy Editor columns for rules_library (Neon / Postgres 14+)
-- Apply with: psql "$DATABASE_URL" -f migrations/003_rules_library_policy_editor.sql

ALTER TABLE rules_library
  ADD COLUMN IF NOT EXISTS original_intent TEXT;

ALTER TABLE rules_library
  ADD COLUMN IF NOT EXISTS rego_code TEXT;

ALTER TABLE rules_library
  ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMPTZ;

ALTER TABLE rules_library
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

UPDATE rules_library SET status = 'active' WHERE trim(status) = '';

ALTER TABLE rules_library
  DROP CONSTRAINT IF EXISTS rules_library_status_check;

ALTER TABLE rules_library
  ADD CONSTRAINT rules_library_status_check
  CHECK (lower(trim(status)) IN ('active', 'shadow', 'draft'));

COMMENT ON COLUMN rules_library.original_intent IS 'Plain-English policy intent from Live Policy Editor';
COMMENT ON COLUMN rules_library.rego_code IS 'OPA Rego draft (shadow / future enforcement)';
COMMENT ON COLUMN rules_library.status IS 'active = enforce; shadow = virtual violations only; draft = not loaded into MCP cache';
COMMENT ON COLUMN rules_library.last_tested_at IS 'Last shadow impact simulation run';
