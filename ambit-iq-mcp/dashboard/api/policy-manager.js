import { getPool } from "./_pool.js";
import { requireAuth } from "./_auth.js";
import { withRateLimit, safeJson } from "./_security.js";
import OpenAI from "openai";
import { extractAgentGateTestPattern, normalizeAgentGateRegexSource } from "../../lib/agentGateRegexComment.mjs";
import { resolveShadowImpactMatcher } from "../../lib/shadowImpactResolve.mjs";
import {
  processVimlPreviewRequest,
  validateOptionalVimlForGenerate,
  buildGeneratePayloadVimlPreview,
  mergeVimlDocumentIntoRuleLogic,
} from "../../lib/vimlPolicyIdeActions.mjs";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

const OPENAI_SYSTEM = `You are an expert assistant for Project Vail governance policy drafting.
Return ONLY a single JSON object (no markdown fences) with exactly these keys:
- "rego_code": string — a concise OPA Rego module or stub (package + illustrative rules). It MUST contain a line that matches /^#\\s*AGENT_GATE:test\\s+(.+)$/m where the captured part is ONE JavaScript-compatible regular expression source (no / delimiters) used with new RegExp(...) to scan TypeScript/JavaScript code for violations matching the user's intent. Put that comment near the top. Never prefix that regex with PCRE-only inline flags like (?i) or (?m); the scanner applies case-insensitivity and may normalize flags separately.
- "rule_logic": object with keys "id" (unique string like NL-abc123), "pattern" (same regex string as in AGENT_GATE:test), "severity" ("BLOCKER"|"HIGH"|"MEDIUM"), "action" (short remediation title), "description" (one sentence rationale).
- "rule_name": short human-readable title.

Keep regex patterns bounded and safe (no catastrophic backtracking); prefer simple alternations over nested quantifiers.`;

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferPatternFromIntent(intent) {
  const text = String(intent || "").toLowerCase();
  const tokens = text
    .split(/[^a-z0-9_]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4)
    .filter((t) => !["ensure", "should", "must", "with", "from", "that", "this", "rule", "policy"].includes(t));
  const uniq = [...new Set(tokens)].slice(0, 8);
  if (!uniq.length) return "TODO_POLICY_PATTERN";
  return uniq.map((t) => escapeRegex(t)).join("|");
}

const PR_REJECTION_SYSTEM = `Context: You are an expert Architectural Critic and OPA Specialist. You are analyzing Pull Request rejections stored in a Neon DB to improve the Ambit.iq governance platform.

Your Objective: Analyze a rejected PR to identify why human reviewers blocked it, then suggest a logic update or a new policy for the Ambit.iq Natural Language Creator.

1. ANALYTICAL FRAMEWORK
Identify the "Rejection Root": Distinguish between administrative noise (typos, docs) and Architectural Violations (security, performance, compliance, pattern drift).

Gap Analysis: Use existing policy intents/rules to determine if Ambit.iq was "blind" to this issue.

Refinement Logic: If the code was rejected for a reason Ambit.iq already monitors, determine if the current rule is too permissive (False Negative) or too strict (False Positive).

2. INSTRUCTIONS FOR AI INSIGHT
Categorize: Assign the rejection to a governance domain (e.g., Data Privacy, Resource Exhaustion, API Standards).

Logic Extraction: Translate the human grievance into a machine-testable logic statement.

Tweak Proposal:
- If NEW_RULE: Create a clear, high-fidelity natural language intent.
- If REFINE_RULE: Provide the specific constraint change.

Multitenant Safety: Ensure suggested logic is scoped to the provided tenant_id.

OUTPUT CONTRACT:
Return STRICT JSON ONLY with exactly these keys:
{
  "tenant_id": "string",
  "action": "NEW_RULE" | "REFINE_RULE" | "NO_ACTION",
  "reasoning": "string",
  "natural_language_intent": "string",
  "efficacy_improvement": "string",
  "priority": "HIGH" | "MEDIUM" | "LOW",
  "metadata": {
    "repo": "string",
    "category": "string",
    "suggested_rego_logic": "string"
  }
}`;

/**
 * @param {string} intent
 * @returns {Promise<{ rego_code: string, rule_logic: object, rule_name: string, pattern_used: string, source: string, model: string }>}
 */
