import { createServer } from "node:http";
import { URL } from "node:url";

import authSession from "./auth/session";
import librariesDiscover from "./libraries/discover";
import librariesIndex from "./libraries/index";
import librariesTestConnection from "./libraries/test-connection";
import librariesTestContenthandler from "./libraries/test-contenthandler";
import graphEvents from "./graph/events";
import graphHealth from "./graph/health";
import graphSubgraph from "./graph/subgraph";
import graphSyncWcmHierarchy from "./graph/sync-wcm-hierarchy";
import graphIngest from "./graph/ingest";
import deadWoodReport from "./reports/dead-wood";
import scanContinue from "./scan/continue";
import scanStart from "./scan/start";
import scanStatus from "./scan/status";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

const PORT = Number(process.env.LOCAL_API_PORT || 8787);

const routes: Record<string, Handler> = {
  "POST /api/auth/session": authSession,
  "GET /api/libraries": librariesIndex,
  "POST /api/libraries": librariesIndex,
  "POST /api/libraries/discover": librariesDiscover,
  "POST /api/libraries/test-connection": librariesTestConnection,
  "POST /api/libraries/test-contenthandler": librariesTestContenthandler,
  "GET /api/graph/health": graphHealth,
  "GET /api/graph/subgraph": graphSubgraph,
  "GET /api/reports/dead-wood": deadWoodReport,
  "POST /api/scan/start": scanStart,
  "POST /api/scan/continue": scanContinue,
  "GET /api/scan/status": scanStatus,
  "POST /api/graph/events": graphEvents,
  "POST /api/graph/sync-wcm-hierarchy": graphSyncWcmHierarchy,
  "POST /api/graph/ingest": graphIngest
};

function json(res: any, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

createServer(async (nodeReq, nodeRes) => {
  const method = (nodeReq.method || "GET").toUpperCase();
  const url = new URL(nodeReq.url || "/", `http://${nodeReq.headers.host || "localhost"}`);
  const key = `${method} ${url.pathname}`;
  const handler = routes[key];

  if (!handler) {
    return json(nodeRes, 404, { ok: false, error: `Route not found: ${key}` });
  }

  const bodyChunks: Buffer[] = [];
  for await (const chunk of nodeReq) bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const rawBody = bodyChunks.length > 0 ? Buffer.concat(bodyChunks).toString("utf8") : "";
  let parsedBody: unknown = {};
  if (rawBody.trim()) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = {};
    }
  }

  const query: Record<string, string | string[]> = {};
  for (const [k, v] of url.searchParams.entries()) {
    const existing = query[k];
    if (existing === undefined) query[k] = v;
    else if (Array.isArray(existing)) existing.push(v);
    else query[k] = [existing, v];
  }

  let finished = false;
  const resLike = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      if (finished) return this;
      finished = true;
      for (const [k, v] of Object.entries(this.headers)) nodeRes.setHeader(k, v);
      json(nodeRes, this.statusCode, payload);
      return this;
    },
    send(payload: unknown) {
      if (finished) return this;
      finished = true;
      for (const [k, v] of Object.entries(this.headers)) nodeRes.setHeader(k, v);
      if (typeof payload === "object") return json(nodeRes, this.statusCode, payload);
      nodeRes.statusCode = this.statusCode;
      nodeRes.end(String(payload ?? ""));
      return this;
    }
  };

  const reqLike = {
    method,
    url: url.pathname + url.search,
    headers: nodeReq.headers,
    query,
    body: parsedBody
  };

  try {
    await handler(reqLike, resLike);
    if (!finished) {
      json(nodeRes, 204, { ok: true });
    }
  } catch (error) {
    json(nodeRes, 500, {
      ok: false,
      error: "Local API server handler failed",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}).listen(PORT, () => {
  process.stdout.write(`DX.IQ local API listening on http://localhost:${PORT}\n`);
});
