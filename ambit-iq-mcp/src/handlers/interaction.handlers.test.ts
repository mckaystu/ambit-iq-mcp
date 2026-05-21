import { describe, expect, it, vi } from "vitest";

vi.mock("../services/prompt-capture.service.js", () => ({
  captureAgentInteraction: vi.fn(async () => ({ mode: "postgres", recordId: "int-1" })),
  getInteractionById: vi.fn(async () => ({ id: "int-1" })),
  searchInteractions: vi.fn(async () => [{ id: "int-1", agentName: "agent", accepted: true }]),
}));

import { handleInteractionTool } from "./interaction.handlers.js";

describe("interaction.handlers", () => {
  it("known tool returns non-null response", async () => {
    const res = await handleInteractionTool("capture_agent_interaction", { agent_name: "agent-1", trace_id: "t" });
    expect(res).not.toBeNull();
    const parsed = JSON.parse((res as { content: Array<{ text: string }> }).content[0]?.text);
    expect(parsed.status).toBe("success");
  });

  it("validation error returns envelope", async () => {
    const res = await handleInteractionTool("get_agent_interaction", {});
    const parsed = JSON.parse((res as { content: Array<{ text: string }> }).content[0]?.text);
    expect(parsed.status).toBe("error");
  });

  it("unknown tool returns null", async () => {
    const res = await handleInteractionTool("unknown_interaction_tool", {});
    expect(res).toBeNull();
  });
});