async function generateFromOpenAI(intent) {
  const key = String(process.env.OPENAI_API_KEY || "").trim();
  if (!key) {
    const err = new Error("OPENAI_API_KEY is not set");
    err.code = "NO_KEY";
    throw err;
  }
  const model = String(process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.25,
      max_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: OPENAI_SYSTEM },
        { role: "user", content: `Plain English intent:\n${intent.slice(0, 12000)}` },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || JSON.stringify(data).slice(0, 500);
    const err = new Error(msg);
    err.code = "OPENAI_HTTP";
    throw err;
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    const err = new Error("Empty model response");
    err.code = "OPENAI_EMPTY";
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) {
      const err = new Error("Model did not return parseable JSON");
      err.code = "OPENAI_PARSE";
      throw err;
    }
    parsed = JSON.parse(m[0]);
  }
  if (!parsed || typeof parsed.rego_code !== "string") {
    const err = new Error("JSON missing rego_code");
    err.code = "OPENAI_SHAPE";
    throw err;
  }
  let rego_code = parsed.rego_code;
  const rule_logic = parsed.rule_logic && typeof parsed.rule_logic === "object" ? { ...parsed.rule_logic } : {};
  rule_logic._source = "live_policy_editor_openai";
  const warnings = [];
  let pattern = String(rule_logic.pattern || "").trim();
  if (!pattern) {
    const extracted = extractAgentGateTestPattern(rego_code);
    if (extracted) {
      pattern = extracted;
      warnings.push("Recovered missing rule_logic.pattern from AGENT_GATE test comment.");
    }
  }
  if (!pattern) {
    pattern = inferPatternFromIntent(intent);
    warnings.push("Model response omitted pattern; generated fallback pattern from intent keywords.");
  }
  let norm = normalizeAgentGateRegexSource(pattern);
  if (norm.hadInline) {
    warnings.push(
      "Normalized regex: removed JavaScript-incompatible inline (?i)/(?m)/(?s) groups; impact scan uses RegExp flags instead.",
    );
  }
  pattern = norm.source;
  try {
    void new RegExp(pattern, norm.flags);
  } catch (e) {
    pattern = inferPatternFromIntent(intent);
    warnings.push("Model provided invalid regex pattern; replaced with safe fallback pattern.");
    norm = normalizeAgentGateRegexSource(pattern);
    pattern = norm.source;
    try {
      void new RegExp(pattern, norm.flags);
    } catch (e2) {
      const err = new Error(`Invalid regex in pattern after fallback: ${e2}`);
      err.code = "OPENAI_REGEX";
      throw err;
    }
  }
  rule_logic.pattern = pattern;
  if (!/#\s*(?:AGENT_GATE|AMBIT):test\s+/im.test(rego_code)) {
    rego_code = `# AGENT_GATE:test ${pattern}\n${rego_code}`;
  }
  const rule_name = String(parsed.rule_name || "Generated policy").trim() || "Generated policy";
  return { rego_code, rule_logic, rule_name, pattern_used: pattern, source: "openai", model, warnings };
}

function parseJsonObjectFromModelContent(content) {
  if (!content || typeof content !== "string") {
    const err = new Error("Empty model response");
    err.code = "OPENAI_EMPTY";
    throw err;
  }
  try {
    return JSON.parse(content.trim());
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) {
      const err = new Error("Model did not return parseable JSON");
      err.code = "OPENAI_PARSE";
      throw err;
    }
    return JSON.parse(m[0]);
  }
}

function normalizeAnalysisOutput(out, fallbackTenantId, fallbackRepo) {
  const actionRaw = String(out?.action || "NO_ACTION").trim().toUpperCase();
  const action =
    actionRaw === "NEW_RULE" || actionRaw === "REFINE_RULE" || actionRaw === "NO_ACTION"
      ? actionRaw
      : "NO_ACTION";

  const priorityRaw = String(out?.priority || "MEDIUM").trim().toUpperCase();
  const priority = priorityRaw === "HIGH" || priorityRaw === "LOW" ? priorityRaw : "MEDIUM";

  const metadataIn = out?.metadata && typeof out.metadata === "object" ? out.metadata : {};
  const metadata = {
    repo: String(metadataIn.repo || fallbackRepo || "unknown-repo"),
    category: String(metadataIn.category || "Maintainability"),
    suggested_rego_logic: String(metadataIn.suggested_rego_logic || ""),
  };

  return {
    tenant_id: String(out?.tenant_id || fallbackTenantId || ""),
    action,
    reasoning: String(out?.reasoning || ""),
    natural_language_intent: String(out?.natural_language_intent || ""),
    efficacy_improvement: String(out?.efficacy_improvement || ""),
    priority,
    metadata,
  };
}

