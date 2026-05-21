import { getPool } from "./_pool.js";
import { requireAuth, hasPermission } from "./_auth.js";
import { logAdminAction } from "./_admin-audit.js";
import { safeJson, withRateLimit } from "./_security.js";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  try {
    const user = requireAuth(req);
    if (!hasPermission(user, "export.reports")) return sendJson(res, 403, { error: "Forbidden" });
    const body = await safeJson(req);
    const format = String(body.format || "json").toLowerCase();
    const type = String(body.type || "evidence-bundle");
    const _filters = body.filters && typeof body.filters === "object" ? body.filters : {};
    const pool = getPool();
    const queries = {
      incidents: "SELECT * FROM incidents ORDER BY created_at DESC LIMIT 1000",
      interactions: "SELECT * FROM agent_interactions ORDER BY created_at DESC LIMIT 1000",
      "model-governance": "SELECT * FROM model_usage ORDER BY created_at DESC LIMIT 1000",
      "dashboard-metrics": "SELECT * FROM dashboard_metric_snapshots ORDER BY created_at DESC LIMIT 1000",
      "evidence-bundle":
        "SELECT jsonb_build_object('incidents',(SELECT jsonb_agg(i) FROM incidents i ORDER BY i.created_at DESC LIMIT 100),'interactions',(SELECT jsonb_agg(ai) FROM agent_interactions ai ORDER BY ai.created_at DESC LIMIT 100)) AS bundle",
    };
    const sql = queries[type] || queries["evidence-bundle"];
    const rows = (await pool.query(sql)).rows;
    const toCsv = (list) => {
      if (!list.length) return "";
      const keys = [...new Set(list.flatMap((r) => Object.keys(r)))];
      const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
      return `${keys.join(",")}\n${list.map((r) => keys.map((k) => esc(r[k])).join(",")).join("\n")}`;
    };
    if (format === "csv") {
      const out = { type, format: "csv", content: toCsv(rows) };
      await logAdminAction({ user, action: "export.generated", metadata: { format, type } });
      return sendJson(res, 200, out);
    }
    if (format === "html") {
      const title = type === "executive-board" ? "Executive Board Report" : type === "audit-readiness" ? "Audit Readiness Report" : "Incident Evidence Summary";
      const out = {
        type,
        format: "html",
        content: `<!doctype html><html><body><h1>${title}</h1><p>Generated at ${new Date().toISOString()}</p><pre>${JSON.stringify(rows[0] || {}, null, 2)}</pre></body></html>`,
      };
      await logAdminAction({ user, action: "export.generated", metadata: { format, type } });
      return sendJson(res, 200, out);
    }
    const out = { type, format: "json", content: rows };
    await logAdminAction({ user, action: "export.generated", metadata: { format: "json", type } });
    return sendJson(res, 200, out);
  } catch (e) {
    return sendJson(res, Number(e?.statusCode || 500), { error: String(e?.message || e) });
  }
}

export default withRateLimit(handler);
