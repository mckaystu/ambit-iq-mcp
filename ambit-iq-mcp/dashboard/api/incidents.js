import { getPool } from "./_pool.js";
import { requireAuth } from "./_auth.js";
import { logAdminAction } from "./_admin-audit.js";
import { withRateLimit, safeJson } from "./_security.js";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
function sendJson(res, status, body) {
  res.statusCode = status;
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.end();
  }
  try {
    const user = requireAuth(req);
    req.__ambitUser = user;
    const pool = getPool();
    if ((req.method || "GET") === "GET") {
      const url = new URL(req.url, "https://ambitdashboard.local");
      const incidentId = url.searchParams.get("incident_id");
      if (incidentId) {
        const timeline = await pool.query(
          `
          SELECT 'incident_event' AS source, ie.timestamp, ie.incident_id::text, ie.event_type,
                 ie.actor_id, ie.repo, ie.payload
          FROM incident_events ie
          WHERE ie.incident_id = $1::uuid
          UNION ALL
          SELECT 'decision_log' AS source, adl.timestamp, NULL::text AS incident_id,
                 'decision_log' AS event_type, adl.actor_id, coalesce(adl.metadata->>'repo', adl.metadata->>'repo_name', adl.metadata->>'repoName', NULL) AS repo,
                 jsonb_build_object('trace_id', adl.trace_id::text, 'decision', adl.decision, 'violations', adl.violations) AS payload
          FROM ambit_decision_logs adl
          JOIN incidents i ON i.trace_id = adl.trace_id
          WHERE i.id = $1::uuid
          ORDER BY timestamp ASC
          `,
          [incidentId],
        );
        return sendJson(res, 200, { timeline: timeline.rows });
      }
      const rows = await pool.query(
        `
        SELECT id::text, title, description, severity, status, trace_id::text, repo, actor_id, team_id,
               first_seen_at, last_seen_at, metadata, created_at, updated_at
        FROM incidents
        ORDER BY created_at DESC
        LIMIT 500
        `,
      );
      return sendJson(res, 200, { incidents: rows.rows });
    }

    if ((req.method || "") !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
    let body = {};
    try { body = await safeJson(req); } catch (e) { return sendJson(res, Number(e?.statusCode || 400), { error: String(e?.message || e) }); }
    const action = String(body.action || "").trim();
    if (action === "add_event") {
      if (!body.incident_id || !body.event_type) return sendJson(res, 400, { error: "incident_id and event_type required" });
      const out = await pool.query(
        `
        INSERT INTO incident_events
          (incident_id, trace_id, timestamp, event_type, actor_id, repo, commit_sha, pr_number, payload)
        VALUES
          ($1::uuid, nullif($2,'')::uuid, coalesce($3::timestamptz, now()), $4, nullif($5,''), nullif($6,''), nullif($7,''), nullif($8,''), coalesce($9::jsonb, '{}'::jsonb))
        RETURNING id::text, incident_id::text, trace_id::text, timestamp, event_type, actor_id, repo, commit_sha, pr_number, payload
        `,
        [
          body.incident_id,
          body.trace_id || "",
          body.timestamp || null,
          body.event_type,
          body.actor_id || "",
          body.repo || "",
          body.commit_sha || "",
          body.pr_number || "",
          JSON.stringify(body.payload || {}),
        ],
      );
      await logAdminAction({ user, action: "incident.add_event", metadata: { incident_id: body.incident_id } });
      return sendJson(res, 201, { event: out.rows[0] });
    }

    if (!body.title || !body.severity) return sendJson(res, 400, { error: "title and severity required" });
    const created = await pool.query(
      `
      INSERT INTO incidents
        (title, description, severity, status, trace_id, repo, actor_id, team_id, metadata)
      VALUES
        ($1, nullif($2,''), $3, coalesce(nullif($4,''), 'open'), nullif($5,'')::uuid, nullif($6,''), nullif($7,''), nullif($8,''), coalesce($9::jsonb, '{}'::jsonb))
      RETURNING id::text, title, description, severity, status, trace_id::text, repo, actor_id, team_id, metadata, created_at, updated_at
      `,
      [
        body.title,
        body.description || "",
        body.severity,
        body.status || "",
        body.trace_id || "",
        body.repo || "",
        body.actor_id || "",
        body.team_id || "",
        JSON.stringify(body.metadata || {}),
      ],
    );
    await logAdminAction({ user, action: "incident.create", metadata: { title: body.title, severity: body.severity } });
    return sendJson(res, 201, { incident: created.rows[0] });
  } catch (error) {
    return sendJson(res, Number(error?.statusCode || 500), { error: String(error?.message || error), note: "incidents API failed." });
  }
}

export default withRateLimit(handler);
