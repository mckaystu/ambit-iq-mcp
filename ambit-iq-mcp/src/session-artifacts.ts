import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAuditCertificateHtml } from "#cert";
import type { AuditStore } from "#audit";
import { runPolicyAudit, summarizeAmbitResults } from "#pf";
import { generateAuditReportMarkdown } from "./services/audit.service.js";

export type PolicyAuditResult = ReturnType<typeof runPolicyAudit>;

export function reportsDirectory(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return "/tmp/ambit-iq-reports";
  }
  return path.join(process.cwd(), "reports");
}

function safeTag(s: string, max = 72): string {
  return String(s)
    .replaceAll(/[^a-zA-Z0-9._-]/g, "-")
    .toLowerCase()
    .slice(0, max);
}

function isoStamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export interface SessionArtifactPaths {
  certificateHtmlPath: string | null;
  traceabilityJsonPath: string | null;
  traceabilityMdPath: string | null;
  boiMarkdownPath: string | null;
  warnings: string[];
}

export function formatArtifactSuffix(w: SessionArtifactPaths): string {
  const lines: string[] = [];
  if (w.certificateHtmlPath) lines.push(`HTML certificate: ${w.certificateHtmlPath}`);
  if (w.traceabilityJsonPath) lines.push(`Traceability JSON: ${w.traceabilityJsonPath}`);
  if (w.traceabilityMdPath) lines.push(`Traceability markdown: ${w.traceabilityMdPath}`);
  if (w.boiMarkdownPath) lines.push(`Bill of Intent report (markdown file): ${w.boiMarkdownPath}`);
  for (const x of w.warnings) lines.push(`Note: ${x}`);
  if (!lines.length) return "";
  return `\n\n---\nAmbit.IQ session artifacts\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

/**
 * Writes HTML certificate, optional .ambit traceability logs, and optional BoI markdown from Postgres.
 */
export async function emitMcpSessionArtifacts(params: {
  auditStore: AuditStore | null;
  toolName: string;
  auditResult: PolicyAuditResult;
  appName: string;
  targetEnvironment: string;
  userPrompt: string;
  agentReasoning: string;
  metadata: Record<string, unknown>;
  includeCertificate: boolean;
  includeTraceability: boolean;
  traceabilitySummaryStyle?: "brief" | "detailed";
  certificateOutputPath?: string | null;
  projectIdForBoI?: string | null;
  boiHours?: number;
}): Promise<SessionArtifactPaths> {
  const warnings: string[] = [];
  let certificateHtmlPath: string | null = null;
  let traceabilityJsonPath: string | null = null;
  let traceabilityMdPath: string | null = null;
  let boiMarkdownPath: string | null = null;

  const { auditResult } = params;
  const safeProfile = safeTag(String(auditResult.profile?.id || "profile"));
  const toolTag = safeTag(params.toolName, 40);
  const stamp = isoStamp();

  if (params.includeCertificate) {
    const html = buildAuditCertificateHtml({
      result: auditResult,
      appName: params.appName,
      targetEnvironment: params.targetEnvironment,
      scannerName: "Ambit.IQ",
    });
    const fallbackPath = path.join(
      reportsDirectory(),
      `ambit-iq-certificate-${toolTag}-${stamp}-${safeProfile}.html`,
    );
    const outPath = params.certificateOutputPath
      ? path.resolve(String(params.certificateOutputPath))
      : fallbackPath;
    try {
      await mkdir(path.dirname(outPath), { recursive: true });
      await writeFile(outPath, html, "utf8");
      certificateHtmlPath = outPath;
    } catch (e) {
      warnings.push(`certificate write failed: ${String(e)} (on Vercel use /tmp or omit custom path)`);
    }
  }

  if (params.includeTraceability && params.auditStore) {
    const ambitResults = summarizeAmbitResults(auditResult);
    const metadata = {
      ...params.metadata,
      mcp_tool: params.toolName,
      timestamp: params.metadata.timestamp || new Date().toISOString(),
    };
    try {
      const style =
        params.traceabilitySummaryStyle === "brief" || params.traceabilitySummaryStyle === "detailed"
          ? params.traceabilitySummaryStyle
          : "detailed";
      const written = await params.auditStore.writeAuditLog({
        user_prompt: params.userPrompt,
        agent_reasoning: params.agentReasoning,
        ambit_results: ambitResults,
        metadata,
        summary_style: style,
      });
      traceabilityJsonPath = written.filePath;
      traceabilityMdPath = written.markdownFilePath;
    } catch (e) {
      warnings.push(`traceability log failed: ${String(e)}`);
    }
  }

  const projectId = String(params.projectIdForBoI || "").trim();
  if (projectId) {
    const rep = await generateAuditReportMarkdown({
      projectId,
      hours: params.boiHours,
    });
    if (rep.ok) {
      const out = path.join(
        reportsDirectory(),
        `ambit-iq-boi-${safeTag(projectId, 48)}-${stamp}.md`,
      );
      try {
        await mkdir(path.dirname(out), { recursive: true });
        await writeFile(out, rep.markdown, "utf8");
        boiMarkdownPath = out;
      } catch (e) {
        warnings.push(`BoI report file write failed: ${String(e)}`);
      }
    } else {
      warnings.push(rep.error || "BoI report skipped (database or query error)");
    }
  }

  return {
    certificateHtmlPath,
    traceabilityJsonPath,
    traceabilityMdPath,
    boiMarkdownPath,
    warnings,
  };
}
