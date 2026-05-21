-- Ambit.IQ Phase 1 — governance foundation tables (additive, safe)
-- Apply with: psql "$DATABASE_URL" -f migrations/004_phase1_governance_foundation.sql

CREATE TABLE IF NOT EXISTS agent_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id UUID NOT NULL,
  decision_log_id UUID NULL REFERENCES ambit_decision_logs(id) ON DELETE SET NULL,
  session_id TEXT NULL,
  actor_id TEXT NULL,
  team_id TEXT NULL,
  agent_name TEXT NOT NULL,
  agent_version TEXT NULL,
  workspace_id TEXT NULL,
  repo TEXT NULL,
  branch TEXT NULL,
  commit_sha TEXT NULL,
  pr_number TEXT NULL,
  prompt_captured BOOLEAN NOT NULL DEFAULT false,
  prompt_redacted TEXT NULL,
  prompt_hash TEXT NULL,
  prompt_char_count INTEGER NULL,
  prompt_truncated BOOLEAN NOT NULL DEFAULT false,
  response_captured BOOLEAN NOT NULL DEFAULT false,
  response_redacted TEXT NULL,
  response_hash TEXT NULL,
  response_char_count INTEGER NULL,
  response_truncated BOOLEAN NOT NULL DEFAULT false,
  proposed_code_redacted TEXT NULL,
  final_code_redacted TEXT NULL,
  code_hash TEXT NULL,
  accepted BOOLEAN NULL,
  capture_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_interactions_trace_id ON agent_interactions (trace_id);
CREATE INDEX IF NOT EXISTS idx_agent_interactions_actor_id ON agent_interactions (actor_id);
CREATE INDEX IF NOT EXISTS idx_agent_interactions_repo ON agent_interactions (repo);
CREATE INDEX IF NOT EXISTS idx_agent_interactions_created_at ON agent_interactions (created_at DESC);

CREATE TABLE IF NOT EXISTS model_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id UUID NOT NULL,
  decision_log_id UUID NULL REFERENCES ambit_decision_logs(id) ON DELETE SET NULL,
  interaction_id UUID NULL REFERENCES agent_interactions(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  model_version TEXT NULL,
  hosting_type TEXT NULL,
  endpoint_region TEXT NULL,
  data_processing_region TEXT NULL,
  user_geography TEXT NULL,
  jurisdiction TEXT NULL,
  prompt_retention_policy TEXT NULL,
  response_retention_policy TEXT NULL,
  training_usage_allowed BOOLEAN NULL,
  training_exposure_risk TEXT NULL,
  data_classification TEXT NULL,
  approved_for_sensitive_code BOOLEAN NULL,
  approved_for_regulated_workloads BOOLEAN NULL,
  model_policy_version TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_usage_trace_id ON model_usage (trace_id);
CREATE INDEX IF NOT EXISTS idx_model_usage_provider ON model_usage (provider);
CREATE INDEX IF NOT EXISTS idx_model_usage_model_name ON model_usage (model_name);
CREATE INDEX IF NOT EXISTS idx_model_usage_jurisdiction ON model_usage (jurisdiction);
CREATE INDEX IF NOT EXISTS idx_model_usage_created_at ON model_usage (created_at DESC);

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  trace_id UUID NULL,
  repo TEXT NULL,
  actor_id TEXT NULL,
  team_id TEXT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents (severity);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents (status);
CREATE INDEX IF NOT EXISTS idx_incidents_repo ON incidents (repo);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents (created_at DESC);

CREATE TABLE IF NOT EXISTS incident_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  trace_id UUID NULL,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL,
  actor_id TEXT NULL,
  repo TEXT NULL,
  commit_sha TEXT NULL,
  pr_number TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_events_incident_id ON incident_events (incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_events_timestamp ON incident_events ("timestamp" DESC);

CREATE TABLE IF NOT EXISTS dashboard_metric_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name TEXT NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_metric_snapshots_metric_name
  ON dashboard_metric_snapshots (metric_name);
CREATE INDEX IF NOT EXISTS idx_dashboard_metric_snapshots_period_start
  ON dashboard_metric_snapshots (period_start);
CREATE INDEX IF NOT EXISTS idx_dashboard_metric_snapshots_period_end
  ON dashboard_metric_snapshots (period_end);
