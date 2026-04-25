import { loadAuditorsConfig } from "./config";
import { PatternAuditor } from "./patternAuditor";
import { StructureAuditor } from "./structureAuditor";
import type { AuditFinding, AuditorContext, ComponentAuditor } from "./types";

export type { AuditFinding, AuditorContext, ComponentAuditor } from "./types";
export { loadAuditorsConfig } from "./config";

export function createEnabledAuditors(): ComponentAuditor[] {
  const cfg = loadAuditorsConfig();
  const out: ComponentAuditor[] = [];
  if (cfg.patternAuditor.enabled) {
    out.push(new PatternAuditor(cfg.patternAuditor.patterns));
  }
  if (cfg.structureAuditor.enabled) {
    out.push(new StructureAuditor(cfg.structureAuditor.maxFolderDepth));
  }
  return out;
}

export function runAuditors(auditors: ComponentAuditor[], ctx: AuditorContext): AuditFinding[] {
  const all: AuditFinding[] = [];
  for (const a of auditors) {
    try {
      all.push(...a.audit(ctx));
    } catch {
      // never break crawl on auditor bug
    }
  }
  return all;
}
