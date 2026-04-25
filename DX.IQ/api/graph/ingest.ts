import "../_load-env";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { IngestionService } from "./IngestionService";

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
 * POST /api/graph/ingest
 * Deep WCM library crawl → FalkorDB (ingest:wcm:* keys, HAS_CHILD, USES_COMPONENT, BASED_ON).
 * Body: { libraryId, wcmLibraryId?, libraryName?, bearerToken?, maxConcurrency?, maxNodes? }
 * If bearerToken is set, uses Authorization: Bearer; else library Basic/cookie from DB.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = (req.body || {}) as {
      libraryId?: number;
      wcmLibraryId?: string;
      libraryName?: string;
      bearerToken?: string;
      maxConcurrency?: number;
      maxNodes?: number;
      maxDepth?: number;
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
    const token = typeof body.bearerToken === "string" ? body.bearerToken.trim() : "";

    const auth =
      token.length > 0
        ? ({ kind: "bearer" as const, token })
        : lib.username && secret.password
          ? ({ kind: "basic" as const, username: lib.username, password: secret.password })
          : null;

    if (!auth) {
      return res.status(400).json({
        ok: false,
        error: "No auth: set bearerToken in body or configure library username/password"
      });
    }

    const svc = new IngestionService({
      baseUrl: lib.base_url,
      auth,
      cookie: secret.cookie || undefined,
      wcmLibraryId: body.wcmLibraryId?.trim() || undefined,
      libraryName: body.libraryName?.trim() || lib.name,
      maxConcurrency: body.maxConcurrency,
      maxNodes: body.maxNodes,
      maxDepth: body.maxDepth,
      maxComponentOps: body.maxComponentOps
    });

    const out = await svc.ingest();
    const status = out.ok ? 200 : 502;
    return res.status(status).json({ ...out });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Graph ingest failed",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
