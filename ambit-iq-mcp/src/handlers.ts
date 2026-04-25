import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { AuditStore } from "../lib/auditTrail.js";
import {
  getRulesLibraryStatus,
  listProfiles,
  listRulesForProfile,
  refreshRulesLibrary,
  runPolicyAudit,
} from "../lib/policyFramework.js";
import { AMBIT_MCP_TOOLS } from "./ambitToolDefinitions.js";
import { evaluatePolicy } from "./services/opa.client.js";
import {
  assertTamperPersistenceConfigured,
  appendDecisionMetadataByTraceId,
  generateAuditReportMarkdown,
  getComplianceHistory,
  persistVibeDecision,
  verifyAuditIntegrity,
  writeComplianceActivities,
} from "./services/audit.service.js";
import { queryGovernanceStandards } from "./services/governance-standards.service.js";
import { uploadSessionArtifactsToBlob } from "./services/blob-artifacts.service.js";
import { emitMcpSessionArtifacts, formatArtifactSuffix, reportsDirectory } from "./session-artifacts.js";

function formatAuditText(result: ReturnType<typeof runPolicyAudit>): string {
  const vf = Array.isArray(result.virtualFindings) ? result.virtualFindings : [];
  const vfCount = typeof result.totals?.virtualFindingsCount === "number" ? result.totals.virtualFindingsCount : vf.length;
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
  if (vfCount > 0) {
    lines.push("");
    lines.push(`Virtual violations (shadow rules, not blocking): ${vfCount}`);
    for (const f of vf) {
      lines.push(`- [SHADOW] [${String(f.severity || "").toUpperCase()}] ${f.ruleId} ${f.title}`);
      lines.push(`  Why: ${f.rationale}`);
    }
  }
  return lines.join("\n");
}

export interface AmbitHandlerDeps {
  auditStore?: AuditStore | null;
}

function ruleContextFromArgs(a: Record<string, unknown>) {
  const complianceTagsRaw =
    a.complianceTags ?? a.compliance_tags ?? (a.metadata as Record<string, unknown> | undefined)?.compliance_tags;
  const complianceTags = Array.isArray(complianceTagsRaw)
    ? complianceTagsRaw.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const tenantId = String(
    a.tenantId ?? a.tenant_id ?? (a.metadata as Record<string, unknown> | undefined)?.tenant_id ?? "",
  ).trim();
  const industryId = String(
    a.industryId ??
      a.industry_id ??
      (a.metadata as Record<string, unknown> | undefined)?.industry_id ??
      "",
  ).trim();
  const domainId = String(
    a.domainId ?? a.domain_id ?? (a.metadata as Record<string, unknown> | undefined)?.domain_id ?? "",
  ).trim();
  return {
    tenantId: tenantId || undefined,
    industryId: industryId || undefined,
    domainId: domainId || undefined,
    complianceTags,
  };
}

