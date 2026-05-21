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

function parseDate(value) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : null;
}

async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.end();
  }
  if (req.method && req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });

  const url = new URL(req.url, "https://ambitdashboard.local");
  const dateFrom = parseDate(url.searchParams.get("date_from"));
  const dateTo = parseDate(url.searchParams.get("date_to"));
  const repo = url.searchParams.get("repo") || null;
  const teamId = url.searchParams.get("team_id") || null;

  try {
    const user = requireAuth(req);
    req.__ambitUser = user;
    const pool = getPool();
    const filters = [];
    const params = [];
    if (dateFrom) {
      params.push(dateFrom.toISOString());
      filters.push(`timestamp >= $${params.length}::timestamptz`);
    }
    if (dateTo) {
      params.push(dateTo.toISOString());
      filters.push(`timestamp <= $${params.length}::timestamptz`);
    }
    if (repo) {
      params.push(repo);
      filters.push(`coalesce(metadata->>'repo', metadata->>'repo_name', metadata->>'repoName', '') = $${params.length}`);
    }
    if (teamId) {
      params.push(teamId);
      filters.push(`coalesce(metadata->>'team_id', metadata->>'teamId', '') = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const [aiUsage, risky, trend, topRepos, modelGeo, readiness] = await Promise.all([
      pool.query(
        `
        SELECT coalesce(team_id, 'unknown') AS team_id,
               count(*)::int AS interactions,
               CASE WHEN count(*) FILTER (WHERE accepted IS NOT NULL) > 0
                    THEN round((count(*) FILTER (WHERE accepted = true)::numeric / count(*) FILTER (WHERE accepted IS NOT NULL)::numeric), 4)
                    ELSE NULL END AS accepted_rate
        FROM agent_interactions
        ${dateFrom || dateTo ? `WHERE ${[
          dateFrom ? `created_at >= '${dateFrom.toISOString()}'::timestamptz` : null,
          dateTo ? `created_at <= '${dateTo.toISOString()}'::timestamptz` : null,
          repo ? `coalesce(repo,'') = '${repo.replaceAll("'", "''")}'` : null,
          teamId ? `coalesce(team_id,'') = '${teamId.replaceAll("'", "''")}'` : null,
        ].filter(Boolean).join(" AND ")}` : ""}
        GROUP BY 1
        ORDER BY interactions DESC
        LIMIT 100
        `,
      ),
      pool.query(
        `
        SELECT coalesce(metadata->>'repo', metadata->>'repo_name', metadata->>'repoName', 'unknown') AS repo,
               count(*) FILTER (WHERE decision = false)::int AS blocked,
               count(*) FILTER (
                 WHERE EXISTS (
                   SELECT 1 FROM jsonb_array_elements(violations) v
                   WHERE upper(coalesce(v->>'severity','')) LIKE '%HIGH%'
                      OR upper(coalesce(v->>'severity','')) LIKE '%CRITICAL%'
                      OR upper(coalesce(v->>'severity','')) LIKE '%BLOCK%'
                 )
               )::int AS risky
        FROM ambit_decision_logs
        ${where}
        GROUP BY 1
        ORDER BY blocked DESC, risky DESC
        LIMIT 100
        `,
        params,
      ),
      pool.query(
        `
        SELECT to_char(date_trunc('day', timestamp), 'YYYY-MM-DD') AS day,
               count(*)::int AS total,
               count(*) FILTER (WHERE decision = false)::int AS blocked
        FROM ambit_decision_logs
        ${where}
        GROUP BY 1
        ORDER BY 1 ASC
        LIMIT 180
        `,
        params,
      ),
      pool.query(
        `
        SELECT coalesce(metadata->>'repo', metadata->>'repo_name', metadata->>'repoName', 'unknown') AS repo,
               coalesce(sum(jsonb_array_length(violations)),0)::int AS violations
        FROM ambit_decision_logs
        ${where}
        GROUP BY 1
        ORDER BY violations DESC
        LIMIT 20
        `,
        params,
      ),
      pool.query(
        `
        SELECT coalesce(user_geography, data_processing_region, jurisdiction, 'unknown') AS geography,
               count(*)::int AS count
        FROM model_usage
        ${dateFrom || dateTo ? `WHERE ${[
          dateFrom ? `created_at >= '${dateFrom.toISOString()}'::timestamptz` : null,
          dateTo ? `created_at <= '${dateTo.toISOString()}'::timestamptz` : null,
        ].filter(Boolean).join(" AND ")}` : ""}
        GROUP BY 1
        ORDER BY count DESC
        LIMIT 100
        `,
      ),
      pool.query(
        `
        SELECT
          count(*)::int AS logs,
          count(*) FILTER (WHERE previous_hash IS NOT NULL AND log_hash IS NOT NULL)::int AS chained,
          count(*) FILTER (WHERE signature IS NOT NULL)::int AS signed
        FROM ambit_decision_logs
        ${where}
        `,
        params,
      ),
    ]);

    const trendRows = trend.rows.map((r) => {
      const total = Number(r.total || 0);
      const blocked = Number(r.blocked || 0);
      return {
        day: String(r.day),
        total,
        blocked,
        score: total > 0 ? Number((((total - blocked) / total) * 100).toFixed(2)) : 100,
      };
    });
    const logs = Number(readiness.rows[0]?.logs || 0);
    const chained = Number(readiness.rows[0]?.chained || 0);
    const signed = Number(readiness.rows[0]?.signed || 0);
    const readinessScore = logs > 0 ? Number((((chained / logs) * 0.5 + (signed / logs) * 0.5) * 100).toFixed(2)) : 0;

    return sendJson(res, 200, {
      ai_usage_by_team: aiUsage.rows,
      blocked_risky_commits: risky.rows,
      compliance_score_trend: trendRows,
      top_violating_repos: topRepos.rows,
      model_usage_by_geography: modelGeo.rows,
      audit_readiness_score: {
        score: readinessScore,
        totals: { logs, chained, signed },
      },
    });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    return sendJson(res, status, { error: String(error?.message || error), note: "executive-dashboard API failed." });
  }
}

export default withRateLimit(handler);
