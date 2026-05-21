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

function parseRange(query) {
  const preset = ["7d", "30d", "90d"].includes(query.preset) ? query.preset : "30d";
  const now = new Date();
  const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - days);
  const startDate = String(query.startDate || defaultStart.toISOString().slice(0, 10));
  const endDate = String(query.endDate || now.toISOString().slice(0, 10));
  return { preset, startDate, endDate };
}

function normalizeSeverity(v) {
  const s = String(v || "").toUpperCase();
  if (s.includes("BLOCK")) return "BLOCKER";
  return "WARNING";
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

  const url = new URL(req.url, "https://ambitdashboard.local");
  const range = parseRange(Object.fromEntries(url.searchParams.entries()));

  try {
    requireAuth(req);
    const pool = getPool();

    const trendRows = await pool.query(
      `
      WITH days AS (
        SELECT generate_series($1::date, $2::date, interval '1 day')::date AS d
      )
      SELECT
        to_char(days.d, 'MM-DD') AS day,
        COALESCE(SUM(CASE WHEN upper(coalesce(ca.action_taken, 'WARNING')) LIKE 'BLOCK%' THEN 1 ELSE 0 END), 0)::int AS blockers,
        COALESCE(SUM(CASE WHEN upper(coalesce(ca.action_taken, 'WARNING')) NOT LIKE 'BLOCK%' THEN 1 ELSE 0 END), 0)::int AS warnings
      FROM days
      LEFT JOIN compliance_activity ca
        ON date(ca.timestamp) = days.d
      GROUP BY days.d
      ORDER BY days.d ASC
      `,
      [range.startDate, range.endDate],
    );

    const industryRows = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(rl.industry_id, ''), 'Cross-Industry') AS industry_id,
        COUNT(*)::int AS violations
      FROM compliance_activity
      LEFT JOIN rules_library rl
        ON rl.rule_id = compliance_activity.rule_id
      WHERE compliance_activity.timestamp >= $1::date
        AND compliance_activity.timestamp < ($2::date + interval '1 day')
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 8
      `,
      [range.startDate, range.endDate],
    );

    const issueRows = await pool.query(
      `
      SELECT
        COALESCE(ca.activity_id::text, md5(random()::text)) AS id,
        COALESCE(NULLIF(ca.user_id::text, ''), 'unknown') AS user_id,
        COALESCE(NULLIF(ca.repo_name, ''), 'unknown-repo') AS repo_name,
        COALESCE(NULLIF(ca.tenant_id::text, ''), 'unknown-tenant') AS tenant_id,
        COALESCE(NULLIF(rl.industry_id, ''), 'Cross-Industry') AS industry_id,
        COALESCE(NULLIF(ca.action_taken, ''), 'WARNING') AS severity,
        COALESCE(NULLIF(rl.rule_name, ''), COALESCE(ca.rule_id::text, 'Unknown rule')) AS rule_name,
        ca.rule_id::text AS rule_id,
        LEFT(COALESCE(ca.context_snippet, ''), 4000) AS context_snippet,
        COALESCE(ca.is_resolved, false) AS is_resolved,
        ca.timestamp AS created_at
      FROM compliance_activity ca
      LEFT JOIN rules_library rl
        ON rl.rule_id = ca.rule_id
      WHERE ca.timestamp >= $1::date
        AND ca.timestamp < ($2::date + interval '1 day')
      ORDER BY ca.timestamp DESC
      LIMIT 50
      `,
      [range.startDate, range.endDate],
    );

    const insightsRows = await pool.query(
      `
      WITH curr AS (
        SELECT COUNT(*)::int AS c
        FROM compliance_activity
        WHERE upper(coalesce(action_taken, 'WARNING')) LIKE 'BLOCK%'
          AND timestamp >= (now() - interval '48 hours')
      ),
      prev AS (
        SELECT COUNT(*)::int AS c
        FROM compliance_activity
        WHERE upper(coalesce(action_taken, 'WARNING')) LIKE 'BLOCK%'
          AND timestamp >= (now() - interval '96 hours')
          AND timestamp < (now() - interval '48 hours')
      ),
      top_tenant AS (
        SELECT COALESCE(NULLIF(ca.tenant_id::text, ''), 'unknown-tenant') AS tenant, COUNT(*)::int AS c
        FROM compliance_activity ca
        WHERE ca.timestamp >= $1::date
          AND ca.timestamp < ($2::date + interval '1 day')
          AND upper(coalesce(ca.action_taken, 'WARNING')) LIKE 'BLOCK%'
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 1
      ),
      rl AS (
        SELECT COUNT(*)::int AS total_rules FROM rules_library
      )
      SELECT
        curr.c AS curr_blockers,
        prev.c AS prev_blockers,
        COALESCE((SELECT tenant FROM top_tenant), 'N/A') AS top_tenant,
        COALESCE((SELECT c FROM top_tenant), 0)::int AS top_tenant_blockers,
        COALESCE((SELECT total_rules FROM rl), 0)::int AS rules_count
      FROM curr, prev
      `,
      [range.startDate, range.endDate],
    );

    const trendSeries = trendRows.rows.map((r) => ({
      day: String(r.day),
      blockers: Number(r.blockers || 0),
      warnings: Number(r.warnings || 0),
    }));

    const industrySeries = industryRows.rows.map((r) => ({
      industryId: String(r.industry_id),
      violations: Number(r.violations || 0),
    }));

    const activeIssues = issueRows.rows.map((r) => {
      const ruleId = r.rule_id != null && String(r.rule_id).trim() !== "" ? String(r.rule_id) : undefined;
      const ctx = r.context_snippet != null && String(r.context_snippet).trim() !== "" ? String(r.context_snippet) : undefined;
      return {
        id: String(r.id),
        userId: String(r.user_id),
        repoName: String(r.repo_name),
        tenant: String(r.tenant_id),
        industryId: String(r.industry_id),
        severity: normalizeSeverity(r.severity),
        ruleName: String(r.rule_name),
        createdAt: new Date(r.created_at).toISOString(),
        ruleId,
        contextSnippet: ctx,
        isResolved: Boolean(r.is_resolved),
      };
    });

    const blockersTotal = trendSeries.reduce((acc, p) => acc + p.blockers, 0);
    const warningsTotal = trendSeries.reduce((acc, p) => acc + p.warnings, 0);
    const complianceScore = Math.max(
      0,
      Math.min(100, 100 - Math.round(blockersTotal * 0.24 + warningsTotal * 0.06)),
    );

    const insight = insightsRows.rows[0] || {
      curr_blockers: 0,
      prev_blockers: 0,
      top_tenant: "N/A",
      top_tenant_blockers: 0,
      rules_count: 0,
    };
    const prev = Number(insight.prev_blockers || 0);
    const curr = Number(insight.curr_blockers || 0);
    const pct = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : curr > 0 ? 100 : 0;

    const insights = [
      {
        title: "48h Blocker Trend",
        summary: `Blockers ${pct >= 0 ? "increased" : "decreased"} by ${Math.abs(pct)}% over the last 48h.`,
      },
      {
        title: "Top Risk Tenant",
        summary: `${insight.top_tenant} has ${Number(insight.top_tenant_blockers || 0)} blocker issue(s) in the selected window.`,
      },
      {
        title: "Governance Library",
        summary: `${Number(insight.rules_count || 0)} rule(s) loaded in rules_library for policy evaluation.`,
      },
    ];

    return sendJson(res, 200, {
      complianceScore,
      trendSeries,
      industrySeries,
      activeIssues,
      insights,
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: String(error),
      note:
        "Dashboard API failed. Ensure DATABASE_URL is set and tables compliance_activity/rules_library exist in Neon.",
    });
  }
}

export default withRateLimit(handler);
