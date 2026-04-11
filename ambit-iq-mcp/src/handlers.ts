import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { listProfiles, listRulesForProfile, runPolicyAudit } from "#pf";
import type { AuditStore } from "#audit";
import { AMBIT_MCP_TOOLS } from "./ambitToolDefinitions.js";
import { evaluatePolicy } from "./services/opa.client.js";
import {
  assertTamperPersistenceConfigured,
  generateAuditReportMarkdown,
  getComplianceHistory,
  persistVibeDecision,
  verifyAuditIntegrity,
} from "./services/audit.service.js";
import { emitMcpSessionArtifacts, formatArtifactSuffix, reportsDirectory } from "./session-artifacts.js";

function formatAuditText(result: ReturnType<typeof runPolicyAudit>): string {
  const lines: string[] = [
    `Profile: ${result.profile.id} (${result.profile.industry}, ${result.profile.geo})`,
    `Gate: ${result.gate.toUpperCase()} | Findings: ${result.totals.findings}/${result.totals.activeRules} | Blocking: ${result.totals.blockingFindings}`,
  ];
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

export interface AmbitHandlerDeps {
  auditStore?: AuditStore | null;
}

export function registerAmbitIqHandlers(server: Server, deps: AmbitHandlerDeps = {}): void {
  const { auditStore = null } = deps;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: AMBIT_MCP_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args || {}) as Record<string, unknown>;

    if (name === "list_vibe_profiles") {
      const auditResult = runPolicyAudit("/* mcp: list_vibe_profiles */\n", "baseline.global");
      const art = await emitMcpSessionArtifacts({
        auditStore,
        toolName: "list_vibe_profiles",
        auditResult,
        appName: "Ambit.IQ MCP",
        targetEnvironment: "mcp",
        userPrompt: "list_vibe_profiles",
        agentReasoning: "Enumerated available policy profiles for the client.",
        metadata: {
          model_version: "ambit-iq-policy-engine-1.0.0",
          git_branch: process.env.GIT_BRANCH || "unknown",
        },
        includeCertificate: true,
        includeTraceability: Boolean(auditStore),
        projectIdForBoI: null,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ profiles: listProfiles() }, null, 2) + formatArtifactSuffix(art),
          },
        ],
      };
    }

    if (name === "list_vibe_rules") {
      const profileId = (a.profileId as string) || "baseline.global";
      const auditResult = runPolicyAudit(
        `/* mcp: list_vibe_rules profile=${profileId} */\n`,
        profileId,
      );
      const art = await emitMcpSessionArtifacts({
        auditStore,
        toolName: "list_vibe_rules",
        auditResult,
        appName: "Ambit.IQ MCP",
        targetEnvironment: "mcp",
        userPrompt: `list_vibe_rules(${profileId})`,
        agentReasoning: "Enumerated active rules for the requested profile.",
        metadata: {
          model_version: "ambit-iq-policy-engine-1.0.0",
          git_branch: process.env.GIT_BRANCH || "unknown",
          profile_id: profileId,
        },
        includeCertificate: true,
        includeTraceability: Boolean(auditStore),
        projectIdForBoI: null,
      });
      return {
        content: [
          {
            type: "text",
            text:
              JSON.stringify({ profileId, rules: listRulesForProfile(profileId) }, null, 2) +
              formatArtifactSuffix(art),
          },
        ],
      };
    }

    if (name === "audit_vibe") {
      const code = String(a.code || "");
      const profileId = (a.profileId as string) || "baseline.global";
      const appName = (a.appName as string) || "Unnamed Application";
      const targetEnvironment = (a.targetEnvironment as string) || "unspecified";
      const generateHtmlCertificate = a.generateHtmlCertificate !== false;
      const shouldLogAuditTrail = Boolean(auditStore) && a.logAuditTrail !== false;
      const metadataIn =
        a.metadata && typeof a.metadata === "object" ? (a.metadata as Record<string, unknown>) : {};
      const result = runPolicyAudit(code, profileId);
      const summaryStyle =
        a.auditSummaryStyle === "brief" || a.auditSummaryStyle === "detailed"
          ? a.auditSummaryStyle
          : "detailed";
      const projectIdRaw =
        metadataIn.project_id != null && String(metadataIn.project_id).trim()
          ? String(metadataIn.project_id).trim()
          : null;

      const artifacts = await emitMcpSessionArtifacts({
        auditStore,
        toolName: "audit_vibe",
        auditResult: result,
        appName,
        targetEnvironment,
        userPrompt: (a.userPrompt as string) || "audit_vibe invocation",
        agentReasoning:
          (a.agentReasoning as string) || "Rule-based profile evaluation executed.",
        metadata: {
          ...metadataIn,
          model_version: metadataIn.model_version || "ambit-iq-policy-engine-1.0.0",
          timestamp: metadataIn.timestamp || new Date().toISOString(),
          git_branch: metadataIn.git_branch || process.env.GIT_BRANCH || "unknown",
          profile_id: result.profile.id,
        },
        includeCertificate: generateHtmlCertificate,
        includeTraceability: shouldLogAuditTrail,
        traceabilitySummaryStyle: summaryStyle,
        certificateOutputPath: a.certificateOutputPath
          ? path.resolve(String(a.certificateOutputPath))
          : undefined,
        projectIdForBoI: projectIdRaw,
      });

      const text = formatAuditText(result);
      return {
        content: [{ type: "text", text: text + formatArtifactSuffix(artifacts) }],
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
      const metadataIn =
        a.metadata && typeof a.metadata === "object" ? (a.metadata as Record<string, unknown>) : {};
      const metadata = {
        model_version: metadataIn.model_version || "unknown",
        timestamp: metadataIn.timestamp || new Date().toISOString(),
        git_branch: metadataIn.git_branch || process.env.GIT_BRANCH || "unknown",
      };
      const payload = {
        user_prompt: String(a.user_prompt || ""),
        agent_reasoning: String(a.agent_reasoning || ""),
        ambit_results: a.ambit_results || {},
        metadata,
        summary_style:
          a.summary_style === "brief" || a.summary_style === "detailed" ? a.summary_style : "detailed",
      };
      const written = await auditStore.writeAuditLog(payload);
      const stubAudit = runPolicyAudit("/* mcp: log_audit_trail */\n", "baseline.global");
      const pid =
        metadataIn.project_id != null && String(metadataIn.project_id).trim()
          ? String(metadataIn.project_id).trim()
          : null;
      const art = await emitMcpSessionArtifacts({
        auditStore,
        toolName: "log_audit_trail",
        auditResult: stubAudit,
        appName: "Ambit.IQ MCP",
        targetEnvironment: "mcp",
        userPrompt: payload.user_prompt,
        agentReasoning: payload.agent_reasoning,
        metadata: {
          ...metadata,
          mcp_note: "Certificate/BoI emitted after structured audit trail write.",
        },
        includeCertificate: true,
        includeTraceability: false,
        traceabilitySummaryStyle:
          payload.summary_style === "brief" || payload.summary_style === "detailed"
            ? payload.summary_style
            : "detailed",
        projectIdForBoI: pid,
      });
      return {
        content: [
          {
            type: "text",
            text:
              `Audit trail recorded: ${written.filePath}\n` +
              `Audit summary markdown: ${written.markdownFilePath}\n` +
              `Forwarder: ${JSON.stringify(written.forwardResult)}\n\n` +
              written.markdownSummary +
              formatArtifactSuffix(art),
          },
        ],
      };
    }

    if (name === "log_vibe_transaction") {
      const actorId = String(a.actor_id || "").trim();
      const intentPrompt = String(a.intent_prompt || "");
      const proposedCode = String(a.proposed_code || "");
      if (!actorId) {
        return {
          content: [{ type: "text", text: "actor_id is required." }],
          isError: true,
        };
      }

      const evalResult = await evaluatePolicy(
        {
          code: proposedCode,
          intent_prompt: intentPrompt,
          profile_id: (a.profile_id as string) || undefined,
        },
        runPolicyAudit,
      );

      const tamperErr = assertTamperPersistenceConfigured();
      if (tamperErr) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  persistence_error: tamperErr,
                  evaluation: {
                    decision: evalResult.allow ? "ALLOW" : "DENY",
                    violations: evalResult.violations,
                    source: evalResult.source,
                  },
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const meta: Record<string, unknown> =
        a.metadata && typeof a.metadata === "object"
          ? { ...(a.metadata as Record<string, unknown>) }
          : {};
      const persist = await persistVibeDecision({
        traceId: a.trace_id as string | undefined,
        actorId,
        intentPrompt,
        proposedCode,
        decision: evalResult.allow,
        violations: evalResult.violations,
        rawOpaPayload: evalResult.raw,
        metadata: {
          ...meta,
          opa_source: evalResult.source,
          evaluated_at: new Date().toISOString(),
        },
      });

      const summary = {
        decision: evalResult.allow ? "ALLOW" : "DENY",
        violations: evalResult.violations,
        source: evalResult.source,
        persistence: persist.status,
        ...(persist.status === "wrote_fallback"
          ? {
              fallback_reason: persist.reason,
              fallback_path: persist.path,
              ...(persist.reason === "db_integrity_persist_failed"
                ? { persist_error: persist.error }
                : {}),
            }
          : {}),
      };

      const note =
        persist.status === "inserted_postgres"
          ? "Decision log stored in PostgreSQL (tamper-evident chain)."
          : persist.status === "wrote_fallback" && process.env.VERCEL
            ? `Fallback JSON written under ${persist.path} on this serverless instance (/tmp). It is not durable across invocations — fix DATABASE_URL / schema / Neon connection if you expected Postgres.`
            : `Fallback JSON written to ${persist.path} (no Postgres row).`;

      const dbFailed =
        persist.status === "wrote_fallback" && persist.reason === "db_integrity_persist_failed";

      const profileId = (a.profile_id as string) || "baseline.global";
      const auditForArtifacts = runPolicyAudit(proposedCode, profileId);
      const projectIdRaw =
        meta.project_id != null && String(meta.project_id).trim()
          ? String(meta.project_id).trim()
          : null;
      const artifacts = await emitMcpSessionArtifacts({
        auditStore,
        toolName: "log_vibe_transaction",
        auditResult: auditForArtifacts,
        appName: projectIdRaw || actorId,
        targetEnvironment: "mcp",
        userPrompt: intentPrompt,
        agentReasoning: `Policy source: ${evalResult.source}; GRC decision: ${evalResult.allow ? "ALLOW" : "DENY"}; persistence: ${persist.status}`,
        metadata: {
          ...meta,
          model_version: meta.model_version || "ambit-iq-policy-engine-1.0.0",
          git_branch: meta.git_branch || process.env.GIT_BRANCH || "unknown",
          profile_id: profileId,
          actor_id: actorId,
        },
        includeCertificate: true,
        includeTraceability: Boolean(auditStore),
        projectIdForBoI: projectIdRaw,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(summary, null, 2) + "\n\n" + note + formatArtifactSuffix(artifacts),
          },
        ],
        isError: dbFailed,
      };
    }

    if (name === "get_compliance_history") {
      const res = await getComplianceHistory({
        actorId: a.actor_id as string | undefined,
        violationType: a.violation_type as string | undefined,
        limit: typeof a.limit === "number" ? a.limit : undefined,
      });
      const auditResult = runPolicyAudit("/* mcp: get_compliance_history */\n", "baseline.global");
      const art = await emitMcpSessionArtifacts({
        auditStore,
        toolName: "get_compliance_history",
        auditResult,
        appName: "Ambit.IQ MCP",
        targetEnvironment: "mcp",
        userPrompt: "get_compliance_history",
        agentReasoning: "Queried recent DENY decision logs from PostgreSQL (if configured).",
        metadata: {
          model_version: "ambit-iq-policy-engine-1.0.0",
          git_branch: process.env.GIT_BRANCH || "unknown",
        },
        includeCertificate: true,
        includeTraceability: Boolean(auditStore),
        projectIdForBoI: null,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) + formatArtifactSuffix(art) }],
        isError: false,
      };
    }

    if (name === "generate_audit_report") {
      const projectId = String(a.project_id || "").trim();
      const rep = await generateAuditReportMarkdown({
        projectId,
        hours: typeof a.hours === "number" ? a.hours : undefined,
      });
      if (!rep.ok) {
        return {
          content: [{ type: "text", text: rep.error || "Report failed." }],
          isError: true,
        };
      }
      const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
      const slug = projectId.replaceAll(/[^a-zA-Z0-9._-]/g, "-").toLowerCase().slice(0, 48);
      const boiPath = path.join(reportsDirectory(), `ambit-iq-boi-${slug}-${stamp}.md`);
      let boiWritten: string | null = null;
      try {
        await mkdir(path.dirname(boiPath), { recursive: true });
        await writeFile(boiPath, rep.markdown, "utf8");
        boiWritten = boiPath;
      } catch {
        /* suffix will note failure via separate artifact pass */
      }
      const auditResult = runPolicyAudit(
        `/* mcp: generate_audit_report project=${projectId} */\n`,
        "baseline.global",
      );
      const art = await emitMcpSessionArtifacts({
        auditStore,
        toolName: "generate_audit_report",
        auditResult,
        appName: projectId,
        targetEnvironment: "mcp",
        userPrompt: `generate_audit_report(${projectId})`,
        agentReasoning: "Generated Bill of Intent markdown from PostgreSQL decision logs.",
        metadata: {
          model_version: "ambit-iq-policy-engine-1.0.0",
          git_branch: process.env.GIT_BRANCH || "unknown",
          project_id: projectId,
        },
        includeCertificate: true,
        includeTraceability: Boolean(auditStore),
        projectIdForBoI: null,
      });
      const merged = {
        ...art,
        boiMarkdownPath: boiWritten ?? art.boiMarkdownPath,
        warnings: boiWritten ? art.warnings : [...art.warnings, "Could not write BoI markdown file to disk"],
      };
      return { content: [{ type: "text", text: rep.markdown + formatArtifactSuffix(merged) }] };
    }

    if (name === "verify_audit_integrity") {
      const limit = typeof a.limit === "number" ? a.limit : 100;
      const res = await verifyAuditIntegrity(limit);
      const auditResult = runPolicyAudit("/* mcp: verify_audit_integrity */\n", "baseline.global");
      const art = await emitMcpSessionArtifacts({
        auditStore,
        toolName: "verify_audit_integrity",
        auditResult,
        appName: "Ambit.IQ MCP",
        targetEnvironment: "mcp",
        userPrompt: "verify_audit_integrity",
        agentReasoning: "Verified tamper-evident hash chain and optional RSA signatures over recent rows.",
        metadata: {
          model_version: "ambit-iq-policy-engine-1.0.0",
          git_branch: process.env.GIT_BRANCH || "unknown",
        },
        includeCertificate: true,
        includeTraceability: Boolean(auditStore),
        projectIdForBoI: null,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) + formatArtifactSuffix(art) }],
        isError: res.status === "Tamper Alert",
      };
    }

    throw new Error(`Tool not found: ${name}`);
  });
}
