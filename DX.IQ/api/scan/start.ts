import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createScanJob, runScanChunk } from "./_engine";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = (req.body || {}) as {
      libraryId?: number;
      chunkSize?: number;
      runToCompletion?: boolean;
      maxChunks?: number;
    };
    if (!body.libraryId || Number.isNaN(Number(body.libraryId))) {
      return res.status(400).json({ ok: false, error: "libraryId is required" });
    }

    const jobId = await createScanJob(Number(body.libraryId));
    const runToCompletion = body.runToCompletion !== false;
    const maxChunks = Math.min(Math.max(Number(body.maxChunks ?? 120), 1), 1000);
    let result = await runScanChunk({ jobId, chunkSize: body.chunkSize ?? 1 });
    let loops = 1;

    while (runToCompletion && String(result?.state || "").toLowerCase() !== "completed" && loops < maxChunks) {
      result = await runScanChunk({ jobId, chunkSize: body.chunkSize ?? 1 });
      loops += 1;
    }

    return res.status(202).json({
      ...result,
      runToCompletion,
      serverChunksProcessed: loops,
      completed: String(result?.state || "").toLowerCase() === "completed"
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Failed to start scan",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
