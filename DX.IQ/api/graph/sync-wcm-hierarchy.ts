import "../_load-env";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { listWcmLibraries, syncWcmHierarchyToFalkor } from "./wcmHierarchySync";

type LibraryRow = {
  id: number;
  name: string;
  base_url: string;
  username: string;
  password_secret_ref: string;
};

function parseSecret(ref: string): { password: string; cookie: string } {
  if (!ref) return { password: "", cookie: "" };
  if (ref.startsWith("inline:")) {
    try {
      return { password: Buffer.from(ref.slice("inline:".length), "base64").toString("utf8"), cookie: "" };
    } catch {
      return { password: "", cookie: "" };
    }
  }
  if (ref.startsWith("cookie:")) {
    try {
      return { password: "", cookie: Buffer.from(ref.slice("cookie:".length), "base64").toString("utf8") };
    } catch {
      return { password: "", cookie: "" };
    }
  }
  return { password: "", cookie: "" };
}

function getSql() {
  const db = process.env.DATABASE_URL;
  if (!db) throw new Error("DATABASE_URL is not configured");
  return neon(db);
}

/**
 * POST /api/graph/sync-wcm-hierarchy
 * Body: { libraryId, wcmLibraryId?, listLibrariesOnly?, maxNodes?, maxDepth?, delayMs?, maxComponentOps? }
 *
 * Traverses HCL DX WCM v2 hierarchy (root-items → site area children → content expand=elements)
 * and MERGEs into FalkorDB (requires FALKOR_REDIS_URL).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = (req.body || {}) as {
      libraryId?: number;
      wcmLibraryId?: string;
      listLibrariesOnly?: boolean;
      maxNodes?: number;
      maxDepth?: number;
      delayMs?: number;
      maxComponentOps?: number;
    };

    if (!body.libraryId || Number.isNaN(Number(body.libraryId))) {
      return res.status(400).json({ ok: false, error: "libraryId is required" });
    }

    const sql = getSql();
    const rows = (await sql(
      `select id, name, base_url, username, password_secret_ref from libraries where id = $1`,
      [Number(body.libraryId)]
    )) as LibraryRow[];
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Library not found" });
    }
    const lib = rows[0]!;
    const secret = parseSecret(lib.password_secret_ref);

    if (body.listLibrariesOnly) {
      const listed = await listWcmLibraries({
        baseUrl: lib.base_url,
        username: lib.username,
        password: secret.password,
        cookie: secret.cookie || undefined
      });
      return res.status(200).json({ ok: listed.ok, libraries: listed.libraries, warnings: listed.warnings });
    }

    let wcmLibraryId = (body.wcmLibraryId || "").trim();
    if (!wcmLibraryId) {
      const listed = await listWcmLibraries({
        baseUrl: lib.base_url,
        username: lib.username,
        password: secret.password,
        cookie: secret.cookie || undefined
      });
      if (!listed.ok || listed.libraries.length === 0) {
        return res.status(400).json({
          ok: false,
          error:
            "wcmLibraryId is required (or must be discoverable via GET .../libraries). Pass wcmLibraryId from listLibrariesOnly response.",
          warnings: listed.warnings
        });
      }
      wcmLibraryId = listed.libraries[0]!.id;
    }

    const result = await syncWcmHierarchyToFalkor({
      libraryDbId: lib.id,
      libraryName: lib.name,
      baseUrl: lib.base_url,
      username: lib.username,
      password: secret.password,
      cookie: secret.cookie || undefined,
      wcmLibraryId,
      maxNodes: body.maxNodes,
      maxDepth: body.maxDepth,
      delayMs: body.delayMs,
      maxComponentOps: body.maxComponentOps
    });

    const status = result.ok ? 200 : 502;
    return res.status(status).json({ wcmLibraryId, ...result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "WCM hierarchy sync failed",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
