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
import { parseVimlDocument } from "./viml/viml.parser.js";
import { runVimlEnforceFastPath } from "./viml/viml.enforce.js";
import { auditResultFromVimlEnforce } from "./viml/viml-audit-merge.js";
import { vimlDocumentForLog } from "./viml/viml.snapshot.js";
import { handleDashboardTool } from "./handlers/dashboard.handlers.js";
import { handleModelGovernanceTool } from "./handlers/model-governance.handlers.js";
import { handleIncidentTool } from "./handlers/incident.handlers.js";
import { handleInteractionTool } from "./handlers/interaction.handlers.js";
import {
  assessModelRisk,
  normalizeModelMetadata,
  recordModelUsage,
} from "./services/model-governance.service.js";
import { captureAgentInteraction } from "./services/prompt-capture.service.js";

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

    const phase2Result =
      (await handleDashboardTool(name, args)) ??
      (await handleModelGovernanceTool(name, args)) ??
      (await handleIncidentTool(name, args)) ??
      (await handleInteractionTool(name, args));
    if (phase2Result !== null) return phase2Result;

    if (name === "list_vibe_profiles") {
      const auditResult = runPolicyAudit("/* mcp: list_vibe_profiles */\n", "baseline.global");
      const art = await emitMcpSessionArtifacts({
        auditStore,
        toolName: "list_vibe_profiles",
        auditResult,
        appName: "Project Vail MCP",
        targetEnvironment: "mcp",
        userPrompt: "list_vibe_profiles",
        agentReasoning: "Enumerated available policy profiles for the client.",
        metadata: {
          model_version: "project-vail-policy-engine-1.0.0",
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
        appName: "Project Vail MCP",
        targetEnvironment: "mcp",
        userPrompt: `list_vibe_rules(${profileId})`,
        agentReasoning: "Enumerated active rules for the requested profile.",
        metadata: {
          model_version: "project-vail-policy-engine-1.0.0",
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
        appName: "Project Vail MCP",
        targetEnvironment: "mcp",
        userPrompt: `refresh_rules_library(force=${String(force)})`,
        agentReasoning: "Refreshed rules cache from shared rules_library table and returned cache status.",
        metadata: {
          model_version: "project-vail-policy-engine-1.0.0",
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
        appName: "Project Vail MCP",
        targetEnvironment: "mcp",
        userPrompt: "get_rules_library_status",
        agentReasoning: "Reported shared rules cache source and health indicators.",
        metadata: {
          model_version: "project-vail-policy-engine-1.0.0",
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
      let profileId = (a.profileId as string) || "baseline.global";
      const appName = (a.appName as string) || "Unnamed Application";
      const targetEnvironment = (a.targetEnvironment as string) || "unspecified";
      const generateHtmlCertificate = a.generateHtmlCertificate !== false;
      const shouldLogAuditTrail = Boolean(auditStore) && a.logAuditTrail !== false;
      const metadataIn =
        a.metadata && typeof a.metadata === "object" ? (a.metadata as Record<string, unknown>) : {};
      const modelRaw =
        a.model && typeof a.model === "object" ? (a.model as Record<string, unknown>) : null;
      let modelGovernance:
        | {
            level: "LOW" | "MEDIUM" | "HIGH";
            rationale: string[];
          }
        | null = null;
      let modelWarnings: string[] = [];
      if (modelRaw) {
        try {
          const normalized = normalizeModelMetadata({
            provider: String(modelRaw.provider || modelRaw.model_provider || "unknown"),
            modelName: String(modelRaw.modelName || modelRaw.model_name || "unknown"),
            modelVersion: (modelRaw.modelVersion || modelRaw.model_version || undefined) as
              | string
              | undefined,
            hostingType: (modelRaw.hostingType || modelRaw.hosting_type || undefined) as
              | string
              | undefined,
            endpointRegion: (modelRaw.endpointRegion || modelRaw.endpoint_region || undefined) as
              | string
              | undefined,
            dataProcessingRegion: (modelRaw.dataProcessingRegion ||
              modelRaw.data_processing_region ||
              undefined) as string | undefined,
            userGeography: (modelRaw.userGeography || modelRaw.user_geography || undefined) as
              | string
              | undefined,
            jurisdiction: (modelRaw.jurisdiction || undefined) as string | undefined,
            promptRetentionPolicy: (modelRaw.promptRetentionPolicy ||
              modelRaw.prompt_retention_policy ||
              undefined) as string | undefined,
            responseRetentionPolicy: (modelRaw.responseRetentionPolicy ||
              modelRaw.response_retention_policy ||
              undefined) as string | undefined,
            trainingUsageAllowed:
              typeof modelRaw.trainingUsageAllowed === "boolean"
                ? modelRaw.trainingUsageAllowed
                : typeof modelRaw.training_usage_allowed === "boolean"
                  ? modelRaw.training_usage_allowed
                  : undefined,
            dataClassification: (modelRaw.dataClassification ||
              modelRaw.data_classification ||
              undefined) as string | undefined,
            approvedForSensitiveCode:
              typeof modelRaw.approvedForSensitiveCode === "boolean"
                ? modelRaw.approvedForSensitiveCode
                : typeof modelRaw.approved_for_sensitive_code === "boolean"
                  ? modelRaw.approved_for_sensitive_code
                  : undefined,
            approvedForRegulatedWorkloads:
              typeof modelRaw.approvedForRegulatedWorkloads === "boolean"
                ? modelRaw.approvedForRegulatedWorkloads
                : typeof modelRaw.approved_for_regulated_workloads === "boolean"
                  ? modelRaw.approved_for_regulated_workloads
                  : undefined,
            modelPolicyVersion: (modelRaw.modelPolicyVersion ||
              modelRaw.model_policy_version ||
              undefined) as string | undefined,
            metadata: modelRaw,
          });
          modelGovernance = assessModelRisk(normalized);
        } catch (err) {
          modelWarnings = [`model_governance_assessment_failed: ${String(err)}`];
        }
      }
      const traceId =
        String(a.trace_id ?? metadataIn.trace_id ?? metadataIn.traceId ?? "").trim() || randomUUID();
      const ruleContext = ruleContextFromArgs(a);
      await refreshRulesLibrary();
      const vimlRaw = String(a.viml || "").trim();
      let result = runPolicyAudit(code, profileId, ruleContext);
      let vibeIntentForLog: string | undefined;
      let vimlSnapshotAudit: Record<string, unknown> | undefined;
      if (vimlRaw) {
        const pv = parseVimlDocument(vimlRaw);
        if (!pv.ok) {
          return {
            content: [{ type: "text", text: `VIML parse error: ${pv.error}` }],
            isError: true,
          };
        }
        profileId = pv.doc.vibe.profile || profileId;
        vibeIntentForLog = pv.doc.vibe.intent;
        vimlSnapshotAudit = vimlDocumentForLog(pv.doc);
        const { hits } = runVimlEnforceFastPath(code, pv.doc);
        if (hits.length > 0) {
          const base = runPolicyAudit(code, profileId, ruleContext);
          result = auditResultFromVimlEnforce(base, hits);
        } else {
          result = runPolicyAudit(code, profileId, ruleContext);
        }
      }
      if (modelGovernance?.level === "HIGH") {
        const synthetic = {
          ruleId: "MODEL-GOV-001",
          domain: "governance",
          title: "Model governance risk is HIGH",
          severity: "HIGH",
          rationale: modelGovernance.rationale.join(" "),
          remediation:
            "Use an approved model/deployment context or supply complete governance metadata.",
        };
        const nextFindings = [...result.findings, synthetic];
        const nextBlocking = (result.totals?.blockingFindings ?? 0) + 1;
        const nextTotal = (result.totals?.findings ?? result.findings.length) + 1;
        result = {
          ...result,
          gate: "blocked",
          findings: nextFindings,
          totals: {
            ...result.totals,
            findings: nextTotal,
            blockingFindings: nextBlocking,
          },
        };
      }
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
        intentPrompt: vibeIntentForLog || (a.userPrompt as string) || "audit_vibe invocation",
        proposedCode: code,
        decision: result.gate !== "blocked",
        violations: result.findings,
        rawOpaPayload: {
          source: "audit_vibe",
          profile_id: result.profile.id,
          gate: result.gate,
          totals: result.totals,
          ...(vimlSnapshotAudit ? { viml: vimlSnapshotAudit } : {}),
        },
        metadata: {
          ...metadataIn,
          interaction_id: a.interaction_id ?? metadataIn.interaction_id ?? null,
          team_id: a.team_id ?? metadataIn.team_id ?? null,
          repo: a.repo ?? metadataIn.repo ?? metadataIn.repo_name ?? null,
          branch: a.branch ?? metadataIn.branch ?? null,
          commit_sha: a.commit_sha ?? metadataIn.commit_sha ?? null,
          pr_number: a.pr_number ?? metadataIn.pr_number ?? null,
          agent_name: a.agent_name ?? metadataIn.agent_name ?? null,
          agent_version: a.agent_version ?? metadataIn.agent_version ?? null,
          project_id: projectIdRaw,
          profile_id: result.profile.id,
          mcp_tool: "audit_vibe",
          model_governance_risk: modelGovernance?.level ?? null,
          model_governance_rationale: modelGovernance?.rationale ?? [],
          ...(vibeIntentForLog ? { vibe_intent: vibeIntentForLog } : {}),
          ...(vimlSnapshotAudit && typeof vimlSnapshotAudit.vibe === "object" && vimlSnapshotAudit.vibe !== null
            ? {
                viml_profile: (vimlSnapshotAudit.vibe as { profile?: string }).profile ?? null,
              }
            : {}),
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
          interaction_id: a.interaction_id ?? metadataIn.interaction_id ?? null,
          team_id: a.team_id ?? metadataIn.team_id ?? null,
          repo: a.repo ?? metadataIn.repo ?? metadataIn.repo_name ?? null,
          branch: a.branch ?? metadataIn.branch ?? null,
          commit_sha: a.commit_sha ?? metadataIn.commit_sha ?? null,
          pr_number: a.pr_number ?? metadataIn.pr_number ?? null,
          agent_name: a.agent_name ?? metadataIn.agent_name ?? null,
          agent_version: a.agent_version ?? metadataIn.agent_version ?? null,
          model_version: metadataIn.model_version || "project-vail-policy-engine-1.0.0",
          timestamp: metadataIn.timestamp || new Date().toISOString(),
          git_branch: metadataIn.git_branch || process.env.GIT_BRANCH || "unknown",
          profile_id: result.profile.id,
          model_governance_risk: modelGovernance?.level ?? null,
          model_governance_rationale: modelGovernance?.rationale ?? [],
          model_governance_warnings: modelWarnings,
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
        appName: "Project Vail MCP",
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

      const vimlPolicy = String(a.viml || "").trim();
      const evalResult = await evaluatePolicy(
        {
          code: proposedCode,
          intent_prompt: intentPrompt,
          profile_id: (a.profile_id as string) || undefined,
          viml_policy: vimlPolicy || undefined,
        },
        (code, profileId, ctx) => runPolicyAudit(code, profileId, ctx ?? ruleContextFromArgs(a)),
        ruleContextFromArgs(a),
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
      const warnings: string[] = [];
      const interactionId = String(a.interaction_id ?? meta.interaction_id ?? "").trim() || null;
      const modelRaw =
        a.model && typeof a.model === "object" ? (a.model as Record<string, unknown>) : null;
      let modelRisk:
        | {
            level: "LOW" | "MEDIUM" | "HIGH";
            rationale: string[];
          }
        | null = null;
      if (modelRaw) {
        try {
          modelRisk = assessModelRisk(
            normalizeModelMetadata({
              provider: String(modelRaw.provider || modelRaw.model_provider || "unknown"),
              modelName: String(modelRaw.modelName || modelRaw.model_name || "unknown"),
              modelVersion: (modelRaw.modelVersion || modelRaw.model_version || undefined) as
                | string
                | undefined,
              hostingType: (modelRaw.hostingType || modelRaw.hosting_type || undefined) as
                | string
                | undefined,
              endpointRegion: (modelRaw.endpointRegion || modelRaw.endpoint_region || undefined) as
                | string
                | undefined,
              dataProcessingRegion: (modelRaw.dataProcessingRegion ||
                modelRaw.data_processing_region ||
                undefined) as string | undefined,
              userGeography: (modelRaw.userGeography || modelRaw.user_geography || undefined) as
                | string
                | undefined,
              jurisdiction: (modelRaw.jurisdiction || undefined) as string | undefined,
              promptRetentionPolicy: (modelRaw.promptRetentionPolicy ||
                modelRaw.prompt_retention_policy ||
                undefined) as string | undefined,
              responseRetentionPolicy: (modelRaw.responseRetentionPolicy ||
                modelRaw.response_retention_policy ||
                undefined) as string | undefined,
              trainingUsageAllowed:
                typeof modelRaw.trainingUsageAllowed === "boolean"
                  ? modelRaw.trainingUsageAllowed
                  : typeof modelRaw.training_usage_allowed === "boolean"
                    ? modelRaw.training_usage_allowed
                    : undefined,
              dataClassification: (modelRaw.dataClassification ||
                modelRaw.data_classification ||
                undefined) as string | undefined,
              approvedForSensitiveCode:
                typeof modelRaw.approvedForSensitiveCode === "boolean"
                  ? modelRaw.approvedForSensitiveCode
                  : typeof modelRaw.approved_for_sensitive_code === "boolean"
                    ? modelRaw.approved_for_sensitive_code
                    : undefined,
              approvedForRegulatedWorkloads:
                typeof modelRaw.approvedForRegulatedWorkloads === "boolean"
                  ? modelRaw.approvedForRegulatedWorkloads
                  : typeof modelRaw.approved_for_regulated_workloads === "boolean"
                    ? modelRaw.approved_for_regulated_workloads
                    : undefined,
              modelPolicyVersion: (modelRaw.modelPolicyVersion ||
                modelRaw.model_policy_version ||
                undefined) as string | undefined,
              metadata: modelRaw,
            }),
          );
        } catch (err) {
          warnings.push(`model_governance_assessment_failed:${String(err)}`);
        }
      }
      const traceId = String(a.trace_id ?? meta.trace_id ?? meta.traceId ?? "").trim() || randomUUID();
      let vibeIntentSigned: string | undefined;
      let vimlProfileMeta: string | null | undefined;
      if (vimlPolicy) {
        const pv = parseVimlDocument(vimlPolicy);
        if (pv.ok) {
          vibeIntentSigned = pv.doc.vibe.intent;
          vimlProfileMeta = pv.doc.vibe.profile ?? null;
        }
      }
      const persist = await persistVibeDecision({
        traceId,
        actorId,
        intentPrompt: vibeIntentSigned || intentPrompt,
        proposedCode,
        decision: evalResult.allow,
        violations: evalResult.violations,
        rawOpaPayload: evalResult.raw,
        metadata: {
          ...meta,
          interaction_id: interactionId,
          team_id: a.team_id ?? meta.team_id ?? null,
          repo: a.repo ?? meta.repo ?? meta.repo_name ?? null,
          branch: a.branch ?? meta.branch ?? null,
          commit_sha: a.commit_sha ?? meta.commit_sha ?? null,
          pr_number: a.pr_number ?? meta.pr_number ?? null,
          agent_name: a.agent_name ?? meta.agent_name ?? null,
          agent_version: a.agent_version ?? meta.agent_version ?? null,
          model_governance_risk: modelRisk?.level ?? null,
          model_governance_rationale: modelRisk?.rationale ?? [],
          opa_source: evalResult.source,
          evaluated_at: new Date().toISOString(),
          ...(vibeIntentSigned ? { vibe_intent: vibeIntentSigned } : {}),
          ...(vimlProfileMeta !== undefined ? { viml_profile: vimlProfileMeta } : {}),
        },
      });

      const summary = {
        decision: evalResult.allow ? "ALLOW" : "DENY",
        violations: evalResult.violations,
        source: evalResult.source,
        model_governance_risk: modelRisk?.level ?? null,
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
      let interactionCapture: Awaited<ReturnType<typeof captureAgentInteraction>> | null = null;
      if (
        a.prompt != null ||
        a.response != null ||
        a.proposed_code != null ||
        a.final_code != null
      ) {
        try {
          interactionCapture = await captureAgentInteraction({
            traceId,
            decisionLogId: undefined,
            sessionId: String(a.session_id ?? "").trim() || undefined,
            actorId,
            teamId: String(a.team_id ?? "").trim() || undefined,
            agentName: String(a.agent_name ?? "unknown-agent"),
            agentVersion: String(a.agent_version ?? "").trim() || undefined,
            workspaceId: String(a.workspace_id ?? "").trim() || undefined,
            repo: String(a.repo ?? meta.repo_name ?? "").trim() || undefined,
            branch: String(a.branch ?? "").trim() || undefined,
            commitSha: String(a.commit_sha ?? "").trim() || undefined,
            prNumber: String(a.pr_number ?? "").trim() || undefined,
            prompt: a.prompt != null ? String(a.prompt) : undefined,
            response: a.response != null ? String(a.response) : undefined,
            proposedCode: a.proposed_code != null ? String(a.proposed_code) : undefined,
            finalCode: a.final_code != null ? String(a.final_code) : undefined,
            accepted: typeof a.accepted === "boolean" ? a.accepted : undefined,
            capturePolicy:
              a.capture_policy && typeof a.capture_policy === "object"
                ? (a.capture_policy as Record<string, unknown>)
                : undefined,
            metadata: {
              ...meta,
              source_tool: "log_vibe_transaction",
            },
          });
        } catch (err) {
          warnings.push(`interaction_capture_failed:${String(err)}`);
        }
      }
      let modelUsageRecordId: string | null = null;
      if (modelRaw) {
        try {
          const usage = await recordModelUsage({
            traceId,
            interactionId: interactionCapture?.recordId ?? interactionId ?? undefined,
            metadata: normalizeModelMetadata({
              provider: String(modelRaw.provider || modelRaw.model_provider || "unknown"),
              modelName: String(modelRaw.modelName || modelRaw.model_name || "unknown"),
              modelVersion: (modelRaw.modelVersion || modelRaw.model_version || undefined) as
                | string
                | undefined,
              hostingType: (modelRaw.hostingType || modelRaw.hosting_type || undefined) as
                | string
                | undefined,
              endpointRegion: (modelRaw.endpointRegion || modelRaw.endpoint_region || undefined) as
                | string
                | undefined,
              dataProcessingRegion: (modelRaw.dataProcessingRegion ||
                modelRaw.data_processing_region ||
                undefined) as string | undefined,
              userGeography: (modelRaw.userGeography || modelRaw.user_geography || undefined) as
                | string
                | undefined,
              jurisdiction: (modelRaw.jurisdiction || undefined) as string | undefined,
              promptRetentionPolicy: (modelRaw.promptRetentionPolicy ||
                modelRaw.prompt_retention_policy ||
                undefined) as string | undefined,
              responseRetentionPolicy: (modelRaw.responseRetentionPolicy ||
                modelRaw.response_retention_policy ||
                undefined) as string | undefined,
              trainingUsageAllowed:
                typeof modelRaw.trainingUsageAllowed === "boolean"
                  ? modelRaw.trainingUsageAllowed
                  : typeof modelRaw.training_usage_allowed === "boolean"
                    ? modelRaw.training_usage_allowed
                    : undefined,
              dataClassification: (modelRaw.dataClassification ||
                modelRaw.data_classification ||
                undefined) as string | undefined,
              approvedForSensitiveCode:
                typeof modelRaw.approvedForSensitiveCode === "boolean"
                  ? modelRaw.approvedForSensitiveCode
                  : typeof modelRaw.approved_for_sensitive_code === "boolean"
                    ? modelRaw.approved_for_sensitive_code
                    : undefined,
              approvedForRegulatedWorkloads:
                typeof modelRaw.approvedForRegulatedWorkloads === "boolean"
                  ? modelRaw.approvedForRegulatedWorkloads
                  : typeof modelRaw.approved_for_regulated_workloads === "boolean"
                    ? modelRaw.approved_for_regulated_workloads
                    : undefined,
              modelPolicyVersion: (modelRaw.modelPolicyVersion ||
                modelRaw.model_policy_version ||
                undefined) as string | undefined,
              metadata: modelRaw,
            }),
          });
          modelUsageRecordId = usage.recordId ?? null;
        } catch (err) {
          warnings.push(`model_usage_persist_failed:${String(err)}`);
        }
      }

      await refreshRulesLibrary();
      let profileForArtifacts = (a.profile_id as string) || "baseline.global";
      if (vimlPolicy) {
        const pv = parseVimlDocument(vimlPolicy);
        if (pv.ok) profileForArtifacts = pv.doc.vibe.profile || profileForArtifacts;
      }
      const auditForArtifacts = runPolicyAudit(proposedCode, profileForArtifacts, ruleContextFromArgs(a));
      const projectIdRaw = metadataProjectId(meta);
      const artifacts = await emitMcpSessionArtifacts({
        auditStore,
        toolName: "log_vibe_transaction",
        auditResult: auditForArtifacts,
        appName: projectIdRaw || actorId,
        targetEnvironment: "mcp",
        userPrompt: vibeIntentSigned || intentPrompt,
        agentReasoning: `Policy source: ${evalResult.source}; GRC decision: ${evalResult.allow ? "ALLOW" : "DENY"}; persistence: ${persist.status}`,
        metadata: {
          ...meta,
          model_version: meta.model_version || "project-vail-policy-engine-1.0.0",
          git_branch: meta.git_branch || process.env.GIT_BRANCH || "unknown",
          profile_id: profileForArtifacts,
          actor_id: actorId,
          interaction_id: interactionCapture?.recordId ?? interactionId,
          model_usage_id: modelUsageRecordId,
          model_governance_risk: modelRisk?.level ?? null,
          model_governance_rationale: modelRisk?.rationale ?? [],
          phase2_warnings: warnings,
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
              (warnings.length ? `\nWarnings:\n- ${warnings.join("\n- ")}` : "") +
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
        appName: "Project Vail MCP",
        targetEnvironment: "mcp",
        userPrompt: "get_compliance_history",
        agentReasoning: "Queried recent DENY decision logs from PostgreSQL (if configured).",
        metadata: {
          model_version: "project-vail-policy-engine-1.0.0",
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
      const boiPath = path.join(reportsDirectory(), `project-vail-boi-${slug}-${stamp}.md`);
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
          model_version: "project-vail-policy-engine-1.0.0",
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
        appName: "Project Vail MCP",
        targetEnvironment: "mcp",
        userPrompt: "verify_audit_integrity",
        agentReasoning: "Verified tamper-evident hash chain and optional RSA signatures over recent rows.",
        metadata: {
          model_version: "project-vail-policy-engine-1.0.0",
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
        appName: "Project Vail MCP",
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
