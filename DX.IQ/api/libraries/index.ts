import "../_load-env";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { readSessionToken } from "../_session-token";

type LibraryRow = {
  id: number;
  name: string;
  base_url: string;
  username: string;
  password_secret_ref: string;
};

function safeRef(password?: string, sessionCookie?: string): string {
  if (sessionCookie && sessionCookie.trim()) {
    return `cookie:${Buffer.from(sessionCookie.trim()).toString("base64")}`;
  }
  if (!password) return "not-set";
  // Lightweight placeholder for development only.
  return `inline:${Buffer.from(password).toString("base64")}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return res.status(500).json({
        ok: false,
        error: "DATABASE_URL is not configured"
      });
    }
    const sql = neon(databaseUrl);

    if (req.method === "GET") {
      const result = (await sql(
        "select id, name, base_url, username, password_secret_ref from libraries order by id desc"
      )) as LibraryRow[];
      return res.status(200).json({
        ok: true,
        libraries: result.map((r) => ({
          id: r.id,
          name: r.name,
          baseUrl: r.base_url,
          username: r.username,
          hasPassword: r.password_secret_ref !== "not-set"
        }))
      });
    }

    if (req.method === "POST") {
      const body = (req.body || {}) as {
        name?: string;
        baseUrl?: string;
        username?: string;
        password?: string;
        sessionCookie?: string;
        sessionToken?: string;
      };
      const name = (body.name || "").trim();
      const baseUrl = (body.baseUrl || "").trim();
      const username = (body.username || "").trim();
      const password = body.password || "";
      const sessionCookie = (body.sessionCookie || "").trim();
      const tokenCookie = readSessionToken(body.sessionToken || "");
      const effectiveCookie = sessionCookie || tokenCookie;

      if (!name || !baseUrl) {
        return res.status(400).json({
          ok: false,
          error: "name and baseUrl are required"
        });
      }

      const inserted = (await sql(
        "insert into libraries (name, base_url, username, password_secret_ref) values ($1, $2, $3, $4) returning id, name, base_url, username, password_secret_ref",
        [name, baseUrl, username || "session", safeRef(password, effectiveCookie)]
      )) as LibraryRow[];
      const row = inserted[0]!;
      return res.status(201).json({
        ok: true,
        library: {
          id: row.id,
          name: row.name,
          baseUrl: row.base_url,
          username: row.username,
          hasPassword: row.password_secret_ref !== "not-set"
        }
      });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Database operation failed",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
