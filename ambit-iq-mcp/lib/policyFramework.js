const RULE_CATALOG = [
  {
    id: "QUAL-001",
    domain: "quality",
    title: "No hardcoded credentials",
    severity: "critical",
    appliesTo: ["all"],
    rationale: "Embedded secrets create immediate compromise risk.",
    remediation: "Move credentials to env vars or a secret manager.",
    pattern: /(password|secret|api_key|token|auth|credentials)\s*[:=]\s*['"][^'"]+['"]/i,
  },
  {
    id: "QUAL-002",
    domain: "quality",
    title: "Network calls include error handling",
    severity: "high",
    appliesTo: ["all"],
    rationale: "Unhandled network failures reduce reliability.",
    remediation: "Wrap async I/O in try/catch or explicit .catch handlers.",
    test: (code) =>
      (code.includes("fetch(") || code.includes("axios.")) &&
      !code.includes("try") &&
      !code.includes(".catch("),
  },
  {
    id: "UX-001",
    domain: "ux",
    title: "Interactive controls expose accessible names",
    severity: "high",
    appliesTo: ["all"],
    rationale: "Controls without labels break keyboard/screen reader usage.",
    remediation: "Add aria-label/aria-labelledby or a linked <label>.",
    pattern: /<(button|input|select)(?![^>]*(aria-label|aria-labelledby))[^>]*>/i,
  },
  {
    id: "GDPR-001",
    domain: "regulatory",
    title: "Avoid plaintext PII fields in logs",
    severity: "high",
    appliesTo: ["eu", "financial-services", "healthcare"],
    rationale: "PII logging can violate minimization and confidentiality controls.",
    remediation: "Mask/redact personal data before logging.",
    pattern: /console\.(log|info|warn|error)\([^)]*(email|phone|ssn|dob|address|passport)[^)]*\)/i,
  },
  {
    id: "DORA-001",
    domain: "regulatory",
    title: "Critical external calls should include timeout hints",
    severity: "medium",
    appliesTo: ["eu", "financial-services"],
    rationale: "Resilience controls benefit from explicit timeout boundaries.",
    remediation: "Set timeout/abort options for outbound network calls.",
    test: (code) =>
      (code.includes("fetch(") || code.includes("axios.")) &&
      !/timeout|AbortController|signal/.test(code),
  },
  {
    id: "HIPAA-001",
    domain: "regulatory",
    title: "Potential PHI in analytics/third-party tracking calls",
    severity: "critical",
    appliesTo: ["healthcare", "us"],
    rationale: "Sending PHI to non-authorized processors can violate HIPAA safeguards.",
    remediation: "Remove PHI from telemetry payloads and gate tracking paths.",
    pattern: /(analytics|segment|mixpanel|amplitude|track)\([^)]*(diagnosis|patient|medical|mrn|phi)[^)]*\)/i,
  },
];

const PROFILES = [
  {
    id: "baseline.global",
    title: "Baseline Global Engineering",
    industry: "all",
    geo: "global",
    includeDomains: ["quality", "ux"],
    failOn: "high",
  },
  {
    id: "financial-services.eu",
    title: "Financial Services EU",
    industry: "financial-services",
    geo: "eu",
    includeDomains: ["quality", "ux", "regulatory"],
    failOn: "medium",
  },
  {
    id: "healthcare.us",
    title: "Healthcare US",
    industry: "healthcare",
    geo: "us",
    includeDomains: ["quality", "ux", "regulatory"],
    failOn: "medium",
  },
];

const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };
const SCORE_WEIGHT = { low: 4, medium: 10, high: 20, critical: 35 };

function profileById(profileId) {
  return PROFILES.find((p) => p.id === profileId) || PROFILES[0];
}

function ruleApplies(rule, profile) {
  if (!profile.includeDomains.includes(rule.domain)) return false;
  if (!rule.appliesTo || rule.appliesTo.includes("all")) return true;
  return (
    rule.appliesTo.includes(profile.geo) ||
    rule.appliesTo.includes(profile.industry)
  );
}

function evaluateRule(rule, code) {
  if (rule.pattern) return rule.pattern.test(code);
  if (typeof rule.test === "function") return Boolean(rule.test(code));
  return false;
}

export function listProfiles() {
  return PROFILES;
}

export function listRulesForProfile(profileId) {
  const profile = profileById(profileId);
  return RULE_CATALOG.filter((r) => ruleApplies(r, profile));
}

export function runPolicyAudit(code, profileId) {
  const profile = profileById(profileId);
  const activeRules = RULE_CATALOG.filter((r) => ruleApplies(r, profile));
  const findings = activeRules
    .filter((rule) => evaluateRule(rule, code))
    .map((rule) => ({
      ruleId: rule.id,
      title: rule.title,
      domain: rule.domain,
      severity: rule.severity,
      rationale: rule.rationale,
      remediation: rule.remediation,
    }));
  const gateLevel = SEVERITY_RANK[profile.failOn] ?? 3;
  const blocking = findings.some((f) => (SEVERITY_RANK[f.severity] ?? 1) >= gateLevel);
  const severityCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  let penalty = 0;
  for (const f of findings) {
    if (severityCounts[f.severity] !== undefined) severityCounts[f.severity] += 1;
    penalty += SCORE_WEIGHT[f.severity] ?? 0;
  }
  const complianceScore = Math.max(0, 100 - penalty);
  return {
    profile,
    totals: {
      activeRules: activeRules.length,
      findings: findings.length,
      blockingFindings: findings.filter((f) => (SEVERITY_RANK[f.severity] ?? 1) >= gateLevel).length,
    },
    metrics: {
      complianceScore,
      severityCounts,
    },
    findings,
    gate: blocking ? "blocked" : "pass",
  };
}

/**
 * SOC2-friendly compact control status summary for traceability logs.
 * Maps current rule registry into enterprise-facing checks.
 */
export function summarizeAmbitResults(auditResult) {
  const findings = Array.isArray(auditResult?.findings) ? auditResult.findings : [];
  const hit = new Set(findings.map((f) => f.ruleId));
  return {
    gate: auditResult?.gate || "unknown",
    profile_id: auditResult?.profile?.id || "unknown",
    checks: {
      security: { pass: !hit.has("QUAL-001"), mapped_rules: ["QUAL-001"] },
      aoda: { pass: !hit.has("UX-001"), mapped_rules: ["UX-001"] },
      async_resilience: { pass: !hit.has("QUAL-002"), mapped_rules: ["QUAL-002"] },
    },
    findings_count: findings.length,
    blocking_findings_count: auditResult?.totals?.blockingFindings ?? 0,
    compliance_score: auditResult?.metrics?.complianceScore ?? null,
  };
}
