import "../_load-env";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { graphQuery } from "./_redis";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const sidecarUrl = process.env.GRAPH_SIDECAR_URL?.trim() || "";
  const redisUrl = process.env.FALKOR_REDIS_URL?.trim() || "";
  const configured = Boolean(sidecarUrl && redisUrl);

  if (!configured) {
    return res.status(200).json({
      ok: true,
      enabled: false,
      status: "disabled",
      message: "Set GRAPH_SIDECAR_URL and FALKOR_REDIS_URL to enable graph ingest."
    });
  }

  try {
    await graphQuery("RETURN 1");
    return res.status(200).json({
      ok: true,
      enabled: true,
      status: "healthy",
      message: "Graph ingest is enabled and FalkorDB is reachable."
    });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      enabled: true,
      status: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
