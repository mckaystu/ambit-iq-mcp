import type { VimlDocument } from "./viml.schema.js";

/** Keep fast-path behavior aligned with `lib/vimlShadowImpact.mjs` (dashboard shadow-impact). */
const NORM_FLAGS = "i";

function normalizeSeverity(s: string | undefined): "low" | "medium" | "high" | "critical" {
  const x = String(s || "high").toLowerCase();
  if (x === "blocker" || x === "critical") return "critical";
  if (x === "high") return "high";
  if (x === "low" || x === "warn") return "low";
  return "medium";
}

export type VimlEnforceHit = {
  ruleId: string;
  title: string;
  domain: string;
  severity: "low" | "medium" | "high" | "critical";
  rationale: string;
  remediation: string;
};

/**
 * Fast-path: evaluate enforce[] patterns against code. First match wins per entry (all entries checked).
 */
export function runVimlEnforceFastPath(code: string, doc: VimlDocument): { hits: VimlEnforceHit[] } {
  const hits: VimlEnforceHit[] = [];
  const onFailure = String(doc.on_failure || "Policy violation.").trim();
  for (const entry of doc.enforce || []) {
    const pat = String(entry.pattern || "").trim();
    if (!pat) continue;
    try {
      const re = new RegExp(pat, NORM_FLAGS);
      if (re.test(code)) {
        const id = String(entry.id || "VIML_ENFORCE").trim() || "VIML_ENFORCE";
        const sev = normalizeSeverity(entry.severity);
        hits.push({
          ruleId: id,
          title: "agent.gate VIML enforce",
          domain: "quality",
          severity: sev,
          rationale: [onFailure, entry.message ? `Detail: ${entry.message}` : ""].filter(Boolean).join(" "),
          remediation: "Remove or refactor the matched construct to satisfy the VIML enforce pattern.",
        });
      }
    } catch {
      /* skip invalid regex entries */
    }
  }
  return { hits };
}
