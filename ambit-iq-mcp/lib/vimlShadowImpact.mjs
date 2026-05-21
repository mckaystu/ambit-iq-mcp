/**
 * VIML shadow-impact helpers — keep in sync with src/viml/viml.schema.ts,
 * src/viml/viml.parser.ts, src/viml/viml.enforce.ts, and src/viml/viml.rego.ts
 * (wrapVimlLogicPackage) for dashboard /api/policy-manager and MCP.
 */
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const VimlEnforceEntrySchema = z.object({
  id: z.string().optional(),
  pattern: z.string().optional(),
  message: z.string().optional(),
  severity: z.enum(["low", "medium", "high", "critical", "BLOCKER", "HIGH", "MEDIUM", "LOW"]).optional(),
});

const VimlVibeSchema = z.object({
  intent: z.string().min(1, "vibe.intent is required"),
  priority: z.string().optional(),
  category: z.string().optional(),
  profile: z.string().optional().default("baseline.global"),
  id: z.string().optional(),
});

const VimlTargetSchema = z.object({
  files: z.array(z.string()).optional(),
  tenant_id: z.string().nullable().optional(),
});

const VimlDocumentSchema = z.object({
  vibe: VimlVibeSchema,
  target: VimlTargetSchema.optional(),
  enforce: z.array(VimlEnforceEntrySchema).optional().default([]),
  logic: z.string().optional().default(""),
  on_failure: z.string().optional().default("Policy violation."),
});

const NORM_FLAGS = "i";

function normalizeSeverity(s) {
  const x = String(s || "high").toLowerCase();
  if (x === "blocker" || x === "critical") return "critical";
  if (x === "high") return "high";
  if (x === "low" || x === "warn") return "low";
  return "medium";
}

/**
 * @param {string} raw
 * @returns {{ ok: true, doc: Record<string, unknown> } | { ok: false, error: string }}
 */
export function parseVimlDocument(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return { ok: false, error: "VIML document is empty." };
  }
  let data;
  try {
    data = parseYaml(text);
  } catch (e) {
    return { ok: false, error: `VIML YAML parse error: ${String(e)}` };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "VIML root must be a mapping (object)." };
  }
  const parsed = VimlDocumentSchema.safeParse(data);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return { ok: false, error: `VIML schema: ${msg}` };
  }
  return { ok: true, doc: parsed.data };
}

/**
 * @param {string} code
 * @param {{ enforce?: Array<Record<string, unknown>>; on_failure?: string }} doc
 */
export function runVimlEnforceFastPath(code, doc) {
  const hits = [];
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

/**
 * @param {unknown} enforce_patterns
 * @param {string} [onFailure]
 * @returns {{ vibe: { intent: string }; enforce: Array<Record<string, unknown>>; on_failure: string }}
 */
export function vimlDocFromEnforcePatterns(enforce_patterns, onFailure) {
  const raw = Array.isArray(enforce_patterns) ? enforce_patterns : [];
  const enforce = [];
  for (const e of raw) {
    if (typeof e === "string") {
      const p = e.trim();
      if (p) enforce.push({ pattern: p });
      continue;
    }
    if (e && typeof e === "object" && typeof e.pattern === "string" && e.pattern.trim()) {
      enforce.push({
        pattern: e.pattern.trim(),
        id: e.id != null ? String(e.id) : undefined,
        message: e.message != null ? String(e.message) : undefined,
        severity: e.severity,
      });
    }
  }
  return {
    vibe: { intent: "shadow-impact" },
    enforce,
    on_failure: String(onFailure || "Policy violation.").trim() || "Policy violation.",
  };
}

/**
 * @param {string} code
 * @param {{ enforce?: Array<Record<string, unknown>>; on_failure?: string }} doc
 */
export function codeWouldBeFlaggedByVimlEnforce(code, doc) {
  return runVimlEnforceFastPath(code, doc).hits.length > 0;
}

/**
 * Same behavior as src/viml/viml.rego.ts wrapVimlLogicPackage.
 * @param {string} logicBody
 * @param {string} [vibeId]
 */
export function wrapVimlLogicPackage(logicBody, vibeId) {
  const trimmed = String(logicBody || "").trim();
  if (!trimmed) return "";
  if (/^\s*package\s+/im.test(trimmed)) {
    return trimmed;
  }
  const raw = String(vibeId || "").trim() || createHash("sha256").update(trimmed).digest("hex").slice(0, 12);
  const safe = raw.replace(/[^a-zA-Z0-9_]/g, "_") || "policy";
  return `package agent.gate.${safe}\n\n${trimmed}\n`;
}

/**
 * MCP-aligned summary for Policy IDE / viml-preview (no secrets).
 * @param {Record<string, unknown>} doc — parsed VIML document
 * @param {{ sample_code?: string }} [opts]
 */
export function vimlServerPreview(doc, opts = {}) {
  const vibe = doc.vibe && typeof doc.vibe === "object" ? doc.vibe : {};
  const logicBody = String(doc.logic || "").trim();
  const wrapped = logicBody ? wrapVimlLogicPackage(logicBody, /** @type {string|undefined} */ (vibe.id)) : "";
  const enforce = Array.isArray(doc.enforce) ? doc.enforce : [];
  const enforce_rule_count = enforce.filter((e) => e && typeof e === "object" && String(e.pattern || "").trim()).length;
  const sampleCode = opts.sample_code != null ? String(opts.sample_code) : "";
  const hits = sampleCode ? runVimlEnforceFastPath(sampleCode, doc).hits : [];
  const out = {
    vibe_intent: String(vibe.intent || ""),
    vibe_profile: vibe.profile != null ? String(vibe.profile) : null,
    vibe_id: vibe.id != null ? String(vibe.id) : null,
    enforce_rule_count,
    on_failure: String(doc.on_failure || "Policy violation."),
    logic_char_count: logicBody.length,
    has_wrapped_rego: Boolean(logicBody && wrapped),
    viml_wrapped_rego_preview: wrapped ? wrapped.slice(0, 1200) : "",
  };
  if (opts.sample_code !== undefined) {
    out.sample_enforce_hit = hits.length > 0;
    out.sample_enforce_hit_count = hits.length;
  }
  return out;
}
