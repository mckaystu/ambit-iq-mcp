import crypto from "node:crypto";
import { getPool } from "./_pool.js";
import { requireAuth } from "./_auth.js";
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
function redact(input) {
  const s = String(input || "");
  return s
    .replace(/AKIA[0-9A-Z]{16}/g, "AKIA****************")
    .replace(/(bearer\s+)[a-z0-9\-._~+/]+=*/gi, "$1[REDACTED]")
    .replace(/(token|password|secret)\s*[:=]\s*["']?[^"'\s]+["']?/gi, "$1=[REDACTED]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
}
function hash(v) {
  return crypto.createHash("sha256").update(String(v || ""), "utf8").digest("hex");
}

async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.end();
  }
  try {
    requireAuth(req);
    const pool = getPool();
    if ((req.method || "GET") === "GET") {
      const url = new URL(req.url, "https://ambitdashboard.local");
      const interactionId = url.searchParams.get("interaction_id");
      if (interactionId) {
        const one = await pool.query(`SELECT * FROM agent_interactions WHERE id = $1::uuid LIMIT 1`, [interactionId]);
        return sendJson(res, 200, { interaction: one.rows[0] || null });
      }
      const rows = await pool.query(
        `SELECT * FROM agent_interactions ORDER BY created_at DESC LIMIT 500`,
      );
      return sendJson(res, 200, { interactions: rows.rows });
    }

    if ((req.method || "") !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
    let body = {};
    try { body = await safeJson(req); } catch (e) { return sendJson(res, Number(e?.statusCode || 400), { error: String(e?.message || e) }); }
    if (!body.agent_name) return sendJson(res, 400, { error: "agent_name is required" });

    const prompt = body.prompt != null ? String(body.prompt) : null;
    const response = body.response != null ? String(body.response) : null;
    const proposedCode = body.proposed_code != null ? String(body.proposed_code) : null;
    const finalCode = body.final_code != null ? String(body.final_code) : null;

    const ins = await pool.query(
      `
      INSERT INTO agent_interactions
        (trace_id, decision_log_id, session_id, actor_id, team_id, agent_name, agent_version, workspace_id, repo, branch, commit_sha, pr_number,
         prompt_captured, prompt_redacted, prompt_hash, prompt_char_count, prompt_truncated,
         response_captured, response_redacted, response_hash, response_char_count, response_truncated,
         proposed_code_redacted, final_code_redacted, code_hash, accepted, capture_policy, metadata)
      VALUES
        (coalesce(nullif($1,''), gen_random_uuid()::text)::uuid, nullif($2,'')::uuid, nullif($3,''), nullif($4,''), nullif($5,''), $6, nullif($7,''), nullif($8,''), nullif($9,''), nullif($10,''), nullif($11,''), nullif($12,''),
         $13, $14, $15, $16, false,
         $17, $18, $19, $20, false,
         $21, $22, $23, $24, coalesce($25::jsonb, '{}'::jsonb), coalesce($26::jsonb, '{}'::jsonb))
      RETURNING id::text, trace_id::text, agent_name, created_at
      `,
      [
        body.trace_id || "",
        body.decision_log_id || "",
        body.session_id || "",
        body.actor_id || "",
        body.team_id || "",
        String(body.agent_name),
        body.agent_version || "",
        body.workspace_id || "",
        body.repo || "",
        body.branch || "",
        body.commit_sha || "",
        body.pr_number || "",
        Boolean(prompt),
        prompt ? redact(prompt) : null,
        prompt ? hash(prompt) : null,
        prompt ? prompt.length : null,
        Boolean(response),
        response ? redact(response) : null,
        response ? hash(response) : null,
        response ? response.length : null,
        proposedCode ? redact(proposedCode) : null,
        finalCode ? redact(finalCode) : null,
        proposedCode || finalCode ? hash(`${proposedCode || ""}\n${finalCode || ""}`) : null,
        typeof body.accepted === "boolean" ? body.accepted : null,
        JSON.stringify(body.capture_policy || {}),
        JSON.stringify(body.metadata || {}),
      ],
    );
    return sendJson(res, 201, { interaction: ins.rows[0] });
  } catch (error) {
    return sendJson(res, Number(error?.statusCode || 500), { error: String(error?.message || error), note: "agent-interactions API failed." });
  }
}

export default withRateLimit(handler);
