import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP tool list for agent.gate (kept separate from dispatch logic for readability).
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
            "Optional file path for HTML output. Defaults to reports/agent-gate-certificate-<profile>.html",
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
        tenantId: {
          type: "string",
          description: "Optional tenant UUID for tenant-specific rules in rules_library.",
        },
        industryId: {
          type: "string",
          description: "Optional industry override (e.g. Finance, Healthcare) for rules_library filters.",
        },
        complianceTags: {
          type: "array",
          items: { type: "string" },
          description: "Optional opt-in compliance tags (SOX, SOC2, GDPR, etc).",
        },
        domainId: {
          type: "string",
          description: "Optional domain filter (Security, Frontend, Database, etc).",
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
      properties: {
        profileId: { type: "string" },
        tenantId: { type: "string" },
        industryId: { type: "string" },
        complianceTags: { type: "array", items: { type: "string" } },
        domainId: { type: "string" },
      },
    },
  },
  {
    name: "refresh_rules_library",
    description:
      "Admin: force-refresh the in-memory rules cache from Neon/Postgres rules_library. Falls back to embedded rules if DB is unavailable.",
    inputSchema: {
      type: "object",
      properties: {
        force: {
          type: "boolean",
          description:
            "When true (default), bypass refresh interval and reload rules immediately from DB.",
        },
      },
    },
  },
  {
    name: "get_rules_library_status",
    description:
      "Admin: inspect current rules source/cache health (database vs embedded, last refresh, cache age, errors).",
    inputSchema: { type: "object", properties: {} },
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
      "Phase 2 GRC: report agent thought process and proposed code. Evaluates policy (OPA REST if OPA_URL set, else agent.gate bridge), then persists a tamper-evident decision log (SHA-256 chain + RSA-SHA256 signature) when DATABASE_URL is set — requires AMBIT_SIGNING_KEY. The tool waits for the write to finish (required on serverless). Without DATABASE_URL, writes JSON fallback (.ambit/grc-fallback locally, /tmp/agent-gate-grc-fallback on Vercel). Each call also writes an HTML scan certificate and traceability logs when AuditStore is available; set metadata.project_id to also write a Bill of Intent markdown file from Postgres.",
    inputSchema: {
      type: "object",
      properties: {
        trace_id: { type: "string", description: "Optional UUID to correlate a session." },
        actor_id: { type: "string", description: "Developer or agent identifier." },
        intent_prompt: { type: "string", description: "Original natural language request." },
        proposed_code: { type: "string", description: "Generated or proposed source code." },
        profile_id: {
          type: "string",
          description: "Policy profile for agent.gate bridge when OPA is not used.",
        },
        metadata: {
          type: "object",
          description:
            "model_version, temperature, git_branch, project_id, maturity labels (AODA, security), etc.",
        },
        tenant_id: { type: "string", description: "Optional tenant UUID for rules_library filtering." },
        industry_id: { type: "string", description: "Optional industry for rules_library filtering." },
        compliance_tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional opt-in compliance tags for rules_library filtering.",
        },
        domain_id: { type: "string", description: "Optional domain filter for rules_library." },
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
  {
    name: "query_governance_standards",
    description:
      "Semantic search over ingested governance standards in Pinecone (384-d MiniLM-compatible vectors). Embeddings use the Hugging Face Inference API (HUGGINGFACE_API_TOKEN) so the serverless bundle stays small. Returns top-3 text+source snippets. Requires PINECONE_API_KEY; optional PINECONE_INDEX_NAME (default agent-gate-standards), HF_EMBEDDING_MODEL_ID (default sentence-transformers/all-MiniLM-L6-v2). Logs to traceability when AuditStore is enabled.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language question or topic to match against stored standards.",
        },
        category: {
          type: "string",
          description: "Optional Pinecone metadata filter: exact match on the category field.",
        },
        logAuditTrail: {
          type: "boolean",
          description:
            "When true (default when AuditStore is enabled), persist a traceability record including query, filter, and match summaries.",
        },
        agentReasoning: {
          type: "string",
          description: "Optional agent reasoning line for the audit trail (defaults to a short search summary).",
        },
        metadata: {
          type: "object",
          description: "Optional metadata for traceability (model_version, git_branch, project_id, etc.).",
        },
      },
      required: ["query"],
    },
  },
];
