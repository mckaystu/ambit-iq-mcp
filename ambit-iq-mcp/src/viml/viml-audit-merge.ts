import type { PolicyAuditResult, PolicyFinding } from "../../lib/policyFramework.js";
import type { VimlEnforceHit } from "./viml.enforce.js";

const SEVERITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const SCORE_WEIGHT: Record<string, number> = { low: 4, medium: 10, high: 20, critical: 35 };

/**
 * Replace audit outcome with VIML fast-path hits only (no deep-path / catalog merge).
 */
export function auditResultFromVimlEnforce(
  base: PolicyAuditResult,
  vimlHits: VimlEnforceHit[],
): PolicyAuditResult {
  const gateLevel = SEVERITY_RANK[String(base.profile.failOn || "high").toLowerCase()] ?? 3;
  const findings: PolicyFinding[] = vimlHits.map((h) => ({
    ruleId: h.ruleId,
    title: h.title,
    domain: h.domain,
    severity: h.severity,
    rationale: h.rationale,
    remediation: h.remediation,
  }));
  const blocking = findings.some((f) => (SEVERITY_RANK[f.severity] ?? 1) >= gateLevel);
  const severityCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  let penalty = 0;
  for (const f of findings) {
    const sev = f.severity;
    if (severityCounts[sev as keyof typeof severityCounts] !== undefined) {
      severityCounts[sev as keyof typeof severityCounts] += 1;
    }
    penalty += SCORE_WEIGHT[sev] ?? 0;
  }
  return {
    profile: base.profile,
    totals: {
      activeRules: base.totals.activeRules,
      shadowRules: base.totals.shadowRules ?? 0,
      findings: findings.length,
      blockingFindings: findings.filter((f) => (SEVERITY_RANK[f.severity] ?? 1) >= gateLevel).length,
      virtualFindingsCount: 0,
    },
    metrics: {
      complianceScore: Math.max(0, 100 - penalty),
      severityCounts,
    },
    findings,
    virtualFindings: [],
    gate: blocking ? "blocked" : "pass",
  };
}
