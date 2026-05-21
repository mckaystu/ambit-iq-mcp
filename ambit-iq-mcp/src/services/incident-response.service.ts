import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "./audit.service.js";

export interface CreateIncidentInput {
  title: string;
  description?: string;
  severity: string;
  status?: string;
  traceId?: string;
  repo?: string;
  actorId?: string;
  teamId?: string;
  metadata?: Record<string, unknown>;
}

export interface AddIncidentEventInput {
  incidentId: string;
  traceId?: string;
  timestamp?: Date;
  eventType: string;
  actorId?: string;
  repo?: string;
  commitSha?: string;
  prNumber?: string;
  payload?: Record<string, unknown>;
}

export type IncidentTimelineItem =
  | {
      source: "incident_event";
      timestamp: Date;
      incidentId: string;
      eventType: string;
      payload: Record<string, unknown>;
      actorId?: string | null;
      repo?: string | null;
    }
  | {
      source: "decision_log";
      timestamp: Date;
      traceId: string;
      actorId: string;
      decision: boolean;
      violations: unknown;
    };

export async function createIncident(input: CreateIncidentInput, prisma?: PrismaClient | null) {
  const client = prisma ?? getPrisma();
  if (!client) return null;
  return client.incident.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      severity: input.severity,
      status: input.status ?? "open",
      traceId: input.traceId ?? null,
      repo: input.repo ?? null,
      actorId: input.actorId ?? null,
      teamId: input.teamId ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
  });
}

export async function addIncidentEvent(input: AddIncidentEventInput, prisma?: PrismaClient | null) {
  const client = prisma ?? getPrisma();
  if (!client) return null;
  return client.incidentEvent.create({
    data: {
      incidentId: input.incidentId,
      traceId: input.traceId ?? null,
      timestamp: input.timestamp ?? new Date(),
      eventType: input.eventType,
      actorId: input.actorId ?? null,
      repo: input.repo ?? null,
      commitSha: input.commitSha ?? null,
      prNumber: input.prNumber ?? null,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export async function getIncidentTimeline(
  filters: {
    incidentId?: string;
    traceId?: string;
    limit?: number;
  },
  prisma?: PrismaClient | null,
): Promise<IncidentTimelineItem[]> {
  const client = prisma ?? getPrisma();
  if (!client) return [];
  const limit = filters.limit ?? 200;

  const events = await client.incidentEvent.findMany({
    where: {
      ...(filters.incidentId ? { incidentId: filters.incidentId } : {}),
      ...(filters.traceId ? { traceId: filters.traceId } : {}),
    },
    orderBy: { timestamp: "desc" },
    take: limit,
  });

  const traceIds = new Set<string>();
  for (const event of events) {
    if (event.traceId) traceIds.add(event.traceId);
  }
  if (filters.traceId) traceIds.add(filters.traceId);

  const logs =
    traceIds.size > 0
      ? await client.ambitDecisionLog.findMany({
          where: { traceId: { in: [...traceIds] } },
          orderBy: { timestamp: "desc" },
          take: limit,
        })
      : [];

  const merged: IncidentTimelineItem[] = [
    ...events.map((e) => ({
      source: "incident_event" as const,
      timestamp: e.timestamp,
      incidentId: e.incidentId,
      eventType: e.eventType,
      payload: (e.payload ?? {}) as Record<string, unknown>,
      actorId: e.actorId,
      repo: e.repo,
    })),
    ...logs.map((l) => ({
      source: "decision_log" as const,
      timestamp: l.timestamp,
      traceId: l.traceId,
      actorId: l.actorId,
      decision: l.decision,
      violations: l.violations,
    })),
  ];

  merged.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return merged;
}

export async function searchIncidents(
  filters: {
    incidentId?: string;
    status?: string;
    severity?: string;
    repo?: string;
    actorId?: string;
    traceId?: string;
    limit?: number;
  },
  prisma?: PrismaClient | null,
) {
  const client = prisma ?? getPrisma();
  if (!client) return [];
  return client.incident.findMany({
    where: {
      ...(filters.incidentId ? { id: filters.incidentId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.severity ? { severity: filters.severity } : {}),
      ...(filters.repo ? { repo: filters.repo } : {}),
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.traceId ? { traceId: filters.traceId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 100,
  });
}
