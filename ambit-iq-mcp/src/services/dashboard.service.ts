import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "./audit.service.js";

export interface DashboardFilters {
  startAt?: Date;
  endAt?: Date;
  teamId?: string;
  actorId?: string;
  repo?: string;
  limit?: number;
}

function metadataValue(meta: unknown, ...keys: string[]): string | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const obj = meta as Record<string, unknown>;
  for (const key of keys) {
    const v = obj[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

function matchesCommonFilters(
  row: {
    timestamp?: Date;
    metadata?: unknown;
    actorId?: string | null;
  },
  filters: DashboardFilters,
): boolean {
  if (filters.startAt && row.timestamp && row.timestamp < filters.startAt) return false;
  if (filters.endAt && row.timestamp && row.timestamp > filters.endAt) return false;
  if (filters.actorId && row.actorId && row.actorId !== filters.actorId) return false;
  if (filters.teamId) {
    const team = metadataValue(row.metadata, "team_id", "teamId");
    if (team !== filters.teamId) return false;
  }
  if (filters.repo) {
    const repo = metadataValue(row.metadata, "repo_name", "repoName", "repo");
    if (repo !== filters.repo) return false;
  }
  return true;
}

export async function getAiUsageByTeam(
  filters: DashboardFilters = {},
  prisma?: PrismaClient | null,
): Promise<Array<{ teamId: string; interactions: number; acceptedRate: number | null }>> {
  const client = prisma ?? getPrisma();
  if (!client) return [];
  const rows = await client.agentInteraction.findMany({
    where: {
      ...(filters.startAt || filters.endAt
        ? {
            createdAt: {
              ...(filters.startAt ? { gte: filters.startAt } : {}),
              ...(filters.endAt ? { lte: filters.endAt } : {}),
            },
          }
        : {}),
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.repo ? { repo: filters.repo } : {}),
      ...(filters.teamId ? { teamId: filters.teamId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 2000,
  });

  const buckets = new Map<string, { total: number; accepted: number; decided: number }>();
  for (const r of rows) {
    const team = r.teamId || "unknown";
    const b = buckets.get(team) ?? { total: 0, accepted: 0, decided: 0 };
    b.total += 1;
    if (typeof r.accepted === "boolean") {
      b.decided += 1;
      if (r.accepted) b.accepted += 1;
    }
    buckets.set(team, b);
  }
  return [...buckets.entries()].map(([teamId, b]) => ({
    teamId,
    interactions: b.total,
    acceptedRate: b.decided > 0 ? Number((b.accepted / b.decided).toFixed(4)) : null,
  }));
}

export async function getBlockedRiskyCommits(
  filters: DashboardFilters = {},
  prisma?: PrismaClient | null,
): Promise<Array<{ repo: string; blocked: number; risky: number }>> {
  const client = prisma ?? getPrisma();
  if (!client) return [];

  const rows = await client.ambitDecisionLog.findMany({
    orderBy: { timestamp: "desc" },
    take: filters.limit ?? 5000,
  });

  const byRepo = new Map<string, { blocked: number; risky: number }>();
  for (const row of rows) {
    if (!matchesCommonFilters(row, filters)) continue;
    const repo = metadataValue(row.metadata, "repo_name", "repoName", "repo") || "unknown";
    const b = byRepo.get(repo) ?? { blocked: 0, risky: 0 };
    if (!row.decision) b.blocked += 1;
    const sevHigh = Array.isArray(row.violations)
      ? row.violations.some((v) => {
          const vv = v as Record<string, unknown>;
          const sev = String(vv.severity ?? "").toUpperCase();
          return sev.includes("HIGH") || sev.includes("CRITICAL") || sev.includes("BLOCK");
        })
      : false;
    if (sevHigh) b.risky += 1;
    byRepo.set(repo, b);
  }

  return [...byRepo.entries()].map(([repo, stats]) => ({ repo, ...stats }));
}

export async function getComplianceScoreTrend(
  filters: DashboardFilters = {},
  prisma?: PrismaClient | null,
): Promise<Array<{ day: string; score: number; total: number; blocked: number }>> {
  const client = prisma ?? getPrisma();
  if (!client) return [];

  const rows = await client.ambitDecisionLog.findMany({
    orderBy: { timestamp: "asc" },
    take: filters.limit ?? 5000,
  });

  const buckets = new Map<string, { total: number; blocked: number }>();
  for (const row of rows) {
    if (!matchesCommonFilters(row, filters)) continue;
    const day = row.timestamp.toISOString().slice(0, 10);
    const b = buckets.get(day) ?? { total: 0, blocked: 0 };
    b.total += 1;
    if (!row.decision) b.blocked += 1;
    buckets.set(day, b);
  }

  return [...buckets.entries()].map(([day, b]) => ({
    day,
    score: b.total ? Number((((b.total - b.blocked) / b.total) * 100).toFixed(2)) : 100,
    total: b.total,
    blocked: b.blocked,
  }));
}

export async function getTopViolatingRepos(
  filters: DashboardFilters = {},
  prisma?: PrismaClient | null,
): Promise<Array<{ repo: string; violations: number }>> {
  const client = prisma ?? getPrisma();
  if (!client) return [];
  const rows = await client.ambitDecisionLog.findMany({
    orderBy: { timestamp: "desc" },
    take: filters.limit ?? 5000,
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!matchesCommonFilters(row, filters)) continue;
    const repo = metadataValue(row.metadata, "repo_name", "repoName", "repo") || "unknown";
    const violations = Array.isArray(row.violations) ? row.violations.length : 0;
    counts.set(repo, (counts.get(repo) ?? 0) + violations);
  }
  return [...counts.entries()]
    .map(([repo, violations]) => ({ repo, violations }))
    .sort((a, b) => b.violations - a.violations)
    .slice(0, 20);
}

export async function getModelUsageByGeography(
  filters: DashboardFilters = {},
  prisma?: PrismaClient | null,
): Promise<Array<{ geography: string; count: number }>> {
  const client = prisma ?? getPrisma();
  if (!client) return [];
  const rows = await client.modelUsage.findMany({
    where: {
      ...(filters.startAt || filters.endAt
        ? {
            createdAt: {
              ...(filters.startAt ? { gte: filters.startAt } : {}),
              ...(filters.endAt ? { lte: filters.endAt } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 3000,
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const geography = row.userGeography || row.dataProcessingRegion || row.jurisdiction || "unknown";
    counts.set(geography, (counts.get(geography) ?? 0) + 1);
  }
  return [...counts.entries()].map(([geography, count]) => ({ geography, count }));
}

export async function getAuditReadinessScore(
  filters: DashboardFilters = {},
  prisma?: PrismaClient | null,
): Promise<{
  score: number;
  totals: { logs: number; chained: number; signed: number; interactionsCaptured: number };
}> {
  const client = prisma ?? getPrisma();
  if (!client) {
    return { score: 0, totals: { logs: 0, chained: 0, signed: 0, interactionsCaptured: 0 } };
  }

  const [logs, interactions] = await Promise.all([
    client.ambitDecisionLog.findMany({
      orderBy: { timestamp: "desc" },
      take: filters.limit ?? 5000,
    }),
    client.agentInteraction.findMany({
      orderBy: { createdAt: "desc" },
      take: filters.limit ?? 5000,
    }),
  ]);

  const filteredLogs = logs.filter((l) => matchesCommonFilters(l, filters));
  const totals = {
    logs: filteredLogs.length,
    chained: filteredLogs.filter((l) => Boolean(l.previousHash) && Boolean(l.logHash)).length,
    signed: filteredLogs.filter((l) => Boolean(l.signature)).length,
    interactionsCaptured: interactions.filter((i) => i.promptCaptured || i.responseCaptured).length,
  };

  if (totals.logs === 0) return { score: 0, totals };
  const chainCoverage = totals.chained / totals.logs;
  const signatureCoverage = totals.signed / totals.logs;
  const interactionCoverage = Math.min(1, totals.interactionsCaptured / totals.logs);
  const score = Number(((chainCoverage * 0.4 + signatureCoverage * 0.4 + interactionCoverage * 0.2) * 100).toFixed(2));
  return { score, totals };
}
