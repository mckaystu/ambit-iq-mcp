import { getPool } from "./_pool.js";
import { requireAuth } from "./_auth.js";
import { withRateLimit } from "./_security.js";

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnv(name, fallback = "") {
  return String(process.env[name] || "").trim() || fallback;
}

function githubHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${requireEnv("GITHUB_TOKEN")}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "project-vail-pr-rejection-runner",
    ...extra,
  };
}

async function githubGraphQL(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: githubHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) {
    throw new Error(
      `GitHub GraphQL failed: ${JSON.stringify(body.errors || body).slice(0, 1000)}`,
    );
  }
  return body.data;
}

async function githubText(url, extraHeaders = {}) {
  const res = await fetch(url, { headers: githubHeaders(extraHeaders) });
  if (!res.ok) {
    const err = new Error(`GitHub API ${res.status} for ${url}: ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

async function githubPullFiles(ownerRepo, number) {
  const pages = [];
  let page = 1;
  while (page <= 10) {
    const data = await githubGraphQL(
      `
      query PullFiles($owner: String!, $repo: String!, $number: Int!, $perPage: Int!, $page: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            files(first: $perPage, after: null) {
              nodes {
                path
                additions
                deletions
              }
            }
          }
        }
      }
      `,
      {
        owner: ownerRepo.split("/")[0],
        repo: ownerRepo.split("/")[1],
        number,
        perPage: 100,
        page,
      },
    ).catch(() => null);
    // Fallback to REST files endpoint for reliability.
    const rest = await fetch(
      `https://api.github.com/repos/${ownerRepo}/pulls/${number}/files?per_page=100&page=${page}`,
      { headers: githubHeaders() },
    );
    if (!rest.ok) break;
    const rows = await rest.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    pages.push(...rows);
    if (rows.length < 100) break;
    page += 1;
  }
  return pages;
}

function flattenDiscussionComments(pr) {
  const threadComments = (pr?.reviewThreads?.nodes || []).flatMap((thread) =>
    (thread?.comments?.nodes || []).map((comment) => ({
      body: String(comment?.body || "").trim(),
      author: comment?.author?.login || "unknown",
      path: comment?.path || null,
      createdAt: comment?.createdAt || null,
      updatedAt: comment?.updatedAt || null,
      source: "thread",
    })),
  );

  const reviewComments = (pr?.reviews?.nodes || []).map((review) => ({
    body: String(review?.body || "").trim(),
    author: review?.author?.login || "unknown",
    path: null,
    createdAt: review?.submittedAt || null,
    updatedAt: review?.submittedAt || null,
    source: "review",
    state: String(review?.state || "").toUpperCase(),
  }));

  return [...threadComments, ...reviewComments].filter((c) => c.body);
}

function summarizeReviewComments(comments) {
  return comments
    .map((c) => {
      const prefix = c.path ? `Thread comment on ${c.path} by ${c.author}: ` : `Review by ${c.author}: `;
      return `${prefix}${c.body}`.trim();
    })
    .join("\n\n")
    .slice(0, 30000);
}

function mostRecentRejectionComment(comments) {
  const sorted = [...comments].sort((a, b) => {
    const left = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const right = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return right - left;
  });
  const latest = sorted[0];
  if (!latest) return "";
  const prefix = latest.path ? `Thread comment on ${latest.path} by ${latest.author}: ` : `Review by ${latest.author}: `;
  return `${prefix}${latest.body}`.slice(0, 4000);
}

