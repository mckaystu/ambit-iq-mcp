CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

ALTER TABLE ambit_decision_logs ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE agent_interactions ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE model_usage ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE dashboard_metric_snapshots ADD COLUMN IF NOT EXISTS tenant_id uuid;

CREATE INDEX IF NOT EXISTS idx_ambit_decision_logs_tenant_id ON ambit_decision_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_interactions_tenant_id ON agent_interactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_model_usage_tenant_id ON model_usage(tenant_id);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_id ON incidents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_metric_snapshots_tenant_id ON dashboard_metric_snapshots(tenant_id);
