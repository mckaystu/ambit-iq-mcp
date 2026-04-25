-- =============================================================================
-- Sample rows for public.compliance_activity (Ambit.IQ dashboard demo)
-- =============================================================================
-- Intended to align with rules seeded by scripts/seed-rules-library.mjs
-- (same rule_name values). Run after rules_library is populated.
--
-- Tag: context_snippet starts with "[Ambit demo]" so you can remove demo data:
--   DELETE FROM compliance_activity WHERE context_snippet LIKE '[Ambit demo]%';
--
-- If your table has extra columns (e.g. industry_id, severity, rule_name),
-- add them to the INSERT list as needed. This script targets the common core:
--   user_id, repo_name, tenant_id, rule_id, action_taken, timestamp,
--   context_snippet, is_resolved
--
-- activity_id: omitted so DEFAULT gen_random_uuid() applies (if defined).
-- =============================================================================

-- Demo tenants (fixed UUIDs for reproducible dashboard "tenant" grouping)
-- Tenant A — platform engineering org
-- Tenant B — higher-risk tenant for insight cards / drill-downs

INSERT INTO compliance_activity (
  user_id,
  repo_name,
  tenant_id,
  rule_id,
  action_taken,
  "timestamp",
  context_snippet,
  is_resolved
)
SELECT
  'u-hipaa-1',
  'hipaa-horror-app',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  rl.rule_id,
  'BLOCKER',
  now() - interval '45 minutes',
  '[Ambit demo] track(''patient_mrn'', diagnosisCode) — PHI surfaced in analytics payload (HIPAA-001).',
  false
FROM rules_library rl
WHERE rl.rule_name = 'Potential PHI in analytics or tracking calls'
LIMIT 1;

INSERT INTO compliance_activity (
  user_id,
  repo_name,
  tenant_id,
  rule_id,
  action_taken,
  "timestamp",
  context_snippet,
  is_resolved
)
SELECT
  'u-sec-42',
  'payments-api',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  rl.rule_id,
  'BLOCKER',
  now() - interval '3 hours',
  '[Ambit demo] const apiKey = ''sk_live_51H…''; // hardcoded credential in service (QUAL-001).',
  false
FROM rules_library rl
WHERE rl.rule_name = 'No hardcoded credentials'
LIMIT 1;

INSERT INTO compliance_activity (
  user_id,
  repo_name,
  tenant_id,
  rule_id,
  action_taken,
  "timestamp",
  context_snippet,
  is_resolved
)
SELECT
  'u-fin-7',
  'claims-portal',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  rl.rule_id,
  'BLOCKER',
  now() - interval '6 hours',
  '[Ambit demo] console.log(''user'', email, passportId) — plaintext PII in logs (GDPR-001).',
  false
FROM rules_library rl
WHERE rl.rule_name = 'Avoid plaintext PII fields in logs'
LIMIT 1;

INSERT INTO compliance_activity (
  user_id,
  repo_name,
  tenant_id,
  rule_id,
  action_taken,
  "timestamp",
  context_snippet,
  is_resolved
)
SELECT
  'u-fe-12',
  'retail-web',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  rl.rule_id,
  'WARNING',
  now() - interval '18 hours',
  '[Ambit demo] <button class="checkout"> without aria-label on primary CTA (UX-001).',
  false
FROM rules_library rl
WHERE rl.rule_name = 'Interactive controls expose accessible names'
LIMIT 1;

INSERT INTO compliance_activity (
  user_id,
  repo_name,
  tenant_id,
  rule_id,
  action_taken,
  "timestamp",
  context_snippet,
  is_resolved
)
SELECT
  'u-sre-3',
  'logistics-svc',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  rl.rule_id,
  'WARNING',
  now() - interval '30 hours',
  '[Ambit demo] fetch(url) with no AbortSignal / timeout — DORA resilience gap (DORA-001).',
  false
FROM rules_library rl
WHERE rl.rule_name = 'Critical external calls should include timeout hints'
LIMIT 1;

INSERT INTO compliance_activity (
  user_id,
  repo_name,
  tenant_id,
  rule_id,
  action_taken,
  "timestamp",
  context_snippet,
  is_resolved
)
SELECT
  'u-api-9',
  'api-gateway',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  rl.rule_id,
  'BLOCKER',
  now() - interval '52 hours',
  '[Ambit demo] await fetchOrders() without try/catch on critical path (QUAL-002).',
  false
FROM rules_library rl
WHERE rl.rule_name = 'Network calls include error handling'
LIMIT 1;

-- Older resolved item (shows is_resolved + backfills trend if date range includes it)
INSERT INTO compliance_activity (
  user_id,
  repo_name,
  tenant_id,
  rule_id,
  action_taken,
  "timestamp",
  context_snippet,
  is_resolved
)
SELECT
  'u-hipaa-2',
  'hipaa-horror-app',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  rl.rule_id,
  'BLOCKER',
  now() - interval '9 days',
  '[Ambit demo] mixpanel.track(''page_view'', { mrn: patientId }) — remediated same sprint.',
  true
FROM rules_library rl
WHERE rl.rule_name = 'Potential PHI in analytics or tracking calls'
LIMIT 1;

-- Extra volume on Tenant B blockers (helps "Top Risk Tenant" style insights in-range)
INSERT INTO compliance_activity (
  user_id,
  repo_name,
  tenant_id,
  rule_id,
  action_taken,
  "timestamp",
  context_snippet,
  is_resolved
)
SELECT
  'u-sec-99',
  'legacy-monolith',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  rl.rule_id,
  'BLOCKER',
  now() - interval '20 hours',
  '[Ambit demo] password = ''Winter2024!'' in config module (QUAL-001).',
  false
FROM rules_library rl
WHERE rl.rule_name = 'No hardcoded credentials'
LIMIT 1;
