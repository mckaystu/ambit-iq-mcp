import {
  hasNetworkCallWithoutTimeoutAst,
  hasUnprotectedNetworkCallAst,
  legacyNetworkCallWithoutTimeout,
  legacyUnprotectedNetworkCall,
} from "./networkCallRules.js";
import { PrismaClient } from "@prisma/client";

const EMBEDDED_RULE_CATALOG = [
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
const RULES_LIBRARY_REFRESH_MS = 30_000;

const globalForRulesDb = globalThis;
function getRulesPrisma() {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) return null;
  if (!globalForRulesDb.__ambitRulesPrisma) {
    globalForRulesDb.__ambitRulesPrisma = new PrismaClient({
      log: process.env.PRISMA_LOG === "1" ? ["query", "error", "warn"] : ["error"],
    });
  }
  return globalForRulesDb.__ambitRulesPrisma;
}

let loadedRules = [];
let lastRulesLoadAt = 0;
let rulesLoadError = null;
let inFlightLoad = null;

function normalizeSeverity(rawSeverity) {
  const s = String(rawSeverity || "").trim().toLowerCase();
  if (!s) return "medium";
  if (s === "blocker") return "critical";
  if (s === "warn") return "low";
  if (SEVERITY_RANK[s]) return s;
  return "medium";
}

function normalizeIndustry(rawIndustry) {
  const s = String(rawIndustry || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "financial-services" || s === "financial_services") return "finance";
  if (s === "health-care") return "healthcare";
  return s;
}

/** DB rules: active = enforce; shadow = virtual violations only; draft = not loaded into MCP cache. */
function rulePolicyStatus(rule) {
  const s = String(rule.policyStatus || "active").trim().toLowerCase();
  if (s === "shadow" || s === "draft") return s;
  return "active";
}

function compilePattern(rawPattern) {
  const p = String(rawPattern || "").trim();
  if (!p) return null;
  try {
    return new RegExp(p, "i");
  } catch {
    return null;
  }
}

function mapRowToRule(row) {
  const logic = row.rule_logic && typeof row.rule_logic === "object" ? row.rule_logic : {};
  const ruleId = String(logic.id || row.rule_name || row.rule_id || "").trim();
  const pattern = compilePattern(logic.pattern);
  if (!ruleId || !pattern) return null;
  const statusRaw = row.status != null ? String(row.status).trim().toLowerCase() : "active";
  const policyStatus = statusRaw === "shadow" || statusRaw === "draft" ? statusRaw : "active";
  return {
    id: ruleId,
    domain: String(row.domain_id || "quality").trim().toLowerCase(),
    title: String(row.rule_name || logic.id || "Unnamed rule"),
    severity: normalizeSeverity(logic.severity),
    rationale: String(logic.description || "Rule violation detected."),
    remediation: String(logic.action || "Refactor code to satisfy this rule."),
    pattern,
    // Keep embedded-style semantics plus DB routing hints for filtering.
    appliesTo: ["all"],
    tenantId: row.tenant_id ? String(row.tenant_id) : null,
    industryId: normalizeIndustry(row.industry_id),
    complianceTags: Array.isArray(row.compliance_tags)
      ? row.compliance_tags.map((x) => String(x).toLowerCase())
      : [],
    isMandatory: Boolean(row.is_mandatory),
    policyStatus,
  };
}

