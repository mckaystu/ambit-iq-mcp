import { describe, expect, it, vi } from "vitest";

vi.mock("../services/dashboard.service.js", () => ({
  getAiUsageByTeam: vi.fn(async () => [{ team_id: "t1", interactions: 2 }]),
  getBlockedRiskyCommits: vi.fn(async () => [{ repo: "r1", blocked: 1, risky: 1 }]),
  getComplianceScoreTrend: vi.fn(async () => [{ day: "2026-04-25", score: 99 }]),
  getTopViolatingRepos: vi.fn(async () => [{ repo: "r1", violations: 4 }]),
  getModelUsageByGeography: vi.fn(async () => [{ geography: "ca", count: 2 }]),
  getAuditReadinessScore: vi.fn(async () => ({ score: 95 })),
}));

import { handleDashboardTool } from "./dashboard.handlers.js";

describe("dashboard.handlers", () => {
  it("known tool returns non-null envelope", async () => {
    const res = await handleDashboardTool("get_ai_usage_by_team", {});
    expect(res).not.toBeNull();
    const text = (res as { content: Array<{ text: string }> }).content[0]?.text;
    const parsed = JSON.parse(text);
    expect(parsed.status).toBe("success");
    expect(parsed.tool).toBe("get_ai_usage_by_team");
  });

  it("unknown tool returns null", async () => {
    const res = await handleDashboardTool("not_a_tool", {});
    expect(res).toBeNull();
  });
});
