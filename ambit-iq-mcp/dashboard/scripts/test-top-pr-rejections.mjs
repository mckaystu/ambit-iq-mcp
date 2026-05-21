import { Pool } from "pg";

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optionalEnv(name, fallback = "") {
  return String(process.env[name] || "").trim() || fallback;
}

function githubHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${requireEnv("GITHUB_TOKEN")}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "project-vail-pr-rejection-tester",
    ...extra,
  };
}

async function githubJson(url) {
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${url}: ${await res.text()}`);
  }
  return res.json();
}

async function githubText(url, extraHeaders = {}) {
  const res = await fetch(url, { headers: githubHeaders(extraHeaders) });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${url}: ${await res.text()}`);
  }
  return res.text();
}

async function githubGraphQL(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: githubHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) {
    throw new Error(`GitHub GraphQL failed: ${JSON.stringify(body.errors || body).slice(0, 1000)}`);
  }
  return body.data;
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
      isResolved: Boolean(thread?.isResolved),
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
      const prefix =
        c.source === "thread" && c.path
          ? `Thread comment on ${c.path} by ${c.author}: `
          : `Review by ${c.author}: `;
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
  const prefix =
    latest.source === "thread" && latest.path
      ? `Thread comment on ${latest.path} by ${latest.author}: `
      : `Review by ${latest.author}: `;
  return `${prefix}${latest.body}`.slice(0, 4000);
}

function extractPolicyIntents(rows) {
  return rows
    .map((row) => {
      if (row.original_intent) return String(row.original_intent);
      const logic = row.rule_logic && typeof row.rule_logic === "object" ? row.rule_logic : null;
      return logic?.description ? String(logic.description) : null;
    })
    .filter(Boolean)
    .slice(0, 200);
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
  return extractPolicyIntents(rows);
}

async function listCandidatePulls(query, limit) {
  const data = await githubGraphQL(
    `
    query SearchRejectedPRs($query: String!, $first: Int!) {
      search(query: $query, type: ISSUE, first: $first) {
        nodes {
          ... on PullRequest {
            number
            title
            url
            repository {
              nameWithOwner
            }
            reviewThreads(first: 25) {
              nodes {
                isResolved
                comments(first: 20) {
                  nodes {
                    body
                    path
                    createdAt
                    updatedAt
                    author {
                      login
                    }
                  }
                }
              }
            }
            reviews(first: 20, states: [CHANGES_REQUESTED]) {
              nodes {
                body
                state
                submittedAt
                author {
                  login
                }
              }
            }
          }
        }
      }
    }
    `,
    { query, first: limit },
  );

  return (data?.search?.nodes || [])
    .filter((node) => node?.repository?.nameWithOwner && typeof node?.number === "number")
    .map((pr) => ({
      pr,
      discussionComments: flattenDiscussionComments(pr),
    }))
    .filter((entry) => entry.discussionComments.some((c) => c.body.length > 10));
}

async function fetchDiff(ownerRepo, number) {
  return githubText(`https://api.github.com/repos/${ownerRepo}/pulls/${number}`, {
    Accept: "application/vnd.github.v3.diff",
  });
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
  const baseUrl = requireEnv("POLICY_MANAGER_URL");
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "analyze-rejection",
      ...payload,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Policy manager ${res.status}: ${JSON.stringify(body).slice(0, 1000)}`);
  }
  return body;
}

async function main() {
  const tenantId = requireEnv("TEST_TENANT_ID");
  const connectionString = requireEnv("DATABASE_URL");
  const pool = new Pool({ connectionString, max: 5 });
  const topRejectionsTotal = Math.max(1, Math.min(500, Number(optionalEnv("TOP_REJECTION_LIMIT", "5")) || 5));
  const repoSearchQuery = String(
    optionalEnv(
      "REPO_SEARCH_QUERY",
      'is:pr is:closed is:unmerged stars:>1000 "vite" in:path "react" in:path comments:>15',
    ),
  );

  try {
    const existingPolicyIntents = await loadExistingPolicyIntents(pool, tenantId);
    const candidates = await listCandidatePulls(repoSearchQuery, Math.max(topRejectionsTotal * 2, 20));
    if (!candidates.length) {
      console.log("No qualifying rejected PRs found.");
      return;
    }

    const summary = [];
    let analyzedCount = 0;

    for (const { pr, discussionComments } of candidates) {
      if (analyzedCount >= topRejectionsTotal) break;

      const ownerRepo = String(pr.repository.nameWithOwner);
      const existing = await findExistingPrSignal(pool, tenantId, pr.number);
      if (existing) {
        summary.push({
          repo: ownerRepo,
          pr: pr.number,
          title: pr.title,
          row_id: existing.id,
          status: "duplicate-skipped",
        });
        continue;
      }

      const reviewerComments = summarizeReviewComments(discussionComments);
      const mostRecentComment = mostRecentRejectionComment(discussionComments);
      const diffSnippet = (await fetchDiff(ownerRepo, pr.number)).slice(0, 60000);

      const persistedId = await upsertPrSignal(pool, {
        tenant_id: tenantId,
        github_pr_id: pr.number,
        repo_name: ownerRepo,
        pr_url: pr.url,
        reviewer_comments: mostRecentComment,
        diff_snippet: diffSnippet,
      });

      const analysis = await callAnalysisApi({
        tenant_id: tenantId,
        github_pr_id: pr.number,
        repo_name: ownerRepo,
        pr_url: pr.url,
        reviewer_comments: reviewerComments,
        diff_snippet: diffSnippet,
        existing_policy_intents: existingPolicyIntents,
      });

      summary.push({
        repo: ownerRepo,
        pr: pr.number,
        title: pr.title,
        row_id: persistedId,
        status: analysis.persisted?.updated ? "processed" : "not-updated",
        action: analysis.action,
        priority: analysis.priority,
      });

      analyzedCount += 1;

      const delayMs = Number(optionalEnv("GITHUB_REQUEST_DELAY_MS", "0")) || 0;
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    console.log(JSON.stringify({ ok: true, processed: summary.length, results: summary }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
  process.exitCode = 1;
});
