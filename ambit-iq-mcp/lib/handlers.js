import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  listProfiles,
  listRulesForProfile,
  runPolicyAudit,
  summarizeAmbitResults,
} from "./policyFramework.js";
import { buildAuditCertificateHtml } from "./certificateHtml.js";

function asText(result) {
  const lines = [];
  lines.push(
    `Profile: ${result.profile.id} (${result.profile.industry}, ${result.profile.geo})`,
  );
  lines.push(
    `Gate: ${result.gate.toUpperCase()} | Findings: ${result.totals.findings}/${result.totals.activeRules} | Blocking: ${result.totals.blockingFindings}`,
  );
  if (result.findings.length === 0) {
    lines.push("No policy findings. Code passes this profile.");
  } else {
    lines.push("");
    for (const f of result.findings) {
      lines.push(`- [${f.severity.toUpperCase()}] ${f.ruleId} ${f.title}`);
      lines.push(`  Why: ${f.rationale}`);
      lines.push(`  Fix: ${f.remediation}`);
    }
  }
  return lines.join("\n");
}

export function registerAmbitIqHandlers(server, deps = {}) {
  const { auditStore = null } = deps;
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
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
              description:
                "Policy profile. Examples: baseline.global, financial-services.eu, healthcare.us",
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
              description:
                "Defaults to true. Set false to skip writing the HTML scan certificate.",
            },
            certificateOutputPath: {
              type: "string",
              description:
                "Optional file path for HTML output. Defaults to reports/ambit-iq-certificate-<profile>.html",
            },
            logAuditTrail: {
              type: "boolean",
              description:
                "When true, persist a SOC2 traceability log record in .ambit/logs using current audit results.",
            },
            userPrompt: {
              type: "string",
              description: "Original user intent (for traceability record).",
            },
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
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "list_vibe_profiles") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ profiles: listProfiles() }, null, 2),
          },
        ],
      };
    }

    if (name === "list_vibe_rules") {
      const profileId = args?.profileId || "baseline.global";
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { profileId, rules: listRulesForProfile(profileId) },
              null,
              2,
            ),
          },
        ],
      };
    }

    if (name === "audit_vibe") {
      const code = args?.code || "";
      const profileId = args?.profileId || "baseline.global";
      const appName = args?.appName || "Unnamed Application";
      const targetEnvironment = args?.targetEnvironment || "unspecified";
      const generateHtmlCertificate = args?.generateHtmlCertificate !== false;
      const shouldLogAuditTrail = Boolean(args?.logAuditTrail);
      const result = runPolicyAudit(code, profileId);
      const ambitResults = summarizeAmbitResults(result);
      let htmlPath = null;
      let logPath = null;
      let logMarkdownPath = null;
      if (generateHtmlCertificate) {
        const html = buildAuditCertificateHtml({
          result,
          appName,
          targetEnvironment,
          scannerName: "Ambit.IQ",
        });
        const safeProfile = String(result.profile.id || "profile")
          .replaceAll(/[^a-zA-Z0-9._-]/g, "-")
          .toLowerCase();
        const fallbackPath = path.join(
          process.cwd(),
          "reports",
          `ambit-iq-certificate-${safeProfile}.html`,
        );
        const outPath = args?.certificateOutputPath
          ? path.resolve(String(args.certificateOutputPath))
          : fallbackPath;
        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, html, "utf8");
        htmlPath = outPath;
      }
      if (shouldLogAuditTrail && auditStore) {
        const metadataIn = args?.metadata && typeof args.metadata === "object" ? args.metadata : {};
        const metadata = {
          model_version: metadataIn.model_version || "ambit-iq-policy-engine-1.0.0",
          timestamp: metadataIn.timestamp || new Date().toISOString(),
          git_branch: metadataIn.git_branch || process.env.GIT_BRANCH || "unknown",
          profile_id: result.profile.id,
        };
        const written = await auditStore.writeAuditLog({
          user_prompt: args?.userPrompt || "audit_vibe invocation",
          agent_reasoning: args?.agentReasoning || "Rule-based profile evaluation executed.",
          ambit_results: ambitResults,
          metadata,
          summary_style:
            args?.auditSummaryStyle === "brief" || args?.auditSummaryStyle === "detailed"
              ? args.auditSummaryStyle
              : "detailed",
        });
        logPath = written.filePath;
        logMarkdownPath = written.markdownFilePath;
      }
      const text = asText(result);
      const suffix = [
        htmlPath ? `HTML certificate written to: ${htmlPath}` : null,
        logPath ? `Audit trail log written to: ${logPath}` : null,
        logMarkdownPath ? `Audit trail markdown summary written to: ${logMarkdownPath}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: suffix ? `${text}\n\n${suffix}` : text,
          },
        ],
        isError: result.gate === "blocked",
      };
    }

    if (name === "log_audit_trail") {
      if (!auditStore) {
        return {
          content: [
            {
              type: "text",
              text: "AuditStore not initialized on server. Cannot persist audit trail.",
            },
          ],
          isError: true,
        };
      }
      const metadataIn = args?.metadata && typeof args.metadata === "object" ? args.metadata : {};
      const metadata = {
        model_version: metadataIn.model_version || "unknown",
        timestamp: metadataIn.timestamp || new Date().toISOString(),
        git_branch: metadataIn.git_branch || process.env.GIT_BRANCH || "unknown",
      };
      const payload = {
        user_prompt: args?.user_prompt || "",
        agent_reasoning: args?.agent_reasoning || "",
        ambit_results: args?.ambit_results || {},
        metadata,
        summary_style:
          args?.summary_style === "brief" || args?.summary_style === "detailed"
            ? args.summary_style
            : "detailed",
      };
      const written = await auditStore.writeAuditLog(payload);
      return {
        content: [
          {
            type: "text",
            text:
              `Audit trail recorded: ${written.filePath}\n` +
              `Audit summary markdown: ${written.markdownFilePath}\n` +
              `Forwarder: ${JSON.stringify(written.forwardResult)}\n\n` +
              written.markdownSummary,
          },
        ],
      };
    }

    throw new Error(`Tool not found: ${name}`);
  });
}