/**
 * @returns {Promise<{tenant_id:string,action:"NEW_RULE"|"REFINE_RULE"|"NO_ACTION",reasoning:string,natural_language_intent:string,efficacy_improvement:string,priority:"HIGH"|"MEDIUM"|"LOW",metadata:{repo:string,category:string,suggested_rego_logic:string},model:string}>}
 */
async function analyzePrRejection(input) {
  const key = String(process.env.OPENAI_API_KEY || "").trim();
  if (!key) {
    const err = new Error("OPENAI_API_KEY is not set");
    err.code = "NO_KEY";
    throw err;
  }

  const model = String(process.env.OPENAI_ANALYSIS_MODEL || "gpt-4o").trim();
  const client = new OpenAI({ apiKey: key });
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PR_REJECTION_SYSTEM },
      {
        role: "user",
        content: JSON.stringify(
          {
            tenant_id: input.tenant_id,
            existing_policy_intents: input.existing_policy_intents,
            repo_name: input.repo_name,
            reviewer_comments: input.reviewer_comments,
            diff_snippet: input.diff_snippet,
          },
          null,
          2,
        ),
      },
    ],
  });

  const content = completion.choices?.[0]?.message?.content;
  const parsed = parseJsonObjectFromModelContent(content);
  const normalized = normalizeAnalysisOutput(parsed, input.tenant_id, input.repo_name);
  return { ...normalized, model };
}

async function persistPrSignalAnalysis(pool, payload) {
  const analysisSummary = {
    action: payload.action,
    reasoning: payload.reasoning,
    natural_language_intent: payload.natural_language_intent,
    efficacy_improvement: payload.efficacy_improvement,
    priority: payload.priority,
    metadata: payload.metadata,
    model: payload.model,
  };

  const result = await pool.query(
    `
    UPDATE pr_signals
    SET
      rejection_summary = $5::text,
      diff_snippet = COALESCE(NULLIF($6::text, ''), diff_snippet),
      status = 'processed',
      error_log = NULL,
      processed_at = now()
    WHERE tenant_id = $1::uuid
      AND github_pr_id = $2::bigint
      AND repo_name = $3::text
      AND pr_url = $4::text
    RETURNING id::text AS id
    `,
    [
      payload.tenant_id,
      payload.github_pr_id,
      payload.repo_name,
      payload.pr_url,
      JSON.stringify(analysisSummary),
      payload.diff_snippet || "",
    ],
  );

  return {
    updated: result.rowCount > 0,
    id: result.rows[0]?.id || null,
  };
}

async function markPrSignalAnalysisError(pool, payload) {
  await pool.query(
    `
    UPDATE pr_signals
    SET
      status = 'error',
      error_log = LEFT($5::text, 8000),
      processed_at = now()
    WHERE tenant_id = $1::uuid
      AND github_pr_id = $2::bigint
      AND repo_name = $3::text
      AND pr_url = $4::text
    `,
    [payload.tenant_id, payload.github_pr_id, payload.repo_name, payload.pr_url, payload.error_log],
  );
}

function classifyActor(row) {
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const role = String(meta.actor_type || meta.role || meta.principal_type || "").toLowerCase();
  if (role.includes("human") || role === "user") return "human";
  if (role.includes("agent") || role.includes("bot") || role.includes("assistant")) return "agent";
  const aid = String(row.actor_id || "").toLowerCase();
  if (aid.startsWith("human") || aid.includes("user-")) return "human";
  return "agent";
}

