import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runScanChunk } from "./_engine";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = (req.body || {}) as { jobId?: number; chunkSize?: number };
    if (!body.jobId || Number.isNaN(Number(body.jobId))) {
      return res.status(400).json({ ok: false, error: "jobId is required" });
    }
    const result = await runScanChunk({ jobId: Number(body.jobId), chunkSize: body.chunkSize ?? 2 });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Failed to continue scan",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
