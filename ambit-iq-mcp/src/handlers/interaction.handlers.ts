import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  captureAgentInteraction,
  getInteractionById,
  searchInteractions,
} from "../services/prompt-capture.service.js";
import { errorResponse, successResponse } from "../services/response-contract.service.js";

const CaptureSchema = z.object({
  trace_id: z.string().optional(),
  traceId: z.string().optional(),
  decisionLogId: z.string().optional(),
  session_id: z.string().optional(),
  actor_id: z.string().optional(),
  team_id: z.string().optional(),
  agent_name: z.string().min(1),
  agent_version: z.string().optional(),
  workspace_id: z.string().optional(),
  repo: z.string().optional(),
  branch: z.string().optional(),
  commit_sha: z.string().optional(),
  pr_number: z.string().optional(),
  prompt: z.string().optional(),
  response: z.string().optional(),
  proposed_code: z.string().optional(),
  final_code: z.string().optional(),
  accepted: z.boolean().optional(),
  capturePolicy: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const GetSchema = z.object({
  interaction_id: z.string().min(1),
});

const SearchSchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  trace_id: z.string().optional(),
  actor_id: z.string().optional(),
  team_id: z.string().optional(),
  repo: z.string().optional(),
  agent_name: z.string().optional(),
  accepted: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const mk = (obj: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] });

export const INTERACTION_TOOLS: Tool[] = [
  {
    name: "capture_agent_interaction",
    description: "Capture prompt/response/code interaction with redaction, hash, and truncation support.",
    inputSchema: { type: "object", properties: { agent_name: { type: "string" } }, required: ["agent_name"] },
  },
  {
    name: "get_agent_interaction",
    description: "Fetch a single captured interaction by id.",
    inputSchema: { type: "object", properties: { interaction_id: { type: "string" } }, required: ["interaction_id"] },
  },
  {
    name: "search_agent_interactions",
    description: "Search interaction records by trace/user/repo/team/agent and date range.",
    inputSchema: { type: "object", properties: {} },
  },
];

export async function handleInteractionTool(name: string, args: unknown) {
  if (!INTERACTION_TOOLS.some((t) => t.name === name)) return null;

  if (name === "capture_agent_interaction") {
    const parsed = CaptureSchema.safeParse(args ?? {});
    if (!parsed.success) return mk(errorResponse(name, "Invalid interaction payload.", { errors: parsed.error.issues.map((i) => i.message) }));
    const i = parsed.data;
    const traceId = String(i.trace_id ?? i.traceId ?? "").trim();
    const row = await captureAgentInteraction({
      traceId: traceId || "00000000-0000-4000-8000-000000000000",
      decisionLogId: i.decisionLogId,
      sessionId: i.session_id,
      actorId: i.actor_id,
      teamId: i.team_id,
      agentName: i.agent_name,
      agentVersion: i.agent_version,
      workspaceId: i.workspace_id,
      repo: i.repo,
      branch: i.branch,
      commitSha: i.commit_sha,
      prNumber: i.pr_number,
      prompt: i.prompt,
      response: i.response,
      proposedCode: i.proposed_code,
      finalCode: i.final_code,
      accepted: i.accepted,
      capturePolicy: i.capturePolicy,
      metadata: i.metadata,
    });
    return mk(
      successResponse(
        name,
        { interaction: row },
        "Agent interaction captured.",
        {
          warnings: traceId ? [] : ["trace_id missing; used placeholder trace id for compatibility."],
          persistence: { mode: row.mode === "postgres" ? "postgres" : "none", record_ids: row.recordId ? [row.recordId] : [] },
        },
      ),
    );
  }

  if (name === "get_agent_interaction") {
    const parsed = GetSchema.safeParse(args ?? {});
    if (!parsed.success) return mk(errorResponse(name, "interaction_id is required.", { errors: parsed.error.issues.map((i) => i.message) }));
    const row = await getInteractionById(parsed.data.interaction_id);
    return mk(successResponse(name, { interaction: row }, row ? "Interaction fetched." : "No interaction found."));
  }

  if (name === "search_agent_interactions") {
    const parsed = SearchSchema.safeParse(args ?? {});
    if (!parsed.success) return mk(errorResponse(name, "Invalid interaction search filters.", { errors: parsed.error.issues.map((i) => i.message) }));
    let rows = await searchInteractions({
      traceId: parsed.data.trace_id,
      actorId: parsed.data.actor_id,
      teamId: parsed.data.team_id,
      repo: parsed.data.repo,
      since: parsed.data.date_from ? new Date(parsed.data.date_from) : undefined,
      until: parsed.data.date_to ? new Date(parsed.data.date_to) : undefined,
      limit: parsed.data.limit,
    });
    if (parsed.data.agent_name) rows = rows.filter((r) => r.agentName === parsed.data.agent_name);
    if (typeof parsed.data.accepted === "boolean") rows = rows.filter((r) => r.accepted === parsed.data.accepted);
    return mk(successResponse(name, { interactions: rows }, "Interaction search complete."));
  }

  return null;
}
