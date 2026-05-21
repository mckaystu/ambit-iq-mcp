import type { VimlDocument } from "./viml.schema.js";

const DEFAULT_MAX_LOGIC = 24_000;

/**
 * JSON-safe VIML document for logs / raw payloads (truncates large logic bodies).
 */
export function vimlDocumentForLog(doc: VimlDocument, maxLogicChars = DEFAULT_MAX_LOGIC): Record<string, unknown> {
  const logic = String(doc.logic || "");
  const truncated = logic.length > maxLogicChars;
  return {
    vibe: doc.vibe,
    target: doc.target ?? null,
    enforce: doc.enforce ?? [],
    on_failure: doc.on_failure,
    logic: truncated ? logic.slice(0, maxLogicChars) : logic,
    ...(truncated ? { logic_truncated: true } : {}),
  };
}
