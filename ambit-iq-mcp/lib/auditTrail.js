import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function timestampTag(d = new Date()) {
  return d.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function escMd(v) {
  return String(v ?? "").replaceAll("|", "\\|");
}

/**
 * Stub forwarder for future remote delivery (S3, Vercel DB, SIEM, etc).
 * Replace implementation once endpoint contract is defined.
 */
export async function forwardAuditLog(_auditLog, _opts = {}) {
  return { forwarded: false, reason: "forwarder_not_configured" };
}

export function generateAuditSummary(auditLog, style = "detailed") {
  const m = auditLog?.metadata || {};
  const ar = auditLog?.ambit_results || {};
  const checks = ar?.checks || {};
  const gate = String(ar?.gate || "unknown").toUpperCase();
  const lines = [];
  lines.push("## Ambit.IQ Traceability Log");
  lines.push("");
  lines.push(`- **Gate:** ${gate}`);
  lines.push(`- **Model:** ${escMd(m.model_version || "unknown")}`);
  lines.push(`- **Timestamp:** ${escMd(m.timestamp || "unknown")}`);
  lines.push(`- **Git branch:** ${escMd(m.git_branch || "unknown")}`);
  lines.push(`- **Profile:** ${escMd(ar.profile_id || "unknown")}`);
  lines.push("");
  lines.push("### Control Summary");
  lines.push("");
  lines.push("| Control | Status |");
  lines.push("|---------|--------|");
  lines.push(`| Security | ${(checks.security?.pass ? "PASS" : "FAIL")} |`);
  lines.push(`| AODA / Accessibility | ${(checks.aoda?.pass ? "PASS" : "FAIL")} |`);
  lines.push(`| Async Resilience | ${(checks.async_resilience?.pass ? "PASS" : "FAIL")} |`);
  lines.push("");
  if (style !== "brief") {
    lines.push("### Prompt Intent");
    lines.push("");
    lines.push(`> ${String(auditLog?.user_prompt || "").trim() || "(none provided)"}`);
    lines.push("");
    lines.push("### Agent Reasoning (Provided)");
    lines.push("");
    lines.push(`> ${String(auditLog?.agent_reasoning || "").trim() || "(none provided)"}`);
    lines.push("");
  }
  return lines.join("\n");
}

export class AuditStore {
  constructor(options = {}) {
    this.logsDir = options.logsDir || path.join(process.cwd(), ".ambit", "logs");
    this.forwarder = options.forwarder || null;
    this.forwarderOptions = options.forwarderOptions || {};
  }

  async writeAuditLog(logRecord) {
    await mkdir(this.logsDir, { recursive: true });
    const now = new Date();
    const baseName = `${timestampTag(now)}-audit`;
    const fileName = `${baseName}.json`;
    const filePath = path.join(this.logsDir, fileName);
    const markdownFileName = `${baseName}.md`;
    const markdownFilePath = path.join(this.logsDir, markdownFileName);
    const payload = {
      ...logRecord,
      metadata: {
        ...(logRecord.metadata || {}),
        stored_at: now.toISOString(),
      },
    };
    const summaryStyle = logRecord?.summary_style === "brief" ? "brief" : "detailed";
    const markdownSummary = generateAuditSummary(payload, summaryStyle);
    await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
    await writeFile(markdownFilePath, markdownSummary, "utf8");

    let forwardResult = { forwarded: false, reason: "forwarder_not_set" };
    if (this.forwarder) {
      try {
        forwardResult = await this.forwarder(payload, this.forwarderOptions);
      } catch (e) {
        forwardResult = { forwarded: false, reason: `forwarder_error:${e}` };
      }
    }

    return {
      filePath,
      fileName,
      markdownFilePath,
      markdownFileName,
      payload,
      markdownSummary,
      forwardResult,
    };
  }
}
