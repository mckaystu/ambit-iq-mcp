import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "./audit.service.js";

export interface RedactOptions {
  maxLength?: number;
}

export interface CaptureAgentInteractionInput {
  traceId: string;
  decisionLogId?: string;
  sessionId?: string;
  actorId?: string;
  teamId?: string;
  agentName: string;
  agentVersion?: string;
  workspaceId?: string;
  repo?: string;
  branch?: string;
  commitSha?: string;
  prNumber?: string;
  prompt?: string;
  response?: string;
  proposedCode?: string;
  finalCode?: string;
  accepted?: boolean;
  capturePolicy?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface CaptureAgentInteractionResult {
  persisted: boolean;
  mode: "postgres" | "none";
  recordId?: string;
  data: Record<string, unknown>;
}

const AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi;
const ASSIGNMENT_SECRET =
  /\b(password|passwd|pwd|token|api[_-]?key|secret)\b\s*[:=]\s*(['"]?)[^\s'";,]{6,}\2/gi;
const PRIVATE_KEY_BLOCK =
  /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g;

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function redactSensitiveContent(content: string, options: RedactOptions = {}): {
  redacted: string;
  truncated: boolean;
  charCount: number;
} {
  const charCount = content.length;
  const maxLength = options.maxLength ?? 8000;
  let redacted = content
    .replace(AWS_ACCESS_KEY, "[REDACTED_AWS_ACCESS_KEY]")
    .replace(BEARER_TOKEN, "Bearer [REDACTED_TOKEN]")
    .replace(PRIVATE_KEY_BLOCK, "[REDACTED_PRIVATE_KEY]")
    .replace(ASSIGNMENT_SECRET, (_m, label: string) => `${label}=[REDACTED_SECRET]`);

  let truncated = false;
  if (redacted.length > maxLength) {
    redacted = `${redacted.slice(0, maxLength - 1)}…`;
    truncated = true;
  }
  return { redacted, truncated, charCount };
}

export async function captureAgentInteraction(
  input: CaptureAgentInteractionInput,
  prisma?: PrismaClient | null,
): Promise<CaptureAgentInteractionResult> {
  const promptData = input.prompt ? redactSensitiveContent(input.prompt) : null;
  const responseData = input.response ? redactSensitiveContent(input.response) : null;
  const proposedData = input.proposedCode ? redactSensitiveContent(input.proposedCode) : null;
  const finalData = input.finalCode ? redactSensitiveContent(input.finalCode) : null;
  const codeHashSource = [proposedData?.redacted ?? "", finalData?.redacted ?? ""].join("::");

  const createData = {
    traceId: input.traceId,
    decisionLogId: input.decisionLogId ?? null,
    sessionId: input.sessionId ?? null,
    actorId: input.actorId ?? null,
    teamId: input.teamId ?? null,
    agentName: input.agentName,
    agentVersion: input.agentVersion ?? null,
    workspaceId: input.workspaceId ?? null,
    repo: input.repo ?? null,
    branch: input.branch ?? null,
    commitSha: input.commitSha ?? null,
    prNumber: input.prNumber ?? null,
    promptCaptured: Boolean(promptData),
    promptRedacted: promptData?.redacted ?? null,
    promptHash: input.prompt ? hashContent(input.prompt) : null,
    promptCharCount: promptData?.charCount ?? null,
    promptTruncated: promptData?.truncated ?? false,
    responseCaptured: Boolean(responseData),
    responseRedacted: responseData?.redacted ?? null,
    responseHash: input.response ? hashContent(input.response) : null,
    responseCharCount: responseData?.charCount ?? null,
    responseTruncated: responseData?.truncated ?? false,
    proposedCodeRedacted: proposedData?.redacted ?? null,
    finalCodeRedacted: finalData?.redacted ?? null,
    codeHash: codeHashSource !== "::" ? hashContent(codeHashSource) : null,
    accepted: input.accepted ?? null,
    capturePolicy: (input.capturePolicy ?? {}) as Prisma.InputJsonValue,
    metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
  };

  const client = prisma ?? getPrisma();
  if (!client) {
    return {
      persisted: false,
      mode: "none",
      data: createData,
    };
  }

  const row = await client.agentInteraction.create({ data: createData });
  return {
    persisted: true,
    mode: "postgres",
    recordId: row.id,
    data: createData,
  };
}

export async function getInteractionById(id: string, prisma?: PrismaClient | null) {
  const client = prisma ?? getPrisma();
  if (!client) return null;
  return client.agentInteraction.findUnique({ where: { id } });
}

export async function searchInteractions(
  filters: {
    traceId?: string;
    actorId?: string;
    repo?: string;
    sessionId?: string;
    teamId?: string;
    since?: Date;
    until?: Date;
    limit?: number;
  },
  prisma?: PrismaClient | null,
) {
  const client = prisma ?? getPrisma();
  if (!client) return [];
  return client.agentInteraction.findMany({
    where: {
      ...(filters.traceId ? { traceId: filters.traceId } : {}),
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.repo ? { repo: filters.repo } : {}),
      ...(filters.sessionId ? { sessionId: filters.sessionId } : {}),
      ...(filters.teamId ? { teamId: filters.teamId } : {}),
      ...(filters.since || filters.until
        ? {
            createdAt: {
              ...(filters.since ? { gte: filters.since } : {}),
              ...(filters.until ? { lte: filters.until } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 100,
  });
}
