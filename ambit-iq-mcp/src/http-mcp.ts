/**
 * Vercel serverless entry: Streamable HTTP MCP (one Server + Transport per request).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAmbitIqHandlers } from "./handlers.js";
import { AuditStore } from "#audit";

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
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
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
  if (!incomingToken || incomingToken !== expectedToken) {
    rejectUnauthorized(res, "Invalid or missing bearer token.");
    return;
  }

  let parsedBody: unknown;
  if (req.method === "POST") {
    parsedBody = await readJsonBody(req);
  }

  const server = new Server(
    { name: "ambit-iq-governance", version: "2.0.0" },
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
}
