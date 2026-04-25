import "../_load-env";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { esc, graphQuery } from "./_redis";

type NodePayload = {
  key?: string;
  label?: string;
  properties?: Record<string, unknown>;
};

type EdgePayload = {
  from?: string;
  to?: string;
  type?: string;
  properties?: Record<string, unknown>;
};

type EventBody =
  | { event?: "upsert_node"; payload?: NodePayload }
  | { event?: "upsert_edge"; payload?: EdgePayload };

function safeLabel(v: unknown): string {
  const raw = String(v || "Entity");
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "");
  return cleaned || "Entity";
}

function safeRel(v: unknown): string {
  const raw = String(v || "RELATED_TO");
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "");
  return cleaned || "RELATED_TO";
}

function normalizeProps(props?: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props || typeof props !== "object") return out;
  for (const [k, val] of Object.entries(props)) {
    const key = k.replace(/[^A-Za-z0-9_]/g, "");
    if (!key) continue;
    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") out[key] = val;
  }
  return out;
}

function buildSet(alias: "n" | "r", props?: Record<string, unknown>): string {
  const p = normalizeProps(props);
  const assignments = Object.entries(p).map(([k, v]) => {
    if (typeof v === "number") return `${alias}.${k} = ${Number.isFinite(v) ? v : 0}`;
    if (typeof v === "boolean") return `${alias}.${k} = ${v ? "true" : "false"}`;
    return `${alias}.${k} = '${esc(v)}'`;
  });
  if (assignments.length === 0) return "";
  return " SET " + assignments.join(", ");
}

async function runQuery(query: string) {
  await graphQuery(query);
}

async function upsertNode(payload: NodePayload) {
  const key = (payload.key || "").trim();
  if (!key) throw new Error("payload.key is required");
  const label = safeLabel(payload.label || "Entity");
  const q =
    `MERGE (n:Entity {key:'${esc(key)}'}) ` +
    `SET n:${label}, n.updatedAt = timestamp()` +
    buildSet("n", payload.properties);
  await runQuery(q);
}

async function upsertEdge(payload: EdgePayload) {
  const from = (payload.from || "").trim();
  const to = (payload.to || "").trim();
  if (!from || !to) throw new Error("payload.from and payload.to are required");
  const rel = safeRel(payload.type || "RELATED_TO");
  const q =
    `MERGE (a:Entity {key:'${esc(from)}'}) ` +
    `MERGE (b:Entity {key:'${esc(to)}'}) ` +
    `MERGE (a)-[r:${rel}]->(b) ` +
    `SET r.updatedAt = timestamp()` +
    buildSet("r", payload.properties);
  await runQuery(q);
}

function isAuthorized(req: VercelRequest): boolean {
  const token = process.env.GRAPH_SIDECAR_TOKEN?.trim();
  if (!token) return true;
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${token}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const body = (req.body || {}) as EventBody;
  try {
    if (body.event === "upsert_node") {
      await upsertNode(body.payload || {});
      return res.status(200).json({ ok: true, event: body.event });
    }
    if (body.event === "upsert_edge") {
      await upsertEdge(body.payload || {});
      return res.status(200).json({ ok: true, event: body.event });
    }
    return res.status(400).json({ ok: false, error: "Unsupported event type" });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Graph ingest failed",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

