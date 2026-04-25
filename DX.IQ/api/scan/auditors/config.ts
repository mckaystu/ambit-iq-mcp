import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type AuditorsConfigFile = {
  patternAuditor?: { enabled?: boolean; patterns?: string[] };
  structureAuditor?: { enabled?: boolean; maxFolderDepth?: number };
};

const here = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_AUDITORS_CONFIG: {
  patternAuditor: { enabled: boolean; patterns: string[] };
  structureAuditor: { enabled: boolean; maxFolderDepth: number };
} = {
  patternAuditor: {
    enabled: true,
    patterns: ["[Plugin:RemoteAction]", "dojo.ready", "dojo/ready"]
  },
  structureAuditor: {
    enabled: true,
    maxFolderDepth: 5
  }
};

/**
 * Merges optional JSON from SCAN_AUDITORS_CONFIG, ./scan-auditors.config.json,
 * ./DX.IQ/scan-auditors.config.json, then packaged default.config.json (last wins per field).
 */
export function loadAuditorsConfig(): typeof DEFAULT_AUDITORS_CONFIG {
  let pattern = { ...DEFAULT_AUDITORS_CONFIG.patternAuditor };
  let structure = { ...DEFAULT_AUDITORS_CONFIG.structureAuditor };

  const envPath = process.env.SCAN_AUDITORS_CONFIG?.trim();
  const candidates = [
    envPath,
    resolve(process.cwd(), "scan-auditors.config.json"),
    resolve(process.cwd(), "DX.IQ/scan-auditors.config.json"),
    resolve(here, "default.config.json")
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf8")) as AuditorsConfigFile;
      if (j.patternAuditor) {
        if (typeof j.patternAuditor.enabled === "boolean") pattern.enabled = j.patternAuditor.enabled;
        if (Array.isArray(j.patternAuditor.patterns) && j.patternAuditor.patterns.length > 0) {
          pattern.patterns = j.patternAuditor.patterns.map(String);
        }
      }
      if (j.structureAuditor) {
        if (typeof j.structureAuditor.enabled === "boolean") structure.enabled = j.structureAuditor.enabled;
        if (typeof j.structureAuditor.maxFolderDepth === "number" && j.structureAuditor.maxFolderDepth > 0) {
          structure.maxFolderDepth = j.structureAuditor.maxFolderDepth;
        }
      }
    } catch {
      // ignore invalid optional config
    }
  }

  return { patternAuditor: pattern, structureAuditor: structure };
}
