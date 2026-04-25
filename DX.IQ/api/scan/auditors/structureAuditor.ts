import type { AuditFinding, AuditorContext, ComponentAuditor } from "./types";

export class StructureAuditor implements ComponentAuditor {
  readonly id = "structure";

  constructor(private readonly maxFolderDepth: number) {}

  audit(ctx: AuditorContext): AuditFinding[] {
    if (ctx.folderDepth <= this.maxFolderDepth) return [];
    return [
      {
        auditorId: this.id,
        severity: "warn",
        message: `Excessive folder nesting: depth ${ctx.folderDepth} (threshold ${this.maxFolderDepth}) at "${ctx.folderPath}"`,
        snippet: String(ctx.folderDepth)
      }
    ];
  }
}
