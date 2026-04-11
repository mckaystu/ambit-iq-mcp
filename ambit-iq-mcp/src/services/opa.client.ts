import type {
  OpaEvaluationInput,
  OpaEvaluationResult,
  OpaHttpResponse,
  OpaViolation,
} from "./opa.types.js";

function bridgeFromAmbitFindings(
  input: OpaEvaluationInput,
  findings: Array<{
    ruleId: string;
    title: string;
    severity: string;
    rationale?: string;
  }>,
): OpaEvaluationResult {
  const violations: OpaViolation[] = findings.map((f) => ({
    rule: f.ruleId,
    message: `${f.title}: ${f.rationale ?? ""}`.trim(),
    severity: f.severity,
  }));
  return {
    allow: violations.length === 0,
    violations,
    raw: {
      bridge: "ambit_policy_engine",
      input,
      findings,
    },
    source: "ambit_bridge",
  };
}

/**
 * Evaluates policy via OPA REST API when OPA_URL is set; otherwise maps built-in Ambit rules to OPA-shaped violations.
 */
export async function evaluatePolicy(
  input: OpaEvaluationInput,
  runPolicyAudit: (code: string, profileId: string) => {
    gate: string;
    findings: Array<{
      ruleId: string;
      title: string;
      severity: string;
      rationale?: string;
    }>;
  },
): Promise<OpaEvaluationResult> {
  const profileId = input.profile_id || "baseline.global";
  const opaBase = String(process.env.OPA_URL || "").trim().replace(/\/$/, "");

  if (!opaBase) {
    const audit = runPolicyAudit(input.code, profileId);
    const findings = audit.findings || [];
    return bridgeFromAmbitFindings(input, findings);
  }

  let policyPath = String(process.env.OPA_POLICY_PATH || "data.ambit.decision").trim();
  if (policyPath.startsWith("data.")) {
    policyPath = policyPath.slice(5);
  }
  const urlPath = policyPath.replaceAll(".", "/");
  const url = `${opaBase}/v1/data/${urlPath}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OPA HTTP ${res.status}: ${body.slice(0, 500)}`);
    }
    const json = (await res.json()) as OpaHttpResponse;
    const doc = json.result ?? {};
    const violations = Array.isArray(doc.violations) ? doc.violations : [];
    const allow =
      typeof doc.allow === "boolean" ? doc.allow : violations.length === 0;
    return {
      allow,
      violations,
      raw: json,
      source: "opa_rest",
    };
  } catch (e) {
    clearTimeout(t);
    const audit = runPolicyAudit(input.code, profileId);
    const findings = audit.findings || [];
    const fallback = bridgeFromAmbitFindings(input, findings);
    return {
      ...fallback,
      raw: {
        opa_error: String(e),
        fallback: fallback.raw,
      },
      source: "ambit_bridge",
    };
  }
}
