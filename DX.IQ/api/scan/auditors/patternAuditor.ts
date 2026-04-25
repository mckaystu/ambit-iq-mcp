import type { AuditFinding, AuditorContext, ComponentAuditor } from "./types";

export class PatternAuditor implements ComponentAuditor {
  readonly id = "pattern";

  constructor(private readonly patterns: string[]) {}

  audit(ctx: AuditorContext): AuditFinding[] {
    const blob = JSON.stringify(ctx.componentJson);
    const findings: AuditFinding[] = [];
    for (const p of this.patterns) {
      if (!p) continue;
      if (blob.includes(p)) {
        findings.push({
          auditorId: this.id,
          severity: "warn",
          message: `Deprecated or legacy pattern "${p}" referenced under ${ctx.folderPath || "(root)"}`,
          snippet: p
        });
      }
    }
    return findings;
  }
}
