/**
 * Vercel serverless entry: stateless Streamable HTTP MCP (one Server + Transport per request).
 * Public URL: https://<deployment>/mcp (see vercel.json rewrite).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAmbitIqHandlers } from "../lib/handlers.js";
import { AuditStore } from "../lib/auditTrail.js";

function extractBearerToken(req) {
  const h = String(req.headers.authorization || "");
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

function rejectUnauthorized(res, message = "Unauthorized") {
  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: message }));
}

async function readJsonBody(req) {
  if (req.body != null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return undefined;
    }
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export default async function handler(req, res) {
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

  // Simple bearer auth gate for production edge deployments.
  // Set MCP_AUTH_TOKEN in Vercel env vars.
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

  let parsedBody;
  if (req.method === "POST") {
    parsedBody = await readJsonBody(req);
  }

  const server = new Server(
    { name: "ambit-iq-governance", version: "1.0.0" },
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
