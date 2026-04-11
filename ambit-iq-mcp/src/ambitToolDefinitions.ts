import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP tool list for Ambit.IQ (kept separate from dispatch logic for readability).
 */
export const AMBIT_MCP_TOOLS: Tool[] = [
  {
    name: "audit_vibe",
    description:
      "Audit code for quality, UX, and regulatory controls using a selectable policy profile. Always generates an HTML deployment scan certificate unless generateHtmlCertificate is explicitly false.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Source code to audit." },
        profileId: {
          type: "string",
          description: "Policy profile. Examples: baseline.global, financial-services.eu, healthcare.us",
        },
        appName: {
          type: "string",
          description: "Application name for report/certificate metadata.",
        },
        targetEnvironment: {
          type: "string",
          description: "Target environment label, e.g. dev, staging, prod.",
        },
        generateHtmlCertificate: {
          type: "boolean",
          description: "Defaults to true. Set false to skip writing the HTML scan certificate.",
        },
        certificateOutputPath: {
          type: "string",
          description:
            "Optional file path for HTML output. Defaults to reports/ambit-iq-certificate-<profile>.html",
        },
        logAuditTrail: {
          type: "boolean",
          description:
            "When true (default when the server has an AuditStore), persist a SOC2 traceability log record in .ambit/logs using current audit results. Set false to skip.",
        },
        userPrompt: { type: "string", description: "Original user intent (for traceability record)." },
        agentReasoning: {
          type: "string",
          description: "Agent reasoning summary captured for provenance logging.",
        },
        metadata: {
          type: "object",
          description: "Optional metadata override (model_version, timestamp, git_branch).",
        },
        auditSummaryStyle: {
          type: "string",
          description: "Optional markdown summary style for traceability logs: brief | detailed",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "list_vibe_profiles",
    description: "List available policy profiles and their default gate thresholds.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_vibe_rules",
    description: "List active rules for a specific policy profile.",
    inputSchema: {
      type: "object",
      properties: { profileId: { type: "string" } },
    },
  },
  {
    name: "log_audit_trail",
    description:
      "Persist structured provenance logs for AI-generated code changes and emit a Markdown PR summary.",
    inputSchema: {
      type: "object",
      properties: {
        user_prompt: { type: "string" },
        agent_reasoning: { type: "string" },
        ambit_results: { type: "object" },
        metadata: { type: "object" },
        summary_style: { type: "string" },
      },
      required: ["user_prompt", "agent_reasoning", "ambit_results", "metadata"],
    },
  },
  {
    name: "log_vibe_transaction",
    description:
      "Phase 2 GRC: report agent thought process and proposed code. Evaluates policy (OPA REST if OPA_URL set, else Ambit bridge), then persists a tamper-evident decision log (SHA-256 chain + RSA-SHA256 signature) when DATABASE_URL is set — requires AMBIT_SIGNING_KEY. The tool waits for the write to finish (required on serverless). Without DATABASE_URL, writes JSON fallback (.ambit/grc-fallback locally, /tmp/ambit-iq-grc-fallback on Vercel). Each call also writes an HTML scan certificate and traceability logs when AuditStore is available; set metadata.project_id to also write a Bill of Intent markdown file from Postgres.",
    inputSchema: {
      type: "object",
      properties: {
        trace_id: { type: "string", description: "Optional UUID to correlate a session." },
        actor_id: { type: "string", description: "Developer or agent identifier." },
        intent_prompt: { type: "string", description: "Original natural language request." },
        proposed_code: { type: "string", description: "Generated or proposed source code." },
        profile_id: {
          type: "string",
          description: "Policy profile for Ambit bridge when OPA is not used.",
        },
        metadata: {
          type: "object",
          description:
            "model_version, temperature, git_branch, project_id, maturity labels (AODA, security), etc.",
        },
      },
      required: ["actor_id", "intent_prompt", "proposed_code"],
    },
  },
  {
    name: "get_compliance_history",
    description:
      "Query the last decision logs that were DENY (decision=false), optionally filtered by actor_id and violation substring (e.g. rule id).",
    inputSchema: {
      type: "object",
      properties: {
        actor_id: { type: "string" },
        violation_type: { type: "string", description: "Matched against violations JSON text." },
        limit: { type: "number", description: "Max rows 1–50, default 10." },
      },
    },
  },
  {
    name: "generate_audit_report",
    description:
      "Markdown Software Bill of Intent for metadata.project_id over the last N hours (default 24).",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        hours: { type: "number", description: "1–168, default 24." },
      },
      required: ["project_id"],
    },
  },
  {
    name: "verify_audit_integrity",
    description:
      "Tamper detection: recompute SHA-256 chain hashes for the last N ambit_decision_logs rows, verify each previous_hash link, and verify RSA-SHA256 signatures when AMBIT_VERIFYING_KEY is set. Returns Clean or Tamper Alert with row ids.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Rows to scan (1–500), default 100." },
      },
    },
  },
];
