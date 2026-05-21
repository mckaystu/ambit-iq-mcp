import {
  parseVimlDocument,
  vimlDocFromEnforcePatterns,
  codeWouldBeFlaggedByVimlEnforce,
} from "./vimlShadowImpact.mjs";
import { extractAgentGateTestPattern, normalizeAgentGateRegexSource } from "./agentGateRegexComment.mjs";

/**
 * Pure resolution for shadow-impact: how to flag proposed_code rows (no DB).
 * @param {object} body — request JSON (rego_code, viml, enforce_patterns, on_failure)
 * @returns
 *   | { type: "error"; status: 400; json: Record<string, unknown> }
 *   | { type: "empty"; status: 200; json: Record<string, unknown> }
 *   | { type: "scan"; impact_mode: "regex"|"viml"|"enforce_patterns"; wouldFlag: (code: string) => boolean; meta: Record<string, unknown> }
 */
export function resolveShadowImpactMatcher(body) {
  const rego_code = String(body.rego_code || "");
  const vimlRaw = String(body.viml || "").trim();
  const enforce_patterns = body.enforce_patterns;
  const onFailureViml = String(body.on_failure || "").trim();

  if (vimlRaw) {
    const pv = parseVimlDocument(vimlRaw);
    if (!pv.ok) {
      return { type: "error", status: 400, json: { error: pv.error, code: "VIML_PARSE" } };
    }
    const doc = pv.doc;
    const meta = {
      viml_profile: doc.vibe?.profile ?? null,
      enforce_rule_count: Array.isArray(doc.enforce)
        ? doc.enforce.filter((e) => String(e?.pattern || "").trim()).length
        : 0,
    };
    return {
      type: "scan",
      impact_mode: "viml",
      wouldFlag: (code) => codeWouldBeFlaggedByVimlEnforce(code, doc),
      meta,
    };
  }

  if (Array.isArray(enforce_patterns) && enforce_patterns.length > 0) {
    const doc = vimlDocFromEnforcePatterns(enforce_patterns, onFailureViml);
    if (!doc.enforce.length) {
      return {
        type: "error",
        status: 400,
        json: {
          error: "enforce_patterns must include at least one entry with a non-empty pattern.",
          code: "ENFORCE_EMPTY",
        },
      };
    }
    return {
      type: "scan",
      impact_mode: "enforce_patterns",
      wouldFlag: (code) => codeWouldBeFlaggedByVimlEnforce(code, doc),
      meta: { enforce_rule_count: doc.enforce.length },
    };
  }

  const patternStr = extractAgentGateTestPattern(rego_code);
  if (!patternStr) {
    return {
      type: "empty",
      status: 200,
      json: {
        ok: true,
        impact_mode: "regex",
        flagged_total: 0,
        flagged_agent: 0,
        flagged_human: 0,
        rows_scanned: 0,
        note:
          'No simulation source: pass `viml` (YAML), `enforce_patterns` (array), or add "# AGENT_GATE:test <regex>" near the top of Rego (JavaScript-compatible regex source, no slashes).',
      },
    };
  }

  const norm = normalizeAgentGateRegexSource(patternStr);
  let re;
  try {
    re = new RegExp(norm.source, norm.flags);
  } catch (e) {
    return {
      type: "error",
      status: 400,
      json: { error: `Invalid regex in # AGENT_GATE:test: ${String(e)}` },
    };
  }
  return {
    type: "scan",
    impact_mode: "regex",
    wouldFlag: (code) => re.test(code),
    meta: { pattern: norm.source, pattern_flags: norm.flags },
  };
}
