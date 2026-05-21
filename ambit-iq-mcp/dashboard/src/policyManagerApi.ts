/** JSON bodies for `/api/policy-manager` — shared by PolicyManager and tests. */

import { apiPath } from "./apiBase";

export type PolicyManagerResult =
  | { ok: true; status: number; data: Record<string, unknown> }
  | { ok: false; status: number; error: string };

function formatNonJsonApiError(status: number, body: string): string {
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 160);
  const hint =
    status === 0 || status >= 500
      ? " Start the dashboard API with `npm run dev:api` (port 3000) or `npx vercel dev --listen 3000` in ambit-iq-mcp/dashboard. Do not point VITE_DASHBOARD_API_BASE at another app on port 3001."
      : "";
  return `API returned non-JSON (${status}): ${snippet || "empty body"}.${hint}`;
}

/** POST `/api/policy-manager` and parse JSON safely (avoids opaque res.json() failures). */
export async function postPolicyManager(body: Record<string, unknown>): Promise<PolicyManagerResult> {
  let res: Response;
  try {
    res = await fetch(apiPath("/api/policy-manager"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 0,
      error: `${msg}. Is the dashboard API running on port 3000?`,
    };
  }

  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return { ok: false, status: res.status, error: formatNonJsonApiError(res.status, text) };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: String(data.error || `Request failed (${res.status})`),
    };
  }
  return { ok: true, status: res.status, data };
}

export function buildGenerateRequest(intent: string, viml?: string) {
  return {
    action: "generate" as const,
    intent,
    ...(viml?.trim() ? { viml } : {}),
  };
}

export function buildVimlPreviewRequest(viml: string, sample_code?: string) {
  return {
    action: "viml-preview" as const,
    viml,
    ...(sample_code !== undefined && sample_code !== "" ? { sample_code } : {}),
  };
}

export function buildDeployShadowRequest(fields: {
  original_intent: string;
  rego_code: string;
  rule_name: string;
  rule_logic: Record<string, unknown>;
  viml?: string;
}) {
  const { original_intent, rego_code, rule_name, rule_logic, viml } = fields;
  return {
    action: "deploy-shadow" as const,
    original_intent,
    rego_code,
    rule_name: rule_name || "Untitled shadow rule",
    rule_logic,
    ...(viml?.trim() ? { viml } : {}),
  };
}

export function buildShadowImpactRequest(fields: {
  rego_code: string;
  hours?: number;
  viml?: string;
  enforce_patterns?: unknown[];
}) {
  const { rego_code, hours = 24, viml, enforce_patterns } = fields;
  return {
    action: "shadow-impact" as const,
    rego_code,
    hours,
    ...(viml?.trim() ? { viml } : {}),
    ...(enforce_patterns != null ? { enforce_patterns } : {}),
  };
}