function metadataProjectId(metadata: Record<string, unknown>): string | null {
  const raw = metadata.project_id ?? metadata.projectId;
  const normalized = raw != null ? String(raw).trim() : "";
  return normalized || null;
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
        appName: "agent.gate MCP",
        targetEnvironment: "mcp",
        userPrompt: "list_vibe_profiles",
        agentReasoning: "Enumerated available policy profiles for the client.",
        metadata: {
          model_version: "agent.gate-policy-engine-1.0.0",
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
      const ruleContext = ruleContextFromArgs(a);
      await refreshRulesLibrary();
      const auditResult = runPolicyAudit(
        `/* mcp: list_vibe_rules profile=${profileId} */\n`,
        profileId,
        ruleContext,
      );
      const art = await emitMcpSessionArtifacts({
        auditStore,
        toolName: "list_vibe_rules",
        auditResult,
        appName: "agent.gate MCP",
        targetEnvironment: "mcp",
        userPrompt: `list_vibe_rules(${profileId})`,
        agentReasoning: "Enumerated active rules for the requested profile.",
        metadata: {
          model_version: "agent.gate-policy-engine-1.0.0",
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
              JSON.stringify({ profileId, rules: listRulesForProfile(profileId, ruleContext) }, null, 2) +
              formatArtifactSuffix(art),
          },
        ],
      };
    }

    if (name === "refresh_rules_library") {
      const force = a.force !== false;
      const refresh = await refreshRulesLibrary({ force });
      const status = getRulesLibraryStatus();
      const auditResult = runPolicyAudit("/* mcp: refresh_rules_library */\n", "baseline.global");
      const art = await emitMcpSessionArtifacts({
        auditStore,
        toolName: "refresh_rules_library",
        auditResult,
        appName: "agent.gate MCP",
        targetEnvironment: "mcp",
        userPrompt: `refresh_rules_library(force=${String(force)})`,
        agentReasoning: "Refreshed rules cache from shared rules_library table and returned cache status.",
        metadata: {
          model_version: "agent.gate-policy-engine-1.0.0",
          git_branch: process.env.GIT_BRANCH || "unknown",
          rules_source: status.source,
        },
        includeCertificate: true,
        includeTraceability: Boolean(auditStore),
        projectIdForBoI: null,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ refresh, status }, null, 2) + formatArtifactSuffix(art),
          },
        ],
      };
    }

    if (name === "get_rules_library_status") {
      const status = getRulesLibraryStatus();
      const auditResult = runPolicyAudit("/* mcp: get_rules_library_status */\n", "baseline.global");
      const art = await emitMcpSessionArtifacts({
        auditStore,
        toolName: "get_rules_library_status",
        auditResult,
        appName: "agent.gate MCP",
        targetEnvironment: "mcp",
        userPrompt: "get_rules_library_status",
        agentReasoning: "Reported shared rules cache source and health indicators.",
        metadata: {
          model_version: "agent.gate-policy-engine-1.0.0",
          git_branch: process.env.GIT_BRANCH || "unknown",
          rules_source: status.source,
        },
        includeCertificate: true,
        includeTraceability: Boolean(auditStore),
        projectIdForBoI: null,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(status, null, 2) + formatArtifactSuffix(art) }],
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
      const traceId =
        String(a.trace_id ?? metadataIn.trace_id ?? metadataIn.traceId ?? "").trim() || randomUUID();
      const ruleContext = ruleContextFromArgs(a);
      await refreshRulesLibrary();
      const result = runPolicyAudit(code, profileId, ruleContext);
      const projectIdRaw = metadataProjectId(metadataIn);
      const userId =
        String(
          metadataIn.user_id ??
            metadataIn.actor_id ??
            metadataIn.userId ??
            (a.userId as string | undefined) ??
            "mcp-user",
        ).trim() || "mcp-user";
      const repoName =
        String(metadataIn.repo_name ?? metadataIn.repoName ?? appName ?? "unknown-repo").trim() ||
        "unknown-repo";
      const tenantId = String(
        metadataIn.tenant_id ?? metadataIn.tenantId ?? ruleContext.tenantId ?? "global",
      ).trim();
      const industryId = String(ruleContext.industryId || result.profile.industry || "Cross-Industry").trim();
      const projectId = projectIdRaw ? String(projectIdRaw) : null;
      const activityWrite = await writeComplianceActivities(
        result.findings.map((f) => ({
          userId,
          repoName,
          tenantId,
          industryId,
          severity: String(f.severity || "WARNING").toUpperCase(),
          ruleName: f.title,
          ruleId: f.ruleId,
          message: `${f.title}: ${f.rationale}`,
          projectId,
        })),
      );
      const decisionPersist = await persistVibeDecision({
        traceId,
        actorId: userId,
        intentPrompt: (a.userPrompt as string) || "audit_vibe invocation",
        proposedCode: code,
        decision: result.gate !== "blocked",
        violations: result.findings,
        rawOpaPayload: {
          source: "audit_vibe",
          profile_id: result.profile.id,
          gate: result.gate,
          totals: result.totals,
        },
        metadata: {
          ...metadataIn,
          project_id: projectIdRaw,
          profile_id: result.profile.id,
          mcp_tool: "audit_vibe",
        },
      });
      const summaryStyle =
        a.auditSummaryStyle === "brief" || a.auditSummaryStyle === "detailed"
          ? a.auditSummaryStyle
          : "detailed";

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
          model_version: metadataIn.model_version || "agent.gate-policy-engine-1.0.0",
          timestamp: metadataIn.timestamp || new Date().toISOString(),
          git_branch: metadataIn.git_branch || process.env.GIT_BRANCH || "unknown",
          profile_id: result.profile.id,
          compliance_activity_inserted: activityWrite.inserted,
          compliance_activity_error: activityWrite.error ?? null,
          decision_persistence: decisionPersist.status,
          virtual_findings_count: result.totals?.virtualFindingsCount ?? 0,
        },
        includeCertificate: generateHtmlCertificate,
        includeTraceability: shouldLogAuditTrail,
        traceabilitySummaryStyle: summaryStyle,
        certificateOutputPath: a.certificateOutputPath
          ? path.resolve(String(a.certificateOutputPath))
          : undefined,
        projectIdForBoI: projectIdRaw,
      });
      const blobUpload = await uploadSessionArtifactsToBlob({
        artifacts,
        toolName: "audit_vibe",
        traceId,
      });
      let blobPatchNote = "";
      if (decisionPersist.status === "inserted_postgres" && blobUpload.uploaded) {
        const patchResult = await appendDecisionMetadataByTraceId({
          traceId,
          metadataPatch: {
            artifact_refs: blobUpload.uploaded,
          },
        });
        if (!patchResult.ok) {
          blobPatchNote = `\n- Note: Blob refs metadata patch failed: ${patchResult.error}`;
        }
      }
      const blobWarnings = blobUpload.warnings.length
        ? `\n- ${blobUpload.warnings.join("\n- ")}`
        : "";
      const blobLines = blobUpload.uploaded
        ? `\n- Blob artifact refs stored: ${JSON.stringify(blobUpload.uploaded)}`
        : "";

      const text = formatAuditText(result);
      return {
        content: [
          {
            type: "text",
            text: text + formatArtifactSuffix(artifacts) + blobLines + blobWarnings + blobPatchNote,
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
        appName: "agent.gate MCP",
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
      await refreshRulesLibrary();
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
        (code, profileId) => runPolicyAudit(code, profileId, ruleContextFromArgs(a)),
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
      const traceId = String(a.trace_id ?? meta.trace_id ?? meta.traceId ?? "").trim() || randomUUID();
      const persist = await persistVibeDecision({
        traceId,
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
      const activityRows = (evalResult.violations || []).map((v) => ({
        userId: actorId,
        repoName: String(meta.repo_name ?? meta.repoName ?? "unknown-repo"),
        tenantId: String(meta.tenant_id ?? meta.tenantId ?? ruleContextFromArgs(a).tenantId ?? "global"),
        industryId: String(
          meta.industry_id ?? meta.industryId ?? ruleContextFromArgs(a).industryId ?? "Cross-Industry",
        ),
        severity: String(v.severity || "WARNING").toUpperCase(),
        ruleName: String(v.rule || "Policy violation"),
        ruleId: String(v.rule || ""),
        message: String(v.message || "Policy violation detected"),
        traceId,
        projectId: String(meta.project_id || ""),
      }));
      const activityWrite = await writeComplianceActivities(activityRows);

      const profileId = (a.profile_id as string) || "baseline.global";
      await refreshRulesLibrary();
      const auditForArtifacts = runPolicyAudit(proposedCode, profileId, ruleContextFromArgs(a));
      const projectIdRaw = metadataProjectId(meta);
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
          model_version: meta.model_version || "agent.gate-policy-engine-1.0.0",
          git_branch: meta.git_branch || process.env.GIT_BRANCH || "unknown",
          profile_id: profileId,
          actor_id: actorId,
          compliance_activity_inserted: activityWrite.inserted,
          compliance_activity_error: activityWrite.error ?? null,
        },
        includeCertificate: true,
        includeTraceability: Boolean(auditStore),
        projectIdForBoI: projectIdRaw,
      });
      const blobUpload = await uploadSessionArtifactsToBlob({
        artifacts,
        toolName: "log_vibe_transaction",
        traceId,
      });
      let blobPatchNote = "";
      if (persist.status === "inserted_postgres" && blobUpload.uploaded) {
        const patchResult = await appendDecisionMetadataByTraceId({
          traceId,
          metadataPatch: {
            artifact_refs: blobUpload.uploaded,
          },
        });
        if (!patchResult.ok) {
          blobPatchNote = `\nBlob refs metadata patch failed: ${patchResult.error}`;
        }
      }
      const blobWarnings = blobUpload.warnings.length
        ? `\n${blobUpload.warnings.join("\n")}`
        : "";
      const blobInfo = blobUpload.uploaded
        ? `\nBlob artifact refs: ${JSON.stringify(blobUpload.uploaded)}`
        : "";

      return {
        content: [
          {
            type: "text",
            text:
              JSON.stringify({ ...summary, trace_id: traceId }, null, 2) +
              "\n\n" +
              note +
              formatArtifactSuffix(artifacts) +
              blobInfo +
              blobWarnings +
              blobPatchNote,
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
        appName: "agent.gate MCP",
        targetEnvironment: "mcp",
        userPrompt: "get_compliance_history",
        agentReasoning: "Queried recent DENY decision logs from PostgreSQL (if configured).",
        metadata: {
          model_version: "agent.gate-policy-engine-1.0.0",
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
      const projectId = String(a.project_id ?? a.projectId ?? "").trim();
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
      const boiPath = path.join(reportsDirectory(), `agent-gate-boi-${slug}-${stamp}.md`);
      const stableReportPath = path.join(reportsDirectory(), "report.md");
      let boiWritten: string | null = null;
      let stableWritten: string | null = null;
      try {
        await mkdir(path.dirname(boiPath), { recursive: true });
        await writeFile(boiPath, rep.markdown, "utf8");
        await writeFile(stableReportPath, rep.markdown, "utf8");
        boiWritten = boiPath;
        stableWritten = stableReportPath;
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
          model_version: "agent.gate-policy-engine-1.0.0",
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
        reportMarkdownPath: stableWritten ?? art.reportMarkdownPath,
        warnings:
          boiWritten && stableWritten
            ? art.warnings
            : [...art.warnings, "Could not write markdown report.md and/or BoI file to disk"],
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
        appName: "agent.gate MCP",
        targetEnvironment: "mcp",
        userPrompt: "verify_audit_integrity",
        agentReasoning: "Verified tamper-evident hash chain and optional RSA signatures over recent rows.",
        metadata: {
          model_version: "agent.gate-policy-engine-1.0.0",
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

    if (name === "query_governance_standards") {
      const q = String(a.query || "").trim();
      if (!q) {
        return {
          content: [{ type: "text", text: "query is required and must be non-empty." }],
          isError: true,
        };
      }
      const category =
        a.category != null && String(a.category).trim() ? String(a.category).trim() : undefined;
      const shouldLogAuditTrail = Boolean(auditStore) && a.logAuditTrail !== false;
      const metadataIn =
        a.metadata && typeof a.metadata === "object" ? (a.metadata as Record<string, unknown>) : {};

      let result: Awaited<ReturnType<typeof queryGovernanceStandards>>;
      try {
        result = await queryGovernanceStandards({ query: q, category });
      } catch (e) {
        return {
          content: [{ type: "text", text: `query_governance_standards failed: ${String(e)}` }],
          isError: true,
        };
      }

      const auditStub = runPolicyAudit(
        `/* mcp: query_governance_standards */\n${q.slice(0, 4000)}\n`,
        "baseline.global",
      );
      const matchSummaries = result.matches.map((m) => ({
        score: m.score,
        source: m.source,
        text_preview: m.text.slice(0, 500),
      }));
      const reasoning =
        (a.agentReasoning as string)?.trim() ||
        `Pinecone semantic search on index "${result.indexName}" returned ${result.matches.length} match(es)` +
          (category ? ` (metadata filter category=$eq:${category})` : "");

      const projectIdRaw = metadataProjectId(metadataIn);

      const art = await emitMcpSessionArtifacts({
        auditStore,
        toolName: "query_governance_standards",
        auditResult: auditStub,
        appName: "agent.gate MCP",
        targetEnvironment: "mcp",
        userPrompt: q,
        agentReasoning: reasoning,
        metadata: {
          ...metadataIn,
          model_version:
            metadataIn.model_version ||
            process.env.HF_EMBEDDING_MODEL_ID ||
            "sentence-transformers/all-MiniLM-L6-v2",
          timestamp: metadataIn.timestamp || new Date().toISOString(),
          git_branch: metadataIn.git_branch || process.env.GIT_BRANCH || "unknown",
          pinecone_index: result.indexName,
          governance_category_filter: category ?? null,
        },
        includeCertificate: true,
        includeTraceability: shouldLogAuditTrail,
        traceabilitySummaryStyle: "detailed",
        projectIdForBoI: projectIdRaw,
        ambitResultsAugment: {
          governance_standards: {
            query: q,
            category: category ?? null,
            index: result.indexName,
            top_k: 3,
            matches: matchSummaries,
          },
        },
      });

      return {
        content: [{ type: "text", text: result.formatted + formatArtifactSuffix(art) }],
        isError: false,
      };
    }

    throw new Error(`Tool not found: ${name}`);
  });
}
