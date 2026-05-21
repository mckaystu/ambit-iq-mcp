import { randomUUID } from "node:crypto";

export type PersistenceMode = "postgres" | "fallback_json" | "none";

export interface ResponsePersistence {
  mode: PersistenceMode;
  record_ids: string[];
  fallback_path: string | null;
  reason: string | null;
}

export interface ResponseEnvelope<T = Record<string, unknown>> {
  status: "success" | "error";
  tool: string;
  trace_id: string;
  generated_at: string;
  data: T;
  summary: string;
  errors: string[];
  warnings: string[];
  artifacts: string[];
  persistence: ResponsePersistence;
}

export interface ResponseExtra {
  trace_id?: string;
  errors?: string[];
  warnings?: string[];
  artifacts?: string[];
  persistence?: Partial<ResponsePersistence>;
}

function buildPersistence(extra?: ResponseExtra): ResponsePersistence {
  return {
    mode: extra?.persistence?.mode ?? "none",
    record_ids: extra?.persistence?.record_ids ?? [],
    fallback_path: extra?.persistence?.fallback_path ?? null,
    reason: extra?.persistence?.reason ?? null,
  };
}

export function successResponse<T = Record<string, unknown>>(
  tool: string,
  data: T,
  summary: string,
  extra?: ResponseExtra,
): ResponseEnvelope<T> {
  return {
    status: "success",
    tool,
    trace_id: extra?.trace_id ?? randomUUID(),
    generated_at: new Date().toISOString(),
    data,
    summary,
    errors: extra?.errors ?? [],
    warnings: extra?.warnings ?? [],
    artifacts: extra?.artifacts ?? [],
    persistence: buildPersistence(extra),
  };
}

export function errorResponse(
  tool: string,
  message: string,
  extra?: ResponseExtra,
): ResponseEnvelope<Record<string, never>> {
  return {
    status: "error",
    tool,
    trace_id: extra?.trace_id ?? randomUUID(),
    generated_at: new Date().toISOString(),
    data: {},
    summary: message,
    errors: extra?.errors ?? [message],
    warnings: extra?.warnings ?? [],
    artifacts: extra?.artifacts ?? [],
    persistence: buildPersistence(extra),
  };
}
