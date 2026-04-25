import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

/** Load ambit-iq-mcp/.env without adding a dotenv dependency (Prisma may not load it for ad-hoc scripts). */
function loadEnvFileIfPresent() {
  const envPath = path.join(repoRoot, ".env");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  /** Last assignment wins (duplicate keys like two DATABASE_URL lines). */
  const fromFile = new Map();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fromFile.set(key, val);
  }
  for (const [key, val] of fromFile) {
    // DATABASE_URL: always use the value from .env when defined there, so a stale
    // `export DATABASE_URL=<placeholder>` in the shell cannot block seeding.
    if (key === "DATABASE_URL") {
      process.env.DATABASE_URL = val;
      continue;
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function assertPostgresDatabaseUrl() {
  loadEnvFileIfPresent();
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) {
    console.error(
      "DATABASE_URL is empty.\n" +
        "Set it in ambit-iq-mcp/.env to a Postgres URL, e.g.\n" +
        '  DATABASE_URL="postgresql://USER:PASSWORD@HOST/db?sslmode=require"\n' +
        "Or run: DATABASE_URL='postgresql://...' npm run db:seed:rules-library",
    );
    process.exit(1);
  }
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    const dupHint =
      url === "..." || url.startsWith("<")
        ? "\nTips:\n" +
          "- If you ever ran `export DATABASE_URL=...` in this terminal, it overrides .env until you run: unset DATABASE_URL\n" +
          "- In .env, remove placeholder DATABASE_URL lines; keep a single real postgresql:// URI (last line wins if duplicates remain)."
        : "";
    console.error(
      "DATABASE_URL must start with postgresql:// or postgres:// (Prisma datasource requirement).\n" +
        `First 48 chars received: ${JSON.stringify(url.slice(0, 48))}\n` +
        "Fix ambit-iq-mcp/.env or export a full Neon/Postgres connection string." +
        dupHint,
    );
    process.exit(1);
  }
}

assertPostgresDatabaseUrl();

const prisma = new PrismaClient();

const seedRules = [
  {
    rule_name: "No hardcoded credentials",
    industry_id: null,
    domain_id: "quality",
    compliance_tags: ["SOC2", "SOX"],
    is_mandatory: true,
    rule_logic: {
      id: "QUAL-001",
      pattern: "(password|secret|api_key|token|auth|credentials)\\s*[:=]\\s*['\\\"][^'\\\"]+['\\\"]",
      severity: "BLOCKER",
      action: "Fail_CI_Build",
      description: "Embedded secrets create immediate compromise risk.",
    },
  },
  {
    rule_name: "Network calls include error handling",
    industry_id: null,
    domain_id: "quality",
    compliance_tags: ["SOC2"],
    is_mandatory: false,
    rule_logic: {
      id: "QUAL-002",
      pattern: "unprotected_network_call",
      severity: "HIGH",
      action: "Require_Try_Catch_Or_Catch_Handler",
      description: "Unhandled network failures reduce reliability.",
    },
  },
  {
    rule_name: "Interactive controls expose accessible names",
    industry_id: null,
    domain_id: "ux",
    compliance_tags: ["AODA", "WCAG"],
    is_mandatory: false,
    rule_logic: {
      id: "UX-001",
      pattern: "<(button|input|select)(?![^>]*(aria-label|aria-labelledby))[^>]*>",
      severity: "HIGH",
      action: "Require_Accessible_Label",
      description: "Controls without labels break keyboard/screen reader usage.",
    },
  },
  {
    rule_name: "Avoid plaintext PII fields in logs",
    industry_id: "finance",
    domain_id: "regulatory",
    compliance_tags: ["GDPR"],
    is_mandatory: true,
    rule_logic: {
      id: "GDPR-001",
      pattern: "console\\.(log|info|warn|error)\\([^)]*(email|phone|ssn|dob|address|passport)[^)]*\\)",
      severity: "HIGH",
      action: "Block_PII_Logging",
      description: "PII logging can violate minimization and confidentiality controls.",
    },
  },
  {
    rule_name: "Critical external calls should include timeout hints",
    industry_id: "finance",
    domain_id: "regulatory",
    compliance_tags: ["DORA"],
    is_mandatory: false,
    rule_logic: {
      id: "DORA-001",
      pattern: "network_call_without_timeout",
      severity: "MEDIUM",
      action: "Require_Timeout_Boundary",
      description: "Resilience controls benefit from explicit timeout boundaries.",
    },
  },
  {
    rule_name: "Potential PHI in analytics or tracking calls",
    industry_id: "healthcare",
    domain_id: "regulatory",
    compliance_tags: ["HIPAA"],
    is_mandatory: true,
    rule_logic: {
      id: "HIPAA-001",
      pattern: "(analytics|segment|mixpanel|amplitude|track)\\([^)]*(diagnosis|patient|medical|mrn|phi)[^)]*\\)",
      severity: "BLOCKER",
      action: "Block_PHI_Exfiltration",
      description: "Sending PHI to non-authorized processors can violate HIPAA safeguards.",
    },
  },
];

async function seed() {
  let inserted = 0;
  for (const rule of seedRules) {
    const result = await prisma.$executeRawUnsafe(
      `
      INSERT INTO rules_library
      (tenant_id, industry_id, compliance_tags, domain_id, rule_name, rule_logic, is_mandatory)
      SELECT
        $1::uuid,
        $2::varchar(50),
        $3::text[],
        $4::varchar(50),
        $5::text,
        $6::jsonb,
        $7::boolean
      WHERE NOT EXISTS (
        SELECT 1
        FROM rules_library
        WHERE rule_name = $5::text
          AND COALESCE(industry_id, '') = COALESCE($2::varchar(50), '')
          AND COALESCE(domain_id, '') = COALESCE($4::varchar(50), '')
      );
      `,
      null,
      rule.industry_id,
      rule.compliance_tags,
      rule.domain_id,
      rule.rule_name,
      JSON.stringify(rule.rule_logic),
      rule.is_mandatory,
    );
    inserted += Number(result || 0);
  }
  console.log(`rules_library seed complete. Inserted ${inserted} row(s).`);

  try {
    const totals =
      await prisma.$queryRaw`SELECT COUNT(*)::int AS c FROM rules_library`;
    const total = Array.isArray(totals) && totals[0] ? Number(totals[0].c) : 0;
    const byStatus = await prisma.$queryRaw`
      SELECT COALESCE(NULLIF(trim(status::text), ''), '(empty)') AS status, COUNT(*)::int AS c
      FROM rules_library
      GROUP BY COALESCE(NULLIF(trim(status::text), ''), '(empty)')
      ORDER BY status
    `;
    const activeForMcp =
      await prisma.$queryRaw`SELECT COUNT(*)::int AS c FROM rules_library WHERE COALESCE(NULLIF(trim(status::text), ''), 'active') IN ('active', 'shadow')`;
    const mcpCount = Array.isArray(activeForMcp) && activeForMcp[0] ? Number(activeForMcp[0].c) : 0;
    console.log(`rules_library total rows: ${total}`);
    console.log(`rules_library by status: ${JSON.stringify(byStatus)}`);
    console.log(`rows loaded by MCP (active+shadow): ${mcpCount}`);
    if (total < seedRules.length) {
      console.log(
        `Note: fewer than ${seedRules.length} rows in table. If you expected a full catalog, delete stray rows or run against the same DATABASE_URL as Neon, then re-seed.`,
      );
    }
  } catch (e) {
    console.log(`(Could not read rules_library summary: ${String(e)})`);
  }
}

await seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
