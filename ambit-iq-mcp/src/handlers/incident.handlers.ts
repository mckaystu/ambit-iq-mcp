import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  addIncidentEvent,
  createIncident,
  getIncidentTimeline,
  searchIncidents,
} from "../services/incident-response.service.js";
import { errorResponse, successResponse } from "../services/response-contract.service.js";

const CreateIncidentSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  severity: z.string().min(1),
  status: z.string().optional(),
  trace_id: z.string().optional(),
  repo: z.string().optional(),
  actor_id: z.string().optional(),
  team_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const AddIncidentEventSchema = z.object({
  incident_id: z.string().min(1),
  event_type: z.string().min(1),
  timestamp: z.string().optional(),
  trace_id: z.string().optional(),
  actor_id: z.string().optional(),
  repo: z.string().optional(),
  commit_sha: z.string().optional(),
  pr_number: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const SearchSchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  repo: z.string().optional(),
  actor_id: z.string().optional(),
  team_id: z.string().optional(),
  severity: z.string().optional(),
  status: z.string().optional(),
  trace_id: z.string().optional(),
  keyword: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const TimelineSchema = z.object({
  incident_id: z.string().optional(),
  trace_id: z.string().optional(),
  repo: z.string().optional(),
  actor_id: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const mk = (obj: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] });
const dateOr = (v?: string) => (v ? new Date(v) : undefined);

export const INCIDENT_TOOLS: Tool[] = [
  {
    name: "create_incident",
    description: "Create a new governance/security incident.",
    inputSchema: { type: "object", properties: { title: { type: "string" }, severity: { type: "string" } }, required: ["title", "severity"] },
  },
  {
    name: "add_incident_event",
    description: "Append an event to an incident timeline.",
    inputSchema: { type: "object", properties: { incident_id: { type: "string" }, event_type: { type: "string" } }, required: ["incident_id", "event_type"] },
  },
  {
    name: "search_incidents",
    description: "Search incidents by status/severity/repo/actor/trace.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_incident_timeline",
    description: "Get timeline from incident events plus matching decision logs.",
    inputSchema: { type: "object", properties: {} },
  },
];

export async function handleIncidentTool(name: string, args: unknown) {
  if (!INCIDENT_TOOLS.some((t) => t.name === name)) return null;

  if (name === "create_incident") {
    const parsed = CreateIncidentSchema.safeParse(args ?? {});
    if (!parsed.success) return mk(errorResponse(name, "Invalid incident payload.", { errors: parsed.error.issues.map((i) => i.message) }));
    const row = await createIncident({
      title: parsed.data.title,
      description: parsed.data.description,
      severity: parsed.data.severity,
      status: parsed.data.status,
      traceId: parsed.data.trace_id,
      repo: parsed.data.repo,
      actorId: parsed.data.actor_id,
      teamId: parsed.data.team_id,
      metadata: parsed.data.metadata,
    });
    return mk(successResponse(name, { incident: row }, "Incident created."));
  }

  if (name === "add_incident_event") {
    const parsed = AddIncidentEventSchema.safeParse(args ?? {});
    if (!parsed.success) return mk(errorResponse(name, "Invalid incident event payload.", { errors: parsed.error.issues.map((i) => i.message) }));
    const row = await addIncidentEvent({
      incidentId: parsed.data.incident_id,
      eventType: parsed.data.event_type,
      timestamp: dateOr(parsed.data.timestamp),
      traceId: parsed.data.trace_id,
      actorId: parsed.data.actor_id,
      repo: parsed.data.repo,
      commitSha: parsed.data.commit_sha,
      prNumber: parsed.data.pr_number,
      payload: parsed.data.payload,
    });
    return mk(successResponse(name, { event: row }, "Incident event added."));
  }

  if (name === "search_incidents") {
    const parsed = SearchSchema.safeParse(args ?? {});
    if (!parsed.success) return mk(errorResponse(name, "Invalid incident search filters.", { errors: parsed.error.issues.map((i) => i.message) }));
    const rows = await searchIncidents({
      status: parsed.data.status,
      severity: parsed.data.severity,
      repo: parsed.data.repo,
      actorId: parsed.data.actor_id,
      traceId: parsed.data.trace_id,
      limit: parsed.data.limit,
    });
    const keyword = String(parsed.data.keyword ?? "").trim().toLowerCase();
    const filtered = keyword
      ? rows.filter((r) => `${r.title} ${r.description ?? ""}`.toLowerCase().includes(keyword))
      : rows;
    return mk(successResponse(name, { incidents: filtered }, "Incident search complete."));
  }

  if (name === "get_incident_timeline") {
    const parsed = TimelineSchema.safeParse(args ?? {});
    if (!parsed.success) return mk(errorResponse(name, "Invalid timeline filters.", { errors: parsed.error.issues.map((i) => i.message) }));
    if (!parsed.data.incident_id && !parsed.data.trace_id && !parsed.data.repo && !parsed.data.actor_id) {
      return mk(errorResponse(name, "At least one of incident_id, trace_id, repo, actor_id is required."));
    }
    const timeline = await getIncidentTimeline({
      incidentId: parsed.data.incident_id,
      traceId: parsed.data.trace_id,
      limit: parsed.data.limit,
    });
    const narrowed = timeline.filter((item) => {
      if (parsed.data.date_from && item.timestamp < new Date(parsed.data.date_from)) return false;
      if (parsed.data.date_to && item.timestamp > new Date(parsed.data.date_to)) return false;
      if (parsed.data.repo && "repo" in item && item.repo && item.repo !== parsed.data.repo) return false;
      if (parsed.data.actor_id && "actorId" in item && item.actorId && item.actorId !== parsed.data.actor_id) return false;
      return true;
    });
    return mk(successResponse(name, { timeline: narrowed }, "Incident timeline assembled."));
  }

  return null;
}
