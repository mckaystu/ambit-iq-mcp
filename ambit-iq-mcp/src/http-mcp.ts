/**
 * Vercel serverless entry: Streamable HTTP MCP (one Server + Transport per request).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAmbitIqHandlers } from "./handlers.js";
import { AuditStore } from "../lib/auditTrail.js";

function extractBearerToken(req: IncomingMessage): string | null {
  const h = String(req.headers.authorization || "");
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

function rejectUnauthorized(res: ServerResponse, message = "Unauthorized"): void {
  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: message }));
}

function constantTimeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function resolveAllowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  const allowList = String(process.env.MCP_CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowList.includes(origin)) return origin;
  if (process.env.NODE_ENV !== "production") {
    // Local development convenience.
    if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
      return origin;
    }
  }
  return null;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const bodyUnknown = (req as IncomingMessage & { body?: unknown }).body;
  if (bodyUnknown != null && typeof bodyUnknown === "object" && !Buffer.isBuffer(bodyUnknown)) {
    return bodyUnknown;
  }
  if (typeof bodyUnknown === "string") {
    try {
      return JSON.parse(bodyUnknown);
    } catch {
      return undefined;
    }
  }
  const chunks: Buffer[] = [];
  let total = 0;
  const maxBytes = Number(process.env.MCP_MAX_BODY_BYTES || 1_048_576); // 1 MiB default
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBytes) {
      const err = new Error("Payload too large");
      (err as Error & { statusCode?: number }).statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error("Invalid JSON");
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const origin = req.headers.origin;
  const allowedOrigin = resolveAllowedOrigin(origin);
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    [
      "Content-Type",
      "Authorization",
      "Accept",
      "mcp-session-id",
      "Mcp-Session-Id",
      "mcp-protocol-version",
      "Mcp-Protocol-Version",
      "last-event-id",
      "Last-Event-Id",
    ].join(", "),
  );

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const expectedToken = String(process.env.MCP_AUTH_TOKEN || "").trim();
    if (!expectedToken) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: "Server auth misconfigured: MCP_AUTH_TOKEN is not set.",
        }),
      );
      return;
    }
    const incomingToken = extractBearerToken(req);
    if (!incomingToken || !constantTimeEqual(incomingToken, expectedToken)) {
      rejectUnauthorized(res, "Invalid or missing bearer token.");
      return;
    }

    let parsedBody: unknown;
    if (req.method === "POST") {
      parsedBody = await readJsonBody(req);
    }

    const server = new Server(
      { name: "Project Vail", version: "2.0.0" },
      { capabilities: { tools: {} } },
    );
    const auditStore = new AuditStore();
    registerAmbitIqHandlers(server, { auditStore });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    await transport.handleRequest(req, res, parsedBody);
  } catch (err) {
    console.error("[ambit-http-mcp]", err);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const statusCode =
      typeof (err as { statusCode?: unknown })?.statusCode === "number"
        ? Number((err as { statusCode?: number }).statusCode)
        : 500;
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const body =
      process.env.NODE_ENV === "production"
        ? { error: "MCP handler failed" }
        : { error: "MCP handler failed", message: err instanceof Error ? err.message : String(err) };
    res.end(JSON.stringify(body));
  }
}
