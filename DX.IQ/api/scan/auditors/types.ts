export type AuditSeverity = "info" | "warn" | "error";

export type AuditFinding = {
  auditorId: string;
  severity: AuditSeverity;
  message: string;
  snippet?: string;
};

/** Context passed to every component/item auditor. */
export type AuditorContext = {
  /** Human-readable path, e.g. "Lib / Marketing / 2024" */
  folderPath: string;
  /** Number of folder segments under the library root (0 = root folder). */
  folderDepth: number;
  /** Raw WCM JSON for a component or folder item. */
  componentJson: Record<string, unknown>;
};

export interface ComponentAuditor {
  readonly id: string;
  audit(ctx: AuditorContext): AuditFinding[];
}
