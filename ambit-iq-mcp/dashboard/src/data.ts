import { apiPath } from "./apiBase";
import type { DashboardData, DashboardLoadResult, DateRangeFilter, DateRangePreset } from "./types";

function daysForPreset(preset: DateRangePreset): number {
  if (preset === "7d") return 7;
  if (preset === "90d") return 90;
  return 30;
}

function isoDateDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export function defaultDateRange(): DateRangeFilter {
  return {
    preset: "30d",
    startDate: isoDateDaysAgo(30),
    endDate: isoDateDaysAgo(0),
  };
}

function metricsUrl(range: DateRangeFilter): string {
  const params = new URLSearchParams({
    preset: range.preset,
    startDate: range.startDate,
    endDate: range.endDate,
  });
  return apiPath(`/api/dashboard-metrics?${params.toString()}`);
}

async function fetchLiveDashboardData(range: DateRangeFilter): Promise<DashboardData> {
  const res = await fetch(metricsUrl(range));
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; note?: string };
      if (body?.error) detail = `${detail}: ${body.error}`;
      else if (body?.note) detail = `${detail}: ${body.note}`;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as DashboardData;
}

/**
 * Mocked adapter for compliance_activity + rules_library (Neon).
 * Replace with server API fetch when wiring production data.
 */
async function getMockDashboardData(range: DateRangeFilter): Promise<DashboardData> {
  const days = daysForPreset(range.preset);
  const trendSeries = Array.from({ length: days }, (_, idx) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - idx));
    const day = d.toISOString().slice(5, 10);
    const blockers = Math.max(0, Math.round(8 + Math.sin(idx / 4) * 3 + (idx % 7 === 0 ? 4 : 0)));
    const warnings = Math.max(0, Math.round(14 + Math.cos(idx / 5) * 5));
    return { day, blockers, warnings };
  });

  const industrySeries = [
    { industryId: "Healthcare", violations: 38 },
    { industryId: "Finance", violations: 27 },
    { industryId: "Retail", violations: 19 },
    { industryId: "Cross-Industry", violations: 12 },
  ];

  const activeIssues = [
    {
      id: "ISS-1091",
      userId: "u-213",
      repoName: "patient-onboarding-ui",
      tenant: "Tenant B",
      industryId: "Healthcare",
      severity: "BLOCKER" as const,
      ruleName: "HIPAA: PII in Console Logging",
      createdAt: "2026-04-14T12:41:00Z",
      ruleId: "00000000-0000-4000-8000-000000000001",
      contextSnippet: "console.log(\"patient\", patientRecord); // detected PHI in log call",
      isResolved: false,
    },
    {
      id: "ISS-1092",
      userId: "u-844",
      repoName: "claims-api",
      tenant: "Tenant B",
      industryId: "Healthcare",
      severity: "WARNING" as const,
      ruleName: "TypeScript Strictness: Ban any Casts",
      createdAt: "2026-04-14T11:28:00Z",
    },
    {
      id: "ISS-1093",
      userId: "u-402",
      repoName: "payments-dashboard",
      tenant: "Tenant A",
      industryId: "Finance",
      severity: "BLOCKER" as const,
      ruleName: "AWS Access Key ID",
      createdAt: "2026-04-14T09:50:00Z",
    },
    {
      id: "ISS-1094",
      userId: "u-199",
      repoName: "retail-web",
      tenant: "Tenant C",
      industryId: "Retail",
      severity: "WARNING" as const,
      ruleName: "React19: Unnecessary Manual Memoization",
      createdAt: "2026-04-13T18:20:00Z",
    },
  ];

  const blockersTotal = trendSeries.reduce((acc, p) => acc + p.blockers, 0);
  const warningsTotal = trendSeries.reduce((acc, p) => acc + p.warnings, 0);
  const complianceScore = Math.max(52, Math.min(98, 100 - Math.round(blockersTotal * 0.18 + warningsTotal * 0.04)));

  const insights = [
    {
      title: "HIPAA Spike Alert",
      summary: "HIPAA violations increased by 12% in the last 48 hours in Tenant B.",
    },
    {
      title: "Blocker Improvement",
      summary: "Finance blocker volume dropped 9% week-over-week after secret scanning rollout.",
    },
    {
      title: "Action Recommendation",
      summary: "Prioritize user u-213 and repo patient-onboarding-ui to clear highest-impact blockers.",
    },
  ];

  // Simulate cloud latency for React 19 use() + Suspense flow.
  await new Promise((resolve) => setTimeout(resolve, 120));
  return { complianceScore, trendSeries, industrySeries, activeIssues, insights };
}

export async function getDashboardData(range: DateRangeFilter): Promise<DashboardLoadResult> {
  try {
    const data = await fetchLiveDashboardData(range);
    return { data, source: "live" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const data = await getMockDashboardData(range);
    return { data, source: "demo", error: message };
  }
}
