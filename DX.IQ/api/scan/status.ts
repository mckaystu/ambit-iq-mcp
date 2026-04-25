import "../_load-env";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const db = process.env.DATABASE_URL;
    if (!db) return res.status(500).json({ ok: false, error: "DATABASE_URL is not configured" });
    const sql = neon(db);
    const jobId = Number(req.query.jobId);
    if (!jobId || Number.isNaN(jobId)) {
      return res.status(400).json({ ok: false, error: "jobId query param is required" });
    }

    const jobs = (await sql(
      `select j.id, j.library_id, j.state, j.cursor, j.started_at, j.completed_at, j.error_message,
              l.name as library_name
       from scan_jobs j
       join libraries l on l.id = j.library_id
       where j.id = $1`,
      [jobId]
    )) as Array<{
      id: number;
      library_id: number;
      library_name: string;
      state: string;
      cursor: Record<string, unknown>;
      started_at: string | null;
      completed_at: string | null;
      error_message: string | null;
    }>;

    if (jobs.length === 0) return res.status(404).json({ ok: false, error: "Scan job not found" });
    const job = jobs[0]!;

    const counts = (await sql(
      `select
          count(*) filter (where type = 'PT')::int as pt_count,
          count(*) filter (where type = 'AT')::int as at_count,
          count(*) filter (where type = 'SiteArea')::int as sitearea_count,
          count(*) filter (where type = 'Content')::int as content_count,
          count(*) filter (where type = 'Component')::int as component_count,
          count(*) filter (where type = 'Library')::int as library_count,
          count(*) filter (where type = 'Folder')::int as folder_count
       from wcm_elements
       where library_id = $1`,
      [job.library_id]
    )) as Array<{
      pt_count: number;
      at_count: number;
      sitearea_count: number;
      content_count: number;
      component_count: number;
      library_count: number;
      folder_count: number;
    }>;

    const links = (await sql(
      `select count(*)::int as links_count
       from wcm_links l
       join wcm_elements p on p.id = l.parent_id
       where p.library_id = $1`,
      [job.library_id]
    )) as Array<{
      links_count: number;
    }>;

    const refRows = (await sql(
      `select
         count(*) filter (where p.type = 'Content')::int as from_content,
         count(*) filter (where p.type = 'PT')::int as from_pt
       from wcm_links l
       join wcm_elements p on p.id = l.parent_id
       where p.library_id = $1 and l.link_type = 'REFERENCES'`,
      [job.library_id]
    )) as Array<{ from_content: number; from_pt: number }>;

    return res.status(200).json({
      ok: true,
      job: {
        id: job.id,
        state: job.state,
        libraryId: job.library_id,
        libraryName: job.library_name,
        cursor: job.cursor,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        error: job.error_message
      },
      inventory: counts[0] || {},
      relationships: {
        linksCount: links[0]?.links_count || 0,
        referencesFromContentCount: refRows[0]?.from_content || 0,
        referencesFromPtCount: refRows[0]?.from_pt || 0
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Failed to read scan status",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
