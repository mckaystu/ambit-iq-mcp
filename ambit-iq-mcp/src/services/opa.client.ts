import type {
  OpaEvaluationInput,
  OpaEvaluationResult,
  OpaHttpResponse,
  OpaViolation,
} from "./opa.types.js";
import type { VimlDocument } from "../viml/viml.schema.js";
import { parseVimlDocument } from "../viml/viml.parser.js";
import { runVimlEnforceFastPath } from "../viml/viml.enforce.js";
import { wrapVimlLogicPackage } from "../viml/viml.rego.js";
import { vimlDocumentForLog } from "../viml/viml.snapshot.js";

function bridgeFromAgentGateFindings(
  input: OpaEvaluationInput,
  findings: Array<{
    ruleId: string;
    title: string;
    severity: string;
    rationale?: string;
  }>,
  vimlSnapshot?: Record<string, unknown> | null,
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
      bridge: "agent_gate_policy_engine",
      input,
      findings,
      ...(vimlSnapshot ? { viml: vimlSnapshot } : {}),
    },
    source: "agent_gate_bridge",
  };
}

/**
 * Evaluates policy via OPA REST API when OPA_URL is set; otherwise maps built-in agent.gate rules to OPA-shaped violations.
 */
export async function evaluatePolicy(
  input: OpaEvaluationInput,
  runPolicyAudit: (code: string, profileId: string, context?: Record<string, unknown>) => {
    gate: string;
    findings: Array<{
      ruleId: string;
      title: string;
      severity: string;
      rationale?: string;
    }>;
  },
  ruleContext?: Record<string, unknown>,
): Promise<OpaEvaluationResult> {
  const vimlRaw = String(input.viml_policy || "").trim();
  let effectiveProfile = input.profile_id || "baseline.global";
  let vimlMeta: Record<string, unknown> | null = null;
  let parsedVimlDoc: VimlDocument | null = null;

  if (vimlRaw) {
    const parsed = parseVimlDocument(vimlRaw);
    if (!parsed.ok) {
      return {
        allow: false,
        violations: [{ rule: "VIML_PARSE", message: parsed.error, severity: "HIGH" }],
        raw: { viml_parse_error: parsed.error, input },
        source: "agent_gate_bridge",
      };
    }
    const doc = parsed.doc;
    parsedVimlDoc = doc;
    effectiveProfile = doc.vibe.profile || effectiveProfile;
    vimlMeta = {
      vibe_intent: doc.vibe.intent,
      vibe_profile: doc.vibe.profile,
      vibe_category: doc.vibe.category ?? null,
      vibe_priority: doc.vibe.priority ?? null,
    };
    const { hits } = runVimlEnforceFastPath(input.code, doc);
    if (hits.length > 0) {
      const violations: OpaViolation[] = hits.map((h) => ({
        rule: h.ruleId,
        message: h.rationale,
        severity: h.severity,
      }));
      return {
        allow: false,
        violations,
        raw: {
          viml_enforce: true,
          viml_meta: vimlMeta,
          viml: vimlDocumentForLog(doc),
          on_failure: doc.on_failure,
          input: { ...input, profile_id: effectiveProfile },
        },
        source: "viml_enforce",
      };
    }
  }

  const profileId = effectiveProfile;
  const opaBase = String(process.env.OPA_URL || "").trim().replace(/\/$/, "");
  const vimlSnapshot = parsedVimlDoc ? vimlDocumentForLog(parsedVimlDoc) : null;

  if (!opaBase) {
    const audit = runPolicyAudit(input.code, profileId, ruleContext);
    const findings = audit.findings || [];
    return bridgeFromAgentGateFindings(
      { ...input, profile_id: profileId },
      findings,
      vimlSnapshot,
    );
  }

  const logicBody = parsedVimlDoc ? String(parsedVimlDoc.logic || "").trim() : "";
  const wrappedRego =
    logicBody.length > 0 ? wrapVimlLogicPackage(logicBody, parsedVimlDoc?.vibe.id) : undefined;

  const opaInput: Record<string, unknown> = {
    code: input.code,
    intent_prompt: input.intent_prompt,
    profile_id: profileId,
    ...(vimlSnapshot ? { viml: vimlSnapshot } : {}),
    ...(wrappedRego ? { viml_wrapped_rego: wrappedRego, viml_meta: vimlMeta } : {}),
  };

  let policyPath = String(process.env.OPA_POLICY_PATH || "data.agent.gate.decision").trim();
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
      body: JSON.stringify({ input: opaInput }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OPA HTTP ${res.status}: ${body.slice(0, 500)}`);
    }
    const json = (await res.json()) as OpaHttpResponse;
    const decisionDoc = json.result ?? {};
    const violations = Array.isArray(decisionDoc.violations) ? decisionDoc.violations : [];
    const allow =
      typeof decisionDoc.allow === "boolean" ? decisionDoc.allow : violations.length === 0;
    return {
      allow,
      violations,
      raw: {
        ...(typeof json === "object" && json !== null ? json : { opa_response: json }),
        ...(vimlSnapshot ? { viml: vimlSnapshot } : {}),
      },
      source: "opa_rest",
    };
  } catch (e) {
    clearTimeout(t);
    const audit = runPolicyAudit(input.code, profileId, ruleContext);
    const findings = audit.findings || [];
    const fallback = bridgeFromAgentGateFindings(
      { ...input, profile_id: profileId },
      findings,
      vimlSnapshot,
    );
    return {
      ...fallback,
      raw: {
        opa_error: String(e),
        fallback: fallback.raw,
      },
      source: "agent_gate_bridge",
    };
  }
}
