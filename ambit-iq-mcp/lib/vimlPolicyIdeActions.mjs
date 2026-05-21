import { parseVimlDocument, vimlServerPreview } from "./vimlShadowImpact.mjs";

/**
 * @param {object} body
 * @returns {{ ok: true, status: 200, json: Record<string, unknown> } | { ok: false, status: 400, json: Record<string, unknown> }}
 */
export function processVimlPreviewRequest(body) {
  const vimlRaw = String(body.viml || "").trim();
  if (!vimlRaw) {
    return { ok: false, status: 400, json: { error: "viml is required" } };
  }
  const pv = parseVimlDocument(vimlRaw);
  if (!pv.ok) {
    return { ok: false, status: 400, json: { error: pv.error, code: "VIML_PARSE" } };
  }
  const sample_code = body.sample_code != null ? String(body.sample_code) : undefined;
  return {
    ok: true,
    status: 200,
    json: { ok: true, viml_preview: vimlServerPreview(pv.doc, { sample_code }) },
  };
}

/** @param {string} vimlRaw */
export function validateOptionalVimlForGenerate(vimlRaw) {
  const t = String(vimlRaw || "").trim();
  if (!t) return { ok: true, skip: true };
  const pv = parseVimlDocument(t);
  if (!pv.ok) {
    return { ok: false, status: 400, json: { error: pv.error, code: "VIML_PARSE" } };
  }
  return { ok: true, skip: false, doc: pv.doc };
}

/** @param {string} vimlRaw */
export function buildGeneratePayloadVimlPreview(vimlRaw) {
  const t = String(vimlRaw || "").trim();
  if (!t) return null;
  const pv = parseVimlDocument(t);
  if (!pv.ok) return null;
  return vimlServerPreview(pv.doc, {});
}

/** @param {Record<string, unknown>} rule_logic @param {string} vimlDeploy */
export function mergeVimlDocumentIntoRuleLogic(rule_logic, vimlDeploy) {
  const v = String(vimlDeploy || "").trim();
  if (!v) return { ok: true, rule_logic };
  const pv = parseVimlDocument(v);
  if (!pv.ok) {
    return { ok: false, json: { error: pv.error, code: "VIML_PARSE" } };
  }
  return { ok: true, rule_logic: { ...rule_logic, viml_document: v } };
}
