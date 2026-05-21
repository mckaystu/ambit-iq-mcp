import { getPool } from "./_pool.js";
import { requireAuth } from "./_auth.js";
import { withRateLimit } from "./_security.js";

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

function safeJsonParse(v) {
  try {
    const parsed = JSON.parse(String(v || ""));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizePriority(v) {
  const p = String(v || "").toUpperCase();
  if (p === "HIGH" || p === "LOW") return p;
  return "MEDIUM";
}

async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.end();
  }
  if (req.method && req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    requireAuth(req);
    const pool = getPool();
    const url = new URL(req.url, "https://signals.local");
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 200), 500));

    const { rows } = await pool.query(
      `
      SELECT
        id::text AS id,
        repo_name,
        pr_url,
        rejection_summary,
        created_at
      FROM pr_signals
      WHERE rejection_summary IS NOT NULL
      ORDER BY created_at DESC
      LIMIT $1::int
      `,
      [limit],
    );

    const signals = rows.map((r) => {
      const parsed = safeJsonParse(r.rejection_summary);
      const meta = parsed?.metadata && typeof parsed.metadata === "object" ? parsed.metadata : {};
      return {
        id: String(r.id),
        repo_name: String(r.repo_name || "unknown-repo"),
        pr_url: String(r.pr_url || ""),
        action: String(parsed.action || "NO_ACTION"),
        reasoning: String(parsed.reasoning || ""),
        natural_language_intent: String(parsed.natural_language_intent || ""),
        efficacy_improvement: String(parsed.efficacy_improvement || ""),
        model: String(parsed.model || ""),
        priority: normalizePriority(parsed.priority),
        category: String(meta.category || "Uncategorized"),
        suggested_rego_logic: String(meta.suggested_rego_logic || ""),
        created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
      };
    });

    return sendJson(res, 200, { signals });
  } catch (e) {
    return sendJson(res, 500, {
      error: String(e),
      note: "Signal intelligence API failed. Ensure DATABASE_URL and pr_signals table are configured.",
    });
  }
}

export default withRateLimit(handler);

