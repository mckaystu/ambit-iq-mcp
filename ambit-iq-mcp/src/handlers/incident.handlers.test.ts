import { describe, expect, it, vi } from "vitest";

vi.mock("../services/incident-response.service.js", () => ({
  createIncident: vi.fn(async () => ({ id: "i1", title: "test" })),
  addIncidentEvent: vi.fn(async () => ({ id: "e1", incidentId: "i1" })),
  searchIncidents: vi.fn(async () => [{ id: "i1", title: "test", description: "desc" }]),
  getIncidentTimeline: vi.fn(async () => [{ source: "incident_event", timestamp: new Date("2026-01-01T00:00:00Z") }]),
}));

import { handleIncidentTool } from "./incident.handlers.js";

describe("incident.handlers", () => {
  it("known tool returns non-null response", async () => {
    const res = await handleIncidentTool("create_incident", { title: "x", severity: "HIGH" });
    expect(res).not.toBeNull();
    const parsed = JSON.parse((res as { content: Array<{ text: string }> }).content[0]?.text);
    expect(parsed.status).toBe("success");
  });

  it("timeline requires one selector", async () => {
    const res = await handleIncidentTool("get_incident_timeline", {});
    const parsed = JSON.parse((res as { content: Array<{ text: string }> }).content[0]?.text);
    expect(parsed.status).toBe("error");
  });

  it("unknown tool returns null", async () => {
    const res = await handleIncidentTool("unknown_incident_tool", {});
    expect(res).toBeNull();
  });
});
