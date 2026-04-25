export interface PolicyProfile {
  id: string;
  industry?: string;
  geo?: string;
  failOn?: string;
}

export interface PolicyFinding {
  ruleId: string;
  title: string;
  domain: string;
  severity: string;
  rationale: string;
  remediation: string;
  /** Present when this hit came from a shadow-mode rule (non-blocking). */
  virtual?: boolean;
}

export interface PolicyAuditResult {
  profile: PolicyProfile;
  totals: {
    activeRules: number;
    /** Rules in shadow status that apply to this profile (not used for blocking). */
    shadowRules?: number;
    findings: number;
    blockingFindings: number;
    /** Count of virtual violation hits from shadow rules for this code sample. */
    virtualFindingsCount?: number;
  };
  metrics: {
    complianceScore: number;
    severityCounts: Record<string, number>;
  };
  findings: PolicyFinding[];
  /** Shadow-rule matches only; never affects gate. */
  virtualFindings?: PolicyFinding[];
  gate: string;
}

export interface PolicyRuleContext {
  tenantId?: string;
  industryId?: string;
  domainId?: string;
  complianceTags?: string[];
}

export function listProfiles(): unknown[];
export function listRulesForProfile(profileId: string, context?: PolicyRuleContext): unknown[];
export function runPolicyAudit(
  code: string,
  profileId: string,
  context?: PolicyRuleContext,
): PolicyAuditResult;
export function refreshRulesLibrary(options?: { force?: boolean }): Promise<{
  ok: boolean;
  source: "database" | "embedded";
  count: number;
  error: string | null;
}>;
export function getRulesLibraryStatus(): {
  source: "database" | "embedded";
  cachedRulesCount: number;
  activeRulesCount: number;
  lastRefreshAt: string | null;
  cacheAgeMs: number | null;
  refreshIntervalMs: number;
  lastError: string | null;
  hasDatabaseUrl: boolean;
  isRefreshInFlight: boolean;
};
export function summarizeAmbitResults(auditResult: unknown): Record<string, unknown>;
