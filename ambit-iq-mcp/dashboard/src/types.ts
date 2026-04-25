export type DateRangePreset = "7d" | "30d" | "90d";

export interface DateRangeFilter {
  preset: DateRangePreset;
  startDate: string;
  endDate: string;
}

export interface TrendPoint {
  day: string;
  blockers: number;
  warnings: number;
}

export interface IndustryIssuePoint {
  industryId: string;
  violations: number;
}

export interface ActiveIssue {
  id: string;
  userId: string;
  repoName: string;
  tenant: string;
  industryId: string;
  severity: "BLOCKER" | "WARNING";
  ruleName: string;
  createdAt: string;
  /** Matched rules_library / activity rule id when present */
  ruleId?: string;
  /** Short excerpt from compliance_activity when present */
  contextSnippet?: string;
  isResolved?: boolean;
}

export interface InsightCard {
  title: string;
  summary: string;
}

export interface DashboardData {
  complianceScore: number;
  trendSeries: TrendPoint[];
  industrySeries: IndustryIssuePoint[];
  activeIssues: ActiveIssue[];
  insights: InsightCard[];
}

/** Row from Neon `rules_library` (policy catalog). */
export interface RulesLibraryRow {
  rule_id: string;
  tenant_id: string | null;
  industry_id: string | null;
  compliance_tags: string[];
  domain_id: string | null;
  rule_name: string;
  rule_logic: Record<string, unknown>;
  is_mandatory: boolean;
  created_at: string | null;
}

/** Result of loading dashboard metrics (live API or demo fallback). */
export interface DashboardLoadResult {
  data: DashboardData;
  source: "live" | "demo";
  /** Present when `source` is `demo` because the API failed or was unreachable. */
  error?: string;
}
