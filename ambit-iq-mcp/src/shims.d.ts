declare module "#pf" {
  export function listProfiles(): unknown[];
  export function listRulesForProfile(profileId: string): unknown[];
  export function runPolicyAudit(
    code: string,
    profileId: string,
  ): {
    profile: { id: string; industry?: string; geo?: string };
    totals: {
      activeRules: number;
      findings: number;
      blockingFindings: number;
    };
    metrics: { complianceScore: number; severityCounts: Record<string, number> };
    findings: Array<{
      ruleId: string;
      title: string;
      domain: string;
      severity: string;
      rationale: string;
      remediation: string;
    }>;
    gate: string;
  };
  export function summarizeAmbitResults(auditResult: unknown): Record<string, unknown>;
}

declare module "#cert" {
  export function buildAuditCertificateHtml(opts: {
    result: unknown;
    appName: string;
    targetEnvironment: string;
    scannerName: string;
  }): string;
}

declare module "#audit" {
  export class AuditStore {
    constructor(options?: { logsDir?: string });
    writeAuditLog(record: unknown): Promise<{
      filePath: string;
      markdownFilePath: string;
      markdownSummary: string;
      forwardResult: unknown;
    }>;
  }
}
