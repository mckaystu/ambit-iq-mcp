import { getPool } from "./_pool.js";
import { requireAuth } from "./_auth.js";
import { logAdminAction } from "./_admin-audit.js";
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

function assessRisk(model) {
  const reasons = [];
  let score = 0;
  const host = String(model.hostingType || model.hosting_type || "").toLowerCase();
  const cls = String(model.dataClassification || model.data_classification || "").toLowerCase();
  const promptRetention = String(model.promptRetentionPolicy || model.prompt_retention_policy || "").toLowerCase();
  const responseRetention = String(model.responseRetentionPolicy || model.response_retention_policy || "").toLowerCase();
  const training = model.trainingUsageAllowed ?? model.training_usage_allowed;
  if (host.includes("external") || host.includes("saas")) {
    score += 4;
    reasons.push("External/SaaS hosting");
  }
  if (training === true && (cls.includes("regulated") || cls.includes("restricted"))) {
    score += 5;
    reasons.push("Training allowed on regulated/restricted data");
  }
  if (!promptRetention || !responseRetention || promptRetention === "unknown" || responseRetention === "unknown") {
    score += 4;
    reasons.push("Unknown retention policy");
  }
  if (!model.modelVersion && !model.model_version) {
    score += 2;
    reasons.push("Missing model version");
  }
  if (!host) {
    score += 2;
    reasons.push("Missing hosting type");
  }
  const level = score >= 7 ? "HIGH" : score >= 3 ? "MEDIUM" : "LOW";
  return { level, rationale: reasons };
}

async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.end();
  }
  try {
    const user = requireAuth(req);
    req.__ambitUser = user;
    const pool = getPool();
    if ((req.method || "GET") === "GET") {
      const url = new URL(req.url, "https://ambitdashboard.local");
      const provider = url.searchParams.get("provider");
      const modelName = url.searchParams.get("model_name");
      const jurisdiction = url.searchParams.get("jurisdiction");
      const params = [];
      const where = [];
      if (provider) { params.push(provider); where.push(`provider = $${params.length}`); }
      if (modelName) { params.push(modelName); where.push(`model_name = $${params.length}`); }
      if (jurisdiction) { params.push(jurisdiction); where.push(`jurisdiction = $${params.length}`); }
      const q = await pool.query(
        `
        SELECT provider, model_name, jurisdiction, count(*)::int AS usage_count
        FROM model_usage
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        GROUP BY 1,2,3
        ORDER BY usage_count DESC
        LIMIT 500
        `,
        params,
      );
      return sendJson(res, 200, { summary: q.rows });
    }
    if ((req.method || "") !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
    let body = {};
    try { body = await safeJson(req); } catch (e) { return sendJson(res, Number(e?.statusCode || 400), { error: String(e?.message || e) }); }
    const action = String(body.action || "").trim();
    if (action === "assess_risk") {
      const model = body.model && typeof body.model === "object" ? body.model : {};
      const risk = assessRisk(model);
      await logAdminAction({ user, action: "governance.assess_risk", metadata: { model: model.modelName || model.model_name || "unknown" } });
      return sendJson(res, 200, { risk });
    }
    if (action === "validate_context") {
      const model = body.model && typeof body.model === "object" ? body.model : {};
      const context = body.context && typeof body.context === "object" ? body.context : {};
      const risk = assessRisk(model);
      const violations = [];
      if (context.regulated_workload && !(model.approvedForRegulatedWorkloads ?? model.approved_for_regulated_workloads)) {
        violations.push("Model not approved for regulated workloads.");
      }
      const decision = violations.length ? "block" : risk.level === "HIGH" ? "warn" : "allow";
      await logAdminAction({ user, action: "governance.validate_context", metadata: { decision } });
      return sendJson(res, 200, {
        allowed: decision !== "block",
        decision,
        violations,
        rationale: [...risk.rationale, ...(violations.length ? violations : [])],
      });
    }
    return sendJson(res, 400, { error: "Unsupported action. Use assess_risk or validate_context." });
  } catch (error) {
    return sendJson(res, Number(error?.statusCode || 500), { error: String(error?.message || error), note: "model-governance API failed." });
  }
}

export default withRateLimit(handler);
