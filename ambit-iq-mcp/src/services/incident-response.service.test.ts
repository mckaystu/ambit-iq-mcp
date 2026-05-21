import { describe, expect, it } from "vitest";
import {
  addIncidentEvent,
  createIncident,
  getIncidentTimeline,
} from "./incident-response.service.js";

function mockPrisma() {
  const incidents: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  return {
    incident: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `inc-${incidents.length + 1}`, ...data };
        incidents.push(row);
        return row;
      },
      findMany: async () => incidents,
    },
    incidentEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `evt-${events.length + 1}`, ...data };
        events.push(row);
        return row;
      },
      findMany: async () => events as Array<{
        incidentId: string;
        traceId: string | null;
        timestamp: Date;
        eventType: string;
        payload: unknown;
        actorId: string | null;
        repo: string | null;
      }>,
    },
    ambitDecisionLog: {
      findMany: async () => [
        {
          traceId: "11111111-1111-4111-8111-111111111111",
          timestamp: new Date("2026-04-25T11:00:00Z"),
          actorId: "u1",
          decision: false,
          violations: [{ severity: "HIGH" }],
        },
      ],
    },
  };
}

describe("incident-response.service", () => {
  it("create incident", async () => {
    const prisma = mockPrisma();
    const row = await createIncident(
      { title: "Policy spike", severity: "high", traceId: "11111111-1111-4111-8111-111111111111" },
      prisma as never,
    );
    expect(row?.id).toBeTruthy();
    expect(row?.title).toBe("Policy spike");
  });

  it("add event", async () => {
    const prisma = mockPrisma();
    const inc = await createIncident({ title: "IR", severity: "medium" }, prisma as never);
    const evt = await addIncidentEvent(
      { incidentId: String(inc?.id), eventType: "detected", traceId: "11111111-1111-4111-8111-111111111111" },
      prisma as never,
    );
    expect(evt?.id).toBeTruthy();
    expect(evt?.eventType).toBe("detected");
  });

  it("timeline sorts chronologically", async () => {
    const prisma = mockPrisma();
    const inc = await createIncident({ title: "IR2", severity: "high" }, prisma as never);
    await addIncidentEvent(
      {
        incidentId: String(inc?.id),
        eventType: "triaged",
        timestamp: new Date("2026-04-25T12:00:00Z"),
        traceId: "11111111-1111-4111-8111-111111111111",
      },
      prisma as never,
    );
    await addIncidentEvent(
      {
        incidentId: String(inc?.id),
        eventType: "detected",
        timestamp: new Date("2026-04-25T10:00:00Z"),
        traceId: "11111111-1111-4111-8111-111111111111",
      },
      prisma as never,
    );

    const timeline = await getIncidentTimeline(
      { incidentId: String(inc?.id), traceId: "11111111-1111-4111-8111-111111111111" },
      prisma as never,
    );
    expect(timeline.length).toBeGreaterThan(1);
    for (let i = 1; i < timeline.length; i += 1) {
      expect(timeline[i].timestamp.getTime()).toBeGreaterThanOrEqual(
        timeline[i - 1].timestamp.getTime(),
      );
    }
  });
});
