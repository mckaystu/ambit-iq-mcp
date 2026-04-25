import { getPool } from "./_pool.js";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function sendJson(res, status, body) {
  res.statusCode = status;
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function boolFromQuery(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "allow" || s === "true" || s === "1") return true;
  if (s === "deny" || s === "false" || s === "0") return false;
  return null;
}

function triStateFromQuery(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return null;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.end();
  }
  if (req.method && req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const pool = getPool();
    const url = new URL(req.url, "https://audit-reports.local");
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 100), 500));
    const actor = String(url.searchParams.get("actor") || "").trim();
    const projectId = String(url.searchParams.get("project_id") || "").trim();
    const decision = boolFromQuery(url.searchParams.get("decision"));
    const hasArtifacts = triStateFromQuery(url.searchParams.get("has_artifacts"));

    const params = [limit];
    let where = "WHERE 1=1";
    if (actor) {
      params.push(actor);
      where += ` AND actor_id = $${params.length}::text`;
    }
    if (projectId) {
      params.push(projectId);
      where += ` AND metadata->>'project_id' = $${params.length}::text`;
    }
    if (decision !== null) {
      params.push(decision);
      where += ` AND decision = $${params.length}::boolean`;
    }
    if (hasArtifacts === true) {
      where += ` AND metadata ? 'artifact_refs'`;
    } else if (hasArtifacts === false) {
      where += ` AND NOT (metadata ? 'artifact_refs')`;
    }

    const { rows } = await pool.query(
      `
      SELECT
        id::text AS id,
        trace_id::text AS trace_id,
        timestamp,
        actor_id,
        decision,
        metadata->>'project_id' AS project_id,
        metadata->'artifact_refs' AS artifact_refs
      FROM ambit_decision_logs
      ${where}
      ORDER BY timestamp DESC
      LIMIT $1::int
      `,
      params,
    );

    const reports = rows.map((r) => {
      const refs = r.artifact_refs && typeof r.artifact_refs === "object" ? r.artifact_refs : {};
      return {
        id: String(r.id),
        trace_id: String(r.trace_id || ""),
        timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : null,
        actor_id: String(r.actor_id || ""),
        decision: r.decision ? "ALLOW" : "DENY",
        project_id: String(r.project_id || ""),
        artifact_refs: refs,
      };
    });

    return sendJson(res, 200, { reports });
  } catch (e) {
    return sendJson(res, 500, {
      error: String(e),
      note: "Audit reports API failed. Ensure DATABASE_URL, ambit_decision_logs, and artifact_refs metadata are configured.",
    });
  }
}