async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.end();
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    requireAuth(req);
  } catch (e) {
    return sendJson(res, Number(e?.statusCode || 401), { error: String(e?.message || e) });
  }

  let body;
  try {
    body = await safeJson(req, { limitBytes: 1024 * 1024 });
  } catch (e) {
    return sendJson(res, Number(e?.statusCode || 400), { error: String(e?.message || e) });
  }

  const action = String(body.action || "").trim();

  // Restrict bearer auth to machine-to-machine analysis path only.
  // Keep browser-driven Policy IDE actions usable without leaking tokens to the client.
  if (action === "analyze-rejection") {
    const expectedToken = String(process.env.POLICY_MANAGER_AUTH_TOKEN || "").trim();
    if (expectedToken) {
      const authHeader = String(req.headers.authorization || "");
      const m = /^Bearer\s+(.+)$/i.exec(authHeader);
      const incoming = m ? m[1] : "";
      if (!incoming || incoming !== expectedToken) {
        return sendJson(res, 401, { error: "Unauthorized" });
      }
    }
  }
  const pool = getPool();

  try {
    if (action === "viml-preview") {
      const r = processVimlPreviewRequest(body);
      return sendJson(res, r.status, r.json);
    }

    if (action === "generate") {
      const intent = String(body.intent || "").trim();
      if (!intent) return sendJson(res, 400, { error: "intent is required" });
      const vimlRaw = String(body.viml || "").trim();
      const vimlCheck = validateOptionalVimlForGenerate(vimlRaw);
      if (!vimlCheck.ok) {
        return sendJson(res, vimlCheck.status, vimlCheck.json);
      }
      const hasKey = Boolean(String(process.env.OPENAI_API_KEY || "").trim());
      if (!hasKey) {
        return sendJson(res, 503, {
          error:
            "OPENAI_API_KEY is not configured on this deployment. The Policy IDE requires OpenAI for generation.",
          code: "NO_KEY",
        });
      }
      try {
        const out = await generateFromOpenAI(intent);
        let payload = { ok: true, ...out, original_intent: intent };
        const preview = buildGeneratePayloadVimlPreview(vimlRaw);
        if (preview) payload = { ...payload, viml_preview: preview };
        return sendJson(res, 200, payload);
      } catch (e) {
        const msg = String(e?.message || e);
        const code = e?.code || "GENERATION_FAILED";
        return sendJson(res, 502, { error: msg, code });
      }
    }

    if (action === "analyze-rejection") {
      const tenant_id = String(body.tenant_id || "").trim();
      const repo_name = String(body.repo_name || "").trim();
      const github_pr_id = Number(body.github_pr_id);
      const pr_url = String(body.pr_url || "").trim();
      const reviewer_comments = String(body.reviewer_comments ?? body.comments_text ?? "").trim();
      const diff_snippet = String(body.diff_snippet || "").trim();
      const existing_policy_intents = body.existing_policy_intents ?? body.existing_rules ?? [];
      if (!tenant_id) return sendJson(res, 400, { error: "tenant_id is required" });
      if (!repo_name) return sendJson(res, 400, { error: "repo_name is required" });
      if (!Number.isFinite(github_pr_id) || github_pr_id <= 0) {
        return sendJson(res, 400, { error: "github_pr_id is required" });
      }
      if (!pr_url) return sendJson(res, 400, { error: "pr_url is required" });
      if (!reviewer_comments) return sendJson(res, 400, { error: "reviewer_comments is required" });
      if (!diff_snippet) return sendJson(res, 400, { error: "diff_snippet is required" });

      try {
        const analysis = await analyzePrRejection({
          tenant_id,
          repo_name,
          reviewer_comments: reviewer_comments.slice(0, 30000),
          diff_snippet: diff_snippet.slice(0, 60000),
          existing_policy_intents,
        });
        const persisted = await persistPrSignalAnalysis(pool, {
          tenant_id,
          github_pr_id,
          repo_name,
          pr_url,
          diff_snippet,
          ...analysis,
        });
        return sendJson(res, 200, { ok: true, ...analysis, persisted });
      } catch (e) {
        const msg = String(e?.message || e);
        const code = e?.code || "ANALYSIS_FAILED";
        try {
          await markPrSignalAnalysisError(pool, {
            tenant_id,
            github_pr_id,
            repo_name,
            pr_url,
            error_log: `[${code}] ${msg}`,
          });
        } catch {
          /* best effort only */
        }
        return sendJson(res, 502, { error: msg, code });
      }
    }

    if (action === "shadow-impact") {
      const hours = Math.min(168, Math.max(1, Number(body.hours) || 24));
      const resolved = resolveShadowImpactMatcher(body);
      if (resolved.type === "error") {
        return sendJson(res, resolved.status, resolved.json);
      }
      if (resolved.type === "empty") {
        return sendJson(res, resolved.status, resolved.json);
      }
      const { impact_mode, wouldFlag, meta } = resolved;

      const { rows } = await pool.query(
        `
        SELECT proposed_code, metadata, actor_id
        FROM ambit_decision_logs
        WHERE timestamp >= (now() - ($1::int * interval '1 hour'))
        ORDER BY timestamp DESC
        LIMIT 5000
        `,
        [hours],
      );

      let agent = 0;
      let human = 0;
      for (const row of rows) {
        const code = String(row.proposed_code || "");
        if (!wouldFlag(code)) continue;
        const c = classifyActor(row);
        if (c === "human") human += 1;
        else agent += 1;
      }

      const total = agent + human;
      const ruleId = body.rule_id ? String(body.rule_id).trim() : "";
      if (ruleId && /^[0-9a-f-]{36}$/i.test(ruleId)) {
        await pool.query(
          `UPDATE rules_library SET last_tested_at = now() WHERE rule_id = $1::uuid`,
          [ruleId],
        );
      }

      return sendJson(res, 200, {
        ok: true,
        impact_mode,
        rows_scanned: rows.length,
        flagged_total: total,
        flagged_agent: agent,
        flagged_human: human,
        hours,
        ...(meta?.pattern != null ? { pattern: meta.pattern, pattern_flags: meta.pattern_flags } : {}),
        ...(meta?.viml_profile !== undefined ? { viml_profile: meta.viml_profile } : {}),
        ...(meta?.enforce_rule_count != null ? { enforce_rule_count: meta.enforce_rule_count } : {}),
      });
    }

    if (action === "deploy-shadow") {
      const original_intent = String(body.original_intent || "").trim();
      const rego_code = String(body.rego_code || "").trim();
      const rule_name = String(body.rule_name || "").trim() || "Untitled shadow rule";
      const vimlDeploy = String(body.viml || "").trim();
      let rule_logic = body.rule_logic;
      if (typeof rule_logic === "string") {
        try {
          rule_logic = JSON.parse(rule_logic);
        } catch {
          return sendJson(res, 400, { error: "rule_logic must be valid JSON" });
        }
      }
      if (!rule_logic || typeof rule_logic !== "object") {
        return sendJson(res, 400, { error: "rule_logic object is required" });
      }
      const merged = mergeVimlDocumentIntoRuleLogic(rule_logic, vimlDeploy);
      if (!merged.ok) {
        return sendJson(res, 400, merged.json);
      }
      rule_logic = merged.rule_logic;

      const ins = await pool.query(
        `
        INSERT INTO rules_library (
          tenant_id,
          industry_id,
          compliance_tags,
          domain_id,
          rule_name,
          rule_logic,
          is_mandatory,
          original_intent,
          rego_code,
          status
        )
        VALUES (
          NULL,
          NULL,
          ARRAY['live-policy-editor']::text[],
          'regulatory',
          $1::text,
          $2::jsonb,
          false,
          $3::text,
          $4::text,
          'shadow'
        )
        RETURNING rule_id::text AS rule_id
        `,
        [rule_name, JSON.stringify(rule_logic), original_intent || null, rego_code || null],
      );

      return sendJson(res, 201, {
        ok: true,
        rule_id: ins.rows[0]?.rule_id,
        status: "shadow",
      });
    }

    return sendJson(res, 400, {
      error:
        "Unknown action. Use generate, viml-preview, analyze-rejection, shadow-impact, or deploy-shadow.",
    });
  } catch (error) {
    const msg = String(error);
    if (msg.includes("column") && msg.includes("does not exist")) {
      return sendJson(res, 500, {
        error: msg,
        note: "Apply migrations/003_rules_library_policy_editor.sql to add policy editor columns.",
      });
    }
    return sendJson(res, 500, { error: msg });
  }
}

export default withRateLimit(handler, { max: 60, windowMs: 60_000 });
