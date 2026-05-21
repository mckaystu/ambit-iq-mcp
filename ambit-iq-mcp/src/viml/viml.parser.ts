import { parse as parseYaml } from "yaml";
import { VimlDocumentSchema, type VimlDocument } from "./viml.schema.js";

/** Schema / YAML rules should match `lib/vimlShadowImpact.mjs` (dashboard shadow-impact). */

export type ParseVimlResult =
  | { ok: true; doc: VimlDocument }
  | { ok: false; error: string };

/**
 * Parse a VIML document (YAML). Root keys: vibe, target, enforce, logic, on_failure.
 */
export function parseVimlDocument(raw: string): ParseVimlResult {
  const text = String(raw || "").trim();
  if (!text) {
    return { ok: false, error: "VIML document is empty." };
  }
  let data: unknown;
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
