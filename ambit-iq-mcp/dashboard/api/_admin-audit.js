import { getPool } from "./_pool.js";

export async function logAdminAction({ user, action, metadata = {} }) {
  try {
    const pool = getPool();
    await pool.query(
      `
      INSERT INTO dashboard_metric_snapshots
        (metric_name, dimensions, value, period_start, period_end, tenant_id)
      VALUES
        ('admin_action', $1::jsonb, $2::jsonb, now(), now(), nullif($3,'')::uuid)
      `,
      [
        JSON.stringify({
          action,
          user_id: user?.id || "unknown",
          user_email: user?.email || "unknown",
        }),
        JSON.stringify(metadata),
        String(user?.tenant_id || ""),
      ],
    );
  } catch {
    /* best effort */
  }
}
