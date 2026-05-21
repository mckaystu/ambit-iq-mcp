import { createHash } from "node:crypto";

/**
 * Wrap embedded Rego under package agent.gate.<id> when the body has no package declaration.
 * Keep behavior aligned with `lib/vimlShadowImpact.mjs` `wrapVimlLogicPackage` (Policy IDE preview).
 */
export function wrapVimlLogicPackage(logicBody: string, vibeId?: string): string {
  const trimmed = String(logicBody || "").trim();
  if (!trimmed) return "";
  if (/^\s*package\s+/im.test(trimmed)) {
    return trimmed;
  }
  const raw = String(vibeId || "").trim() || createHash("sha256").update(trimmed).digest("hex").slice(0, 12);
  const safe = raw.replace(/[^a-zA-Z0-9_]/g, "_") || "policy";
  return `package agent.gate.${safe}\n\n${trimmed}\n`;
}
