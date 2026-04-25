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

    const libraryId = req.query.libraryId ? Number(req.query.libraryId) : null;
    const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);

    const rows = libraryId
      ? ((await sql(
          `select e.id, e.library_id, l.name as library_name, e.wcm_id, e.name, e.type
           from wcm_elements e
           join libraries l on l.id = e.library_id
           where e.type = 'Component'
             and e.library_id = $1
             and not exists (select 1 from wcm_links w where w.child_id = e.id)
           order by e.name asc
           limit $2`,
          [libraryId, limit]
        )) as Array<Record<string, unknown>>)
      : ((await sql(
          `select e.id, e.library_id, l.name as library_name, e.wcm_id, e.name, e.type
           from wcm_elements e
           join libraries l on l.id = e.library_id
           where e.type = 'Component'
             and not exists (select 1 from wcm_links w where w.child_id = e.id)
           order by e.name asc
           limit $1`,
          [limit]
        )) as Array<Record<string, unknown>>);

    return res.status(200).json({
      ok: true,
      report: "dead-wood",
      count: rows.length,
      items: rows
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Failed to build dead wood report",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
