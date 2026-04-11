-- Ambit.IQ Phase 2 — PostgreSQL persistence for OPA-style decision logs (Neon / Postgres 14+)
-- Apply with: psql "$DATABASE_URL" -f migrations/001_ambit_decision_logs.sql

CREATE TABLE IF NOT EXISTS ambit_decision_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id UUID NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id TEXT NOT NULL,
  intent_prompt TEXT NOT NULL,
  proposed_code TEXT NOT NULL,
  decision BOOLEAN NOT NULL,
  violations JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_opa_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ambit_decision_logs_timestamp
  ON ambit_decision_logs (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_ambit_decision_logs_actor
  ON ambit_decision_logs (actor_id);

CREATE INDEX IF NOT EXISTS idx_ambit_decision_logs_failures
  ON ambit_decision_logs (timestamp DESC)
  WHERE decision = false;
