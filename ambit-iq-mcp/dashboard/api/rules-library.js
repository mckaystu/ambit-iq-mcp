import { getPool } from "./_pool.js";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
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

function normTags(v) {
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) {
    return v
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function normIndustry(v) {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

function normTenantUuid(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return re.test(s) ? s : null;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.end();
  }

  const method = req.method || "GET";

  try {
    const pool = getPool();

    if (method === "GET") {
      const { rows } = await pool.query(
        `
        SELECT
          rule_id::text AS rule_id,
          tenant_id::text AS tenant_id,
          industry_id,
          compliance_tags,
          domain_id,
          rule_name,
          rule_logic,
          is_mandatory,
          created_at
        FROM rules_library
        ORDER BY created_at ASC NULLS LAST, rule_name ASC
        `,
      );
      const rules = rows.map((r) => ({
        rule_id: String(r.rule_id),
        tenant_id: r.tenant_id != null ? String(r.tenant_id) : null,
        industry_id: r.industry_id != null ? String(r.industry_id) : null,
        compliance_tags: Array.isArray(r.compliance_tags) ? r.compliance_tags.map(String) : [],
        domain_id: r.domain_id != null ? String(r.domain_id) : null,
        rule_name: String(r.rule_name || ""),
        rule_logic: r.rule_logic && typeof r.rule_logic === "object" ? r.rule_logic : {},
        is_mandatory: Boolean(r.is_mandatory),
        created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
      }));
      return sendJson(res, 200, { rules });
    }

    if (method === "POST" || method === "PUT") {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return sendJson(res, 400, { error: "Invalid JSON body" });
      }

      const rule_name = String(body.rule_name || "").trim();
      const domain_id = String(body.domain_id || "quality").trim() || "quality";
      const industry_id = normIndustry(body.industry_id);
      const compliance_tags = normTags(body.compliance_tags);
      const is_mandatory = Boolean(body.is_mandatory);
      const tenant_id = normTenantUuid(body.tenant_id);
      let rule_logic = body.rule_logic;
      if (typeof rule_logic === "string") {
        try {
          rule_logic = JSON.parse(rule_logic);
        } catch {
          return sendJson(res, 400, { error: "rule_logic must be valid JSON" });
        }
      }
      if (!rule_logic || typeof rule_logic !== "object" || Array.isArray(rule_logic)) {
        return sendJson(res, 400, { error: "rule_logic must be a JSON object (e.g. id, pattern, severity, action, description)" });
      }
      if (!rule_name) {
        return sendJson(res, 400, { error: "rule_name is required" });
      }

      if (method === "POST") {
        const ins = await pool.query(
          `
          INSERT INTO rules_library
            (tenant_id, industry_id, compliance_tags, domain_id, rule_name, rule_logic, is_mandatory)
          VALUES ($1::uuid, $2::varchar(50), $3::text[], $4::varchar(50), $5::text, $6::jsonb, $7::boolean)
          RETURNING
            rule_id::text AS rule_id,
            tenant_id::text AS tenant_id,
            industry_id,
            compliance_tags,
            domain_id,
            rule_name,
            rule_logic,
            is_mandatory,
            created_at
          `,
          [tenant_id, industry_id, compliance_tags, domain_id, rule_name, JSON.stringify(rule_logic), is_mandatory],
        );
        const r = ins.rows[0];
        return sendJson(res, 201, {
          rule: {
            rule_id: String(r.rule_id),
            tenant_id: r.tenant_id != null ? String(r.tenant_id) : null,
            industry_id: r.industry_id != null ? String(r.industry_id) : null,
            compliance_tags: Array.isArray(r.compliance_tags) ? r.compliance_tags.map(String) : [],
            domain_id: r.domain_id != null ? String(r.domain_id) : null,
            rule_name: String(r.rule_name || ""),
            rule_logic: r.rule_logic && typeof r.rule_logic === "object" ? r.rule_logic : {},
            is_mandatory: Boolean(r.is_mandatory),
            created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
          },
        });
      }

      const rule_id = String(body.rule_id || "").trim();
      if (!rule_id) {
        return sendJson(res, 400, { error: "rule_id is required for update" });
      }

      const upd = await pool.query(
        `
        UPDATE rules_library SET
          tenant_id = $2::uuid,
          industry_id = $3::varchar(50),
          compliance_tags = $4::text[],
          domain_id = $5::varchar(50),
          rule_name = $6::text,
          rule_logic = $7::jsonb,
          is_mandatory = $8::boolean
        WHERE rule_id = $1::uuid
        RETURNING
          rule_id::text AS rule_id,
          tenant_id::text AS tenant_id,
          industry_id,
          compliance_tags,
          domain_id,
          rule_name,
          rule_logic,
          is_mandatory,
          created_at
        `,
        [
          rule_id,
          tenant_id,
          industry_id,
          compliance_tags,
          domain_id,
          rule_name,
          JSON.stringify(rule_logic),
          is_mandatory,
        ],
      );
      if (!upd.rows.length) {
        return sendJson(res, 404, { error: "rule_id not found" });
      }
      const r = upd.rows[0];
      return sendJson(res, 200, {
        rule: {
          rule_id: String(r.rule_id),
          tenant_id: r.tenant_id != null ? String(r.tenant_id) : null,
          industry_id: r.industry_id != null ? String(r.industry_id) : null,
          compliance_tags: Array.isArray(r.compliance_tags) ? r.compliance_tags.map(String) : [],
          domain_id: r.domain_id != null ? String(r.domain_id) : null,
          rule_name: String(r.rule_name || ""),
          rule_logic: r.rule_logic && typeof r.rule_logic === "object" ? r.rule_logic : {},
          is_mandatory: Boolean(r.is_mandatory),
          created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
        },
      });
    }

    return sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return sendJson(res, 500, {
      error: String(error),
      note: "rules_library API failed. Check DATABASE_URL and rules_library table schema.",
    });
  }
}