export async function refreshRulesLibrary(options = {}) {
  const force = options.force === true;
  const now = Date.now();
  if (!force && now - lastRulesLoadAt < RULES_LIBRARY_REFRESH_MS) {
    return {
      ok: rulesLoadError == null,
      source: loadedRules.length > 0 ? "database" : "embedded",
      count: loadedRules.length > 0 ? loadedRules.length : EMBEDDED_RULE_CATALOG.length,
      error: rulesLoadError,
    };
  }
  if (inFlightLoad) return inFlightLoad;

  const prisma = getRulesPrisma();
  if (!prisma) {
    lastRulesLoadAt = now;
    rulesLoadError = "DATABASE_URL not set";
    loadedRules = [];
    return {
      ok: false,
      source: "embedded",
      count: EMBEDDED_RULE_CATALOG.length,
      error: rulesLoadError,
    };
  }

  inFlightLoad = (async () => {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT rule_id, tenant_id, industry_id, compliance_tags, domain_id, rule_name, rule_logic, is_mandatory,
                COALESCE(NULLIF(trim(status::text), ''), 'active') AS status
         FROM rules_library
         WHERE COALESCE(NULLIF(trim(status::text), ''), 'active') IN ('active', 'shadow')
         ORDER BY created_at ASC`,
      );
      const mapped = Array.isArray(rows) ? rows.map(mapRowToRule).filter(Boolean) : [];
      loadedRules = mapped;
      rulesLoadError = null;
    } catch (e) {
      rulesLoadError = String(e);
      loadedRules = [];
    } finally {
      lastRulesLoadAt = Date.now();
      inFlightLoad = null;
    }
    return {
      ok: rulesLoadError == null,
      source: loadedRules.length > 0 ? "database" : "embedded",
      count: loadedRules.length > 0 ? loadedRules.length : EMBEDDED_RULE_CATALOG.length,
      error: rulesLoadError,
    };
  })();
  return inFlightLoad;
}

export function getRulesLibraryStatus() {
  const source = loadedRules.length > 0 ? "database" : "embedded";
  return {
    source,
    cachedRulesCount: loadedRules.length,
    activeRulesCount: loadedRules.length > 0 ? loadedRules.length : EMBEDDED_RULE_CATALOG.length,
    lastRefreshAt:
      lastRulesLoadAt > 0 ? new Date(lastRulesLoadAt).toISOString() : null,
    cacheAgeMs: lastRulesLoadAt > 0 ? Date.now() - lastRulesLoadAt : null,
    refreshIntervalMs: RULES_LIBRARY_REFRESH_MS,
    lastError: rulesLoadError,
    hasDatabaseUrl: Boolean(String(process.env.DATABASE_URL || "").trim()),
    isRefreshInFlight: Boolean(inFlightLoad),
  };
}

function activeRuleCatalog() {
  return loadedRules.length > 0 ? loadedRules : EMBEDDED_RULE_CATALOG;
}

function profileById(profileId) {
  return PROFILES.find((p) => p.id === profileId) || PROFILES[0];
}

function ruleApplies(rule, profile, options = {}) {
  const tenantId = options.tenantId ? String(options.tenantId) : null;
  const industryId = normalizeIndustry(options.industryId);
  const profileIndustry = normalizeIndustry(profile.industry);
  const domainId = options.domainId ? String(options.domainId).toLowerCase() : null;
  const complianceTags = Array.isArray(options.complianceTags)
    ? options.complianceTags.map((t) => String(t).toLowerCase())
    : [];

  if (domainId && rule.domain !== domainId) return false;
  if (!profile.includeDomains.includes(rule.domain)) return false;
  if (rule.tenantId && tenantId && rule.tenantId !== tenantId) return false;
  if (rule.tenantId && !tenantId) return false;
  if (rule.industryId && industryId && rule.industryId !== industryId) return false;
  if (rule.industryId && !industryId && profileIndustry !== "all" && rule.industryId !== profileIndustry) {
    return false;
  }
  if (!rule.isMandatory && rule.complianceTags && rule.complianceTags.length > 0) {
    if (complianceTags.length === 0) return false;
    const intersects = rule.complianceTags.some((tag) => complianceTags.includes(tag));
    if (!intersects) return false;
  }
  if (!rule.appliesTo || rule.appliesTo.includes("all")) return true;
  return (
    rule.appliesTo.includes(profile.geo) ||
    rule.appliesTo.includes(profile.industry)
  );
}

function getAttributeValue(attrString, name) {
  const regex = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = attrString.match(regex);
  if (!match) return "";
  return (match[2] || match[3] || match[4] || "").trim();
}

function hasBooleanAttribute(attrString, name) {
  const regex = new RegExp(`\\b${name}(\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+)))?`, "i");
  return regex.test(attrString);
}

/**
 * Heuristic accessibility check for control naming.
 * Returns true when a likely unlabeled interactive control exists.
 */
function hasUnlabeledInteractiveControl(code) {
  const labelFors = new Set();
  const labelForRegex = /<label\b[^>]*\bfor\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  let labelMatch;
  while ((labelMatch = labelForRegex.exec(code)) !== null) {
    const id = (labelMatch[2] || labelMatch[3] || labelMatch[4] || "").trim();
    if (id) labelFors.add(id);
  }

  const controlRegex = /<(button|input|select|textarea)\b([^>]*)>([\s\S]*?)<\/button>|<(input|select|textarea)\b([^>]*)\/?>/gi;
  let controlMatch;
  while ((controlMatch = controlRegex.exec(code)) !== null) {
    const tag = (controlMatch[1] || controlMatch[4] || "").toLowerCase();
    const attrs = (controlMatch[2] || controlMatch[5] || "").trim();
    const buttonInnerText = (controlMatch[3] || "").replace(/<[^>]+>/g, "").trim();
    if (!tag) continue;

    // Hidden and inert controls do not require accessible names.
    const inputType = getAttributeValue(attrs, "type").toLowerCase();
    if (tag === "input" && (inputType === "hidden" || hasBooleanAttribute(attrs, "hidden"))) continue;
    if (hasBooleanAttribute(attrs, "disabled")) continue;

    const ariaLabel = getAttributeValue(attrs, "aria-label");
    const ariaLabelledBy = getAttributeValue(attrs, "aria-labelledby");
    const title = getAttributeValue(attrs, "title");
    const id = getAttributeValue(attrs, "id");
    const value = getAttributeValue(attrs, "value");
    const hasLinkedLabel = id ? labelFors.has(id) : false;
    const hasAriaName = Boolean(ariaLabel || ariaLabelledBy);

    if (tag === "button") {
      // Button text content itself provides an accessible name.
      const hasTextName = Boolean(buttonInnerText || value || title);
      if (!hasAriaName && !hasTextName && !hasLinkedLabel) return true;
      continue;
    }

    if (tag === "input") {
      // Input button-like variants can be named by value/title.
      const isButtonLike = ["button", "submit", "reset"].includes(inputType);
      const hasInputName = hasAriaName || hasLinkedLabel || Boolean(title) || (isButtonLike && Boolean(value));
      if (!hasInputName) return true;
      continue;
    }

    // select / textarea require label or aria naming.
    if (!hasAriaName && !hasLinkedLabel && !title) return true;
  }

  return false;
}

function evaluateRule(rule, code) {
  if (rule.id === "UX-001") {
    return hasUnlabeledInteractiveControl(code);
  }
  if (rule.id === "QUAL-002") {
    const ast = hasUnprotectedNetworkCallAst(code);
    return ast === null ? legacyUnprotectedNetworkCall(code) : ast;
  }
  if (rule.id === "DORA-001") {
    const ast = hasNetworkCallWithoutTimeoutAst(code);
    return ast === null ? legacyNetworkCallWithoutTimeout(code) : ast;
  }
  if (rule.pattern) return rule.pattern.test(code);
  if (typeof rule.test === "function") return Boolean(rule.test(code));
  return false;
}

export function listProfiles() {
  return PROFILES;
}

export function listRulesForProfile(profileId, context = {}) {
  const profile = profileById(profileId);
  return activeRuleCatalog().filter(
    (r) => ruleApplies(r, profile, context) && rulePolicyStatus(r) === "active",
  );
}

export function runPolicyAudit(code, profileId, context = {}) {
  const profile = profileById(profileId);
  const applicable = activeRuleCatalog().filter((r) => ruleApplies(r, profile, context));
  const enforcementRules = applicable.filter((r) => rulePolicyStatus(r) === "active");
  const shadowRules = applicable.filter((r) => rulePolicyStatus(r) === "shadow");

  const findings = enforcementRules
    .filter((rule) => evaluateRule(rule, code))
    .map((rule) => ({
      ruleId: rule.id,
      title: rule.title,
      domain: rule.domain,
      severity: rule.severity,
      rationale: rule.rationale,
      remediation: rule.remediation,
    }));

  const virtualFindings = shadowRules
    .filter((rule) => evaluateRule(rule, code))
    .map((rule) => ({
      ruleId: rule.id,
      title: rule.title,
      domain: rule.domain,
      severity: rule.severity,
      rationale: rule.rationale,
      remediation: rule.remediation,
      virtual: true,
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
      activeRules: enforcementRules.length,
      shadowRules: shadowRules.length,
      findings: findings.length,
      blockingFindings: findings.filter((f) => (SEVERITY_RANK[f.severity] ?? 1) >= gateLevel).length,
      virtualFindingsCount: virtualFindings.length,
    },
    metrics: {
      complianceScore,
      severityCounts,
    },
    findings,
    virtualFindings,
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