function extractPolicyIntentsFromRulesRows(rows) {
  return rows
    .map((row) => {
      if (row.original_intent) return String(row.original_intent);
      const logic = row.rule_logic && typeof row.rule_logic === "object" ? row.rule_logic : null;
      return logic?.description ? String(logic.description) : null;
    })
    .filter(Boolean)
    .slice(0, 200);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function looksLikeUuid(s) {
  return UUID_RE.test(String(s || "").trim());
}

function parseTenantIdList(raw) {
  return String(raw || "")
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter(looksLikeUuid);
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

async function loadExistingPolicyIntents(pool, tenantId) {
  const { rows } = await pool.query(
    `
    SELECT original_intent, rule_logic
    FROM rules_library
    WHERE tenant_id::text = $1::text OR tenant_id IS NULL
    ORDER BY is_mandatory DESC, created_at DESC NULLS LAST
    LIMIT 500
    `,
    [tenantId],
  );
  return extractPolicyIntentsFromRulesRows(rows);
}

async function findExistingPrSignal(pool, tenantId, githubPrId) {
  const { rows } = await pool.query(
    `
    SELECT id::text AS id, status
    FROM pr_signals
    WHERE tenant_id = $1::uuid
      AND github_pr_id = $2::bigint
    LIMIT 1
    `,
    [tenantId, githubPrId],
  );
  return rows[0] || null;
}

async function upsertPrSignal(pool, payload) {
  // Keep upsert simple: the analysis endpoint updates by (tenant_id, github_pr_id, repo_name, pr_url).
  const { rows } = await pool.query(
    `
    INSERT INTO pr_signals (
      tenant_id,
      github_pr_id,
      repo_name,
      pr_url,
      rejection_summary,
      diff_snippet,
      status,
      error_log
    )
    VALUES (
      $1::uuid,
      $2::bigint,
      $3::text,
      $4::text,
      $5::text,
      $6::text,
      'pending',
      NULL
    )
    ON CONFLICT (tenant_id, github_pr_id)
    DO UPDATE SET
      repo_name = EXCLUDED.repo_name,
      pr_url = EXCLUDED.pr_url,
      rejection_summary = EXCLUDED.rejection_summary,
      diff_snippet = EXCLUDED.diff_snippet,
      status = 'pending',
      error_log = NULL,
      processed_at = NULL
    RETURNING id::text AS id
    `,
    [
      payload.tenant_id,
      payload.github_pr_id,
      payload.repo_name,
      payload.pr_url,
      payload.reviewer_comments,
      payload.diff_snippet,
    ],
  );
  return rows[0]?.id || null;
}

async function callAnalysisApi(payload) {
  const policyManagerUrl =
    optionalEnv("POLICY_MANAGER_URL", "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}/api/policy-manager` : "");
  if (!policyManagerUrl) throw new Error("POLICY_MANAGER_URL is required (or VERCEL_URL must be set)");

  const authToken =
    optionalEnv("POLICY_MANAGER_AUTH_TOKEN", "") || optionalEnv("MCP_AUTH_TOKEN", "");
  const headers = { "Content-Type": "application/json" };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await fetch(policyManagerUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "analyze-rejection", ...payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Policy manager ${res.status}: ${JSON.stringify(body).slice(0, 1000)}`);
  }
  return body;
}

async function fetchDiff(ownerRepo, number) {
  try {
    return await githubText(`https://api.github.com/repos/${ownerRepo}/pulls/${number}`, {
      Accept: "application/vnd.github.v3.diff",
    });
  } catch (e) {
    // GitHub returns 406 when diff is too large; fallback to per-file patches.
    if (Number(e?.status) !== 406) throw e;
    const files = await githubPullFiles(ownerRepo, number);
    const parts = [];
    for (const f of files) {
      const header = `diff --git a/${f.filename || f.path} b/${f.filename || f.path}\n`;
      const patch = String(f.patch || "").trim();
      if (patch) {
        parts.push(header + patch);
      } else {
        parts.push(
          `${header}@@ metadata @@\n+ [patch omitted by GitHub: binary or very large file]\n+ additions=${f.additions || 0} deletions=${f.deletions || 0}`,
        );
      }
      if (parts.join("\n\n").length > 70000) break;
    }
    if (!parts.length) {
      return "Diff unavailable: GitHub marked PR diff too large (406), and no file patches were returned.";
    }
    return `# Diff fallback (PR too large for full .diff)\n${parts.join("\n\n")}`;
  }
}

async function listCandidatePullsBySearch(searchQuery, maxResults) {
  const data = await githubGraphQL(
    `
    query SearchRejectedPRs($query: String!, $first: Int!) {
      search(query: $query, type: ISSUE, first: $first) {
        nodes {
          ... on PullRequest {
            number
            url
            title
            repository { nameWithOwner }
            reviewThreads(first: 25) {
              nodes {
                isResolved
                comments(first: 20) {
                  nodes {
                    body
                    path
                    createdAt
                    updatedAt
                    author { login }
                  }
                }
              }
            }
            reviews(first: 20, states: [CHANGES_REQUESTED]) {
              nodes {
                body
                state
                submittedAt
                author { login }
              }
            }
          }
        }
      }
    }
    `,
    { query: searchQuery, first: maxResults },
  );

  return (data?.search?.nodes || [])
    .filter((node) => node?.repository?.nameWithOwner && typeof node?.number === "number")
    .map((pr) => {
      const discussionComments = flattenDiscussionComments(pr);
      return { pr, discussionComments };
    })
    .filter((entry) => entry.discussionComments.some((c) => c.body.length > 10));
}

async function handler(req, res) {
  // Optional auth for manual triggering.
  const authTokenExpected = optionalEnv("TOP_PR_REJECTIONS_AUTH_TOKEN", "");
  if (authTokenExpected) {
    const authHeader = String(req.headers.authorization || "");
    const m = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!m || m[1] !== authTokenExpected) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
  }

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST" && req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    requireAuth(req);
  } catch (e) {
    res.statusCode = Number(e?.statusCode || 401);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
    return;
  }

  const pool = getPool();

  const url = new URL(req.url || "", "http://localhost");
  const limit = Number(url.searchParams.get("limit") || optionalEnv("TOP_REJECTION_LIMIT", "5"));
  const topN = Math.max(1, Math.min(500, Number.isFinite(limit) ? limit : 5));
  const maxRuntimeMsRaw = Number(
    url.searchParams.get("maxRuntimeMs") || optionalEnv("TOP_PR_MAX_RUNTIME_MS", "240000"),
  );
  const maxRuntimeMs = Math.max(30_000, Math.min(295_000, Number.isFinite(maxRuntimeMsRaw) ? maxRuntimeMsRaw : 240_000));
  const startedAt = Date.now();

  const tenantIdsFromQuery = parseTenantIdList(url.searchParams.get("tenant_ids"));
  const tenantIdFromQuery = url.searchParams.get("tenant_id");

  const tenantIdsFromEnv = parseTenantIdList(optionalEnv("TEST_TENANT_IDS", ""));
  const tenantIdFromEnv = optionalEnv("TEST_TENANT_ID", "");

  const tenantIds = tenantIdsFromQuery.length
    ? tenantIdsFromQuery
    : tenantIdFromQuery && looksLikeUuid(tenantIdFromQuery)
      ? [tenantIdFromQuery]
      : tenantIdsFromEnv.length
        ? tenantIdsFromEnv
        : tenantIdFromEnv && looksLikeUuid(tenantIdFromEnv)
          ? [tenantIdFromEnv]
          : [];

  if (String(url.searchParams.get("debugTenant") || "").toLowerCase() === "true") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify(
        {
          ok: true,
          tenantIdsFromQuery,
          tenantIdFromQuery: tenantIdFromQuery || null,
          tenantIdsFromEnv,
          tenantIdFromEnv: tenantIdFromEnv || null,
          tenantIdsPicked: tenantIds,
        },
        null,
        2,
      ),
    );
    return;
  }

  // Schema constraint: pr_signals.tenant_id is NOT NULL. If no tenant IDs are provided,
  // we can still "search all GitHub", but we must skip persistence/update because we can't insert.
  if (!tenantIds.length) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "Provide TEST_TENANT_ID or TEST_TENANT_IDS (tenant_id is NOT NULL in pr_signals)." }));
    return;
  }

  const policyIntentCache = new Map();
  async function getPolicyIntentsForTenant(tid) {
    if (policyIntentCache.has(tid)) return policyIntentCache.get(tid);
    const intents = await loadExistingPolicyIntents(pool, tid);
    policyIntentCache.set(tid, intents);
    return intents;
  }

  const repoSearchQuery = String(optionalEnv("REPO_SEARCH_QUERY", 'is:pr is:closed is:unmerged stars:>1000 "vite" in:path "react" in:path comments:>15'));

  try {
    const candidates = await listCandidatePullsBySearch(repoSearchQuery, Math.max(topN * 2, 20));
    const summary = [];
    let timedOut = false;

    let analyzedCount = 0;
    for (const { pr, discussionComments } of candidates) {
      if (Date.now() - startedAt >= maxRuntimeMs) {
        timedOut = true;
        summary.push({
          status: "stopped-runtime-budget",
          note: `Stopped early to avoid function timeout (${maxRuntimeMs}ms budget).`,
        });
        break;
      }
      if (analyzedCount >= topN) break;

      const ownerRepo = String(pr.repository.nameWithOwner);
      const githubPrId = pr.number;

      const tenantId = pickRandom(tenantIds);

      const existing = await findExistingPrSignal(pool, tenantId, githubPrId);
      if (existing) {
        summary.push({ repo: ownerRepo, pr: githubPrId, status: "duplicate-skipped", row_id: existing.id });
        continue;
      }

      const reviewerCommentsFull = summarizeReviewComments(discussionComments);
      const mostRecentComment = mostRecentRejectionComment(discussionComments);
      const diffSnippet = (await fetchDiff(ownerRepo, githubPrId)).slice(0, 60000);

      const rowId = await upsertPrSignal(pool, {
        tenant_id: tenantId,
        github_pr_id: githubPrId,
        repo_name: ownerRepo,
        pr_url: String(pr.url),
        reviewer_comments: mostRecentComment,
        diff_snippet: diffSnippet,
      });

      const existingPolicyIntents = await getPolicyIntentsForTenant(tenantId);
      try {
        const analysis = await callAnalysisApi({
          tenant_id: tenantId,
          github_pr_id: githubPrId,
          repo_name: ownerRepo,
          pr_url: String(pr.url),
          reviewer_comments: reviewerCommentsFull,
          diff_snippet: diffSnippet,
          existing_policy_intents: existingPolicyIntents,
        });

        summary.push({
          repo: ownerRepo,
          pr: githubPrId,
          title: pr.title,
          row_id: rowId,
          status: analysis.persisted?.updated ? "processed" : "not-updated",
          action: analysis.action,
          priority: analysis.priority,
        });
      } catch (e) {
        summary.push({
          repo: ownerRepo,
          pr: githubPrId,
          title: pr.title,
          row_id: rowId,
          status: "analysis-error",
          error: String(e?.message || e).slice(0, 500),
        });
      }

      analyzedCount += 1;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify(
        {
          ok: true,
          processed: analyzedCount,
          timedOut,
          elapsedMs: Date.now() - startedAt,
          results: summary,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
  }
}

export default withRateLimit(handler, { max: 20, windowMs: 60_000 });

