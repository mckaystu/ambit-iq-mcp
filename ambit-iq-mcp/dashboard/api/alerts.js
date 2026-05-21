import { getPool } from "./_pool.js";
import { requireAuth, hasPermission } from "./_auth.js";
import { logAdminAction } from "./_admin-audit.js";
import { safeJson, withRateLimit } from "./_security.js";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});
  try {
    const user = requireAuth(req);
    if (req.method === "GET") {
      const pool = getPool();
      const rows = await pool.query(
        `
        SELECT id::text, dimensions, value, tenant_id::text, created_at
        FROM dashboard_metric_snapshots
        WHERE metric_name = 'alert_event'
        ORDER BY created_at DESC
        LIMIT 100
        `,
      );
      return sendJson(res, 200, { alerts: rows.rows });
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
    if (!hasPermission(user, "manage.users") && !user.roles.includes("admin")) {
      return sendJson(res, 403, { error: "Forbidden" });
    }
    const body = await safeJson(req);
    const action = String(body.action || "test").trim();
    if (action === "acknowledge") {
      const pool = getPool();
      await pool.query(
        `
        UPDATE dashboard_metric_snapshots
        SET value = coalesce(value, '{}'::jsonb) || $2::jsonb
        WHERE id = $1::uuid
        `,
        [
          String(body.alert_id || ""),
          JSON.stringify({
            acknowledged: true,
            acknowledged_by: user.email,
            acknowledged_at: new Date().toISOString(),
          }),
        ],
      ).catch(() => null);
      await logAdminAction({ user, action: "alert.acknowledge", metadata: { alert_id: body.alert_id } });
      return sendJson(res, 200, { ok: true, acknowledged: true });
    }
    if (action === "evaluate") {
      const pool = getPool();
      const c = await pool.query(
        `
        SELECT count(*)::int AS incidents
        FROM incidents
        WHERE severity IN ('CRITICAL', 'HIGH')
          AND created_at >= (now() - interval '1 hour')
        `,
      );
      const incidents = Number(c.rows[0]?.incidents || 0);
      const out = { evaluated: 1, triggered: incidents > 5 ? 1 : 0, incidents };
      await logAdminAction({ user, action: "alert.evaluate_thresholds", metadata: out });
      return sendJson(res, 200, { ok: true, ...out });
    }
    const event = {
      type: "test_alert",
      severity: "high",
      title: String(body.title || "Test alert"),
      message: String(body.message || "Test alert triggered from dashboard."),
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
    };
    const pool = getPool();
    const ins = await pool.query(
      `
      INSERT INTO dashboard_metric_snapshots
        (metric_name, dimensions, value, period_start, period_end, tenant_id)
      VALUES
        ('alert_event', $1::jsonb, $2::jsonb, now(), now(), nullif($3,'')::uuid)
      RETURNING id::text
      `,
      [
        JSON.stringify({ type: event.type, severity: event.severity, title: event.title }),
        JSON.stringify({ message: event.message, metadata: event.metadata, acknowledged: false }),
        String(user.tenant_id || ""),
      ],
    );
    const out = { sent: true, channels: ["internal_audit_log_only"], recordId: ins.rows[0]?.id || null };
    await logAdminAction({ user, action: "alert.test", metadata: out });
    return sendJson(res, 200, { ok: true, ...out });
  } catch (e) {
    return sendJson(res, Number(e?.statusCode || 500), { error: String(e?.message || e) });
  }
}

export default withRateLimit(handler);
