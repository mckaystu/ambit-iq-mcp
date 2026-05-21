import { describe, expect, it } from "vitest";
import {
  getBlockedRiskyCommits,
  getComplianceScoreTrend,
  getTopViolatingRepos,
} from "./dashboard.service.js";

function mockPrisma() {
  return {
    ambitDecisionLog: {
      findMany: async () => [
        {
          timestamp: new Date("2026-04-24T10:00:00Z"),
          decision: false,
          actorId: "u1",
          metadata: { repo_name: "repo-a", team_id: "team-1" },
          violations: [{ severity: "HIGH" }, { severity: "LOW" }],
          signature: "sig",
          previousHash: "p",
          logHash: "h",
        },
        {
          timestamp: new Date("2026-04-24T12:00:00Z"),
          decision: true,
          actorId: "u2",
          metadata: {},
          violations: [],
          signature: null,
          previousHash: null,
          logHash: null,
        },
      ],
    },
    agentInteraction: {
      findMany: async () => [],
    },
    modelUsage: {
      findMany: async () => [],
    },
  } as unknown as Parameters<typeof getComplianceScoreTrend>[1];
}

describe("dashboard.service", () => {
  it("compliance score trend returns data", async () => {
    const rows = await getComplianceScoreTrend({}, mockPrisma());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.score).toBeTypeOf("number");
  });

  it("missing metadata handled", async () => {
    const repos = await getTopViolatingRepos({}, mockPrisma());
    expect(repos.some((r) => r.repo === "unknown")).toBe(true);
  });

  it("blocked commits aggregates safely", async () => {
    const stats = await getBlockedRiskyCommits({}, mockPrisma());
    const repoA = stats.find((x) => x.repo === "repo-a");
    expect(repoA?.blocked).toBe(1);
    expect(repoA?.risky).toBe(1);
  });
});
