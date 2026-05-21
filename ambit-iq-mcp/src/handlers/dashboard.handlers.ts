import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  getAiUsageByTeam,
  getAuditReadinessScore,
  getBlockedRiskyCommits,
  getComplianceScoreTrend,
  getModelUsageByGeography,
  getTopViolatingRepos,
} from "../services/dashboard.service.js";
import { errorResponse, successResponse } from "../services/response-contract.service.js";

const SharedFilterSchema = z
  .object({
    date_from: z.string().optional(),
    date_to: z.string().optional(),
    team_id: z.string().optional(),
    repo: z.string().optional(),
    environment: z.string().optional(),
    policy_profile: z.string().optional(),
    geography: z.string().optional(),
    model_provider: z.string().optional(),
    model_name: z.string().optional(),
  })
  .passthrough();

function parseDate(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function mkContent(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

async function runOne(name: string, parsed: z.infer<typeof SharedFilterSchema>) {
  const filters = {
    startAt: parseDate(parsed.date_from),
    endAt: parseDate(parsed.date_to),
    teamId: parsed.team_id,
    repo: parsed.repo,
  };
  switch (name) {
    case "get_ai_usage_by_team":
      return { ai_usage_by_team: await getAiUsageByTeam(filters) };
    case "get_blocked_risky_commits":
      return { blocked_risky_commits: await getBlockedRiskyCommits(filters) };
    case "get_compliance_score_trend":
      return { compliance_score_trend: await getComplianceScoreTrend(filters) };
    case "get_top_violating_repos":
      return { top_violating_repos: await getTopViolatingRepos(filters) };
    case "get_model_usage_by_geography":
      return { model_usage_by_geography: await getModelUsageByGeography(filters) };
    case "get_audit_readiness_score":
      return { audit_readiness_score: await getAuditReadinessScore(filters) };
    default:
      return null;
  }
}

export const DASHBOARD_TOOLS: Tool[] = [
  {
    name: "get_executive_dashboard",
    description:
      "Returns executive dashboard sections: AI usage, risky commits, compliance trend, violating repos, model geography usage, and audit readiness.",
    inputSchema: {
      type: "object",
      properties: {
        date_from: { type: "string" },
        date_to: { type: "string" },
        team_id: { type: "string" },
        repo: { type: "string" },
        environment: { type: "string" },
        policy_profile: { type: "string" },
        geography: { type: "string" },
        model_provider: { type: "string" },
        model_name: { type: "string" },
      },
    },
  },
  ...([
    "get_ai_usage_by_team",
    "get_blocked_risky_commits",
    "get_compliance_score_trend",
    "get_top_violating_repos",
    "get_model_usage_by_geography",
    "get_audit_readiness_score",
  ].map((name) => ({
    name,
    description: `Executive dashboard section: ${name.replaceAll("_", " ")}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        date_from: { type: "string" },
        date_to: { type: "string" },
        team_id: { type: "string" },
        repo: { type: "string" },
        environment: { type: "string" },
        policy_profile: { type: "string" },
        geography: { type: "string" },
        model_provider: { type: "string" },
        model_name: { type: "string" },
      },
    },
  })) as Tool[]),
];

export async function handleDashboardTool(name: string, args: unknown) {
  const known = new Set(DASHBOARD_TOOLS.map((t) => t.name));
  if (!known.has(name)) return null;
  const parsed = SharedFilterSchema.safeParse((args ?? {}) as Record<string, unknown>);
  if (!parsed.success) {
    return mkContent(errorResponse(name, "Invalid dashboard filters.", { errors: parsed.error.issues.map((i) => i.message) }));
  }
  if (name === "get_executive_dashboard") {
    const parts = await Promise.all([
      runOne("get_ai_usage_by_team", parsed.data),
      runOne("get_blocked_risky_commits", parsed.data),
      runOne("get_compliance_score_trend", parsed.data),
      runOne("get_top_violating_repos", parsed.data),
      runOne("get_model_usage_by_geography", parsed.data),
      runOne("get_audit_readiness_score", parsed.data),
    ]);
    const data = Object.assign({}, ...parts);
    return mkContent(successResponse(name, data, "Executive dashboard data computed."));
  }
  const piece = await runOne(name, parsed.data);
  return mkContent(successResponse(name, piece ?? {}, "Dashboard metric computed."));
}
