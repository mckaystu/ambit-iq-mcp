import { readFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";
import type { SessionArtifactPaths } from "../session-artifacts.js";

export interface UploadedArtifactRefs {
  certificate_html_url?: string;
  traceability_json_url?: string;
  traceability_markdown_url?: string;
  boi_markdown_url?: string;
  report_markdown_url?: string;
  uploaded_at: string;
}

export interface UploadArtifactsResult {
  uploaded: UploadedArtifactRefs | null;
  warnings: string[];
}

function extToContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "text/markdown; charset=utf-8";
}

function keyPrefix(toolName: string, traceId?: string): string {
  const safeTool = String(toolName || "mcp")
    .replaceAll(/[^a-zA-Z0-9._-]/g, "-")
    .toLowerCase();
  const safeTrace = String(traceId || "no-trace")
    .replaceAll(/[^a-zA-Z0-9._-]/g, "-")
    .toLowerCase();
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return `agent-gate/audit-artifacts/${safeTool}/${safeTrace}/${stamp}`;
}

async function uploadIfPresent(
  localPath: string | null,
  blobPath: string,
): Promise<string | null> {
  if (!localPath) return null;
  const body = await readFile(localPath);
  const out = await put(blobPath, body, {
    access: "public",
    addRandomSuffix: false,
    contentType: extToContentType(localPath),
  });
  return out.url;
}

/**
 * Uploads generated session artifacts to Vercel Blob when configured.
 * Requires BLOB_READ_WRITE_TOKEN in the runtime environment.
 */
export async function uploadSessionArtifactsToBlob(params: {
  artifacts: SessionArtifactPaths;
  toolName: string;
  traceId?: string;
}): Promise<UploadArtifactsResult> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return {
      uploaded: null,
      warnings: ["Blob upload skipped: BLOB_READ_WRITE_TOKEN is not configured."],
    };
  }

  const warnings: string[] = [];
  const prefix = keyPrefix(params.toolName, params.traceId);

  const uploaded: UploadedArtifactRefs = {
    uploaded_at: new Date().toISOString(),
  };

  const specs: Array<{
    localPath: string | null;
    key: keyof UploadedArtifactRefs;
    blobName: string;
  }> = [
    {
      localPath: params.artifacts.certificateHtmlPath,
      key: "certificate_html_url",
      blobName: "certificate.html",
    },
    {
      localPath: params.artifacts.traceabilityJsonPath,
      key: "traceability_json_url",
      blobName: "traceability.json",
    },
    {
      localPath: params.artifacts.traceabilityMdPath,
      key: "traceability_markdown_url",
      blobName: "traceability.md",
    },
    {
      localPath: params.artifacts.boiMarkdownPath,
      key: "boi_markdown_url",
      blobName: "boi.md",
    },
    {
      localPath: params.artifacts.reportMarkdownPath,
      key: "report_markdown_url",
      blobName: "report.md",
    },
  ];

  for (const s of specs) {
    if (!s.localPath) continue;
    try {
      const url = await uploadIfPresent(s.localPath, `${prefix}/${s.blobName}`);
      if (url) uploaded[s.key] = url;
    } catch (e) {
      warnings.push(`Blob upload failed for ${s.blobName}: ${String(e)}`);
    }
  }

  const hasAnyUrl = Object.keys(uploaded).some((k) => k !== "uploaded_at");
  return {
    uploaded: hasAnyUrl ? uploaded : null,
    warnings,
  };
}
