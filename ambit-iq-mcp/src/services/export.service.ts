import { getPrisma } from "./audit.service.js";

type ExportType = "incidents" | "interactions" | "model-governance" | "dashboard-metrics" | "evidence-bundle";

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "";
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const header = keys.join(",");
  const body = rows.map((r) => keys.map((k) => esc(r[k])).join(",")).join("\n");
  return `${header}\n${body}`;
}

async function fetchRows(type: ExportType): Promise<Array<Record<string, unknown>>> {
  const prisma = getPrisma();
  if (!prisma) return [];
  try {
    if (type === "incidents") return await prisma.incident.findMany({ take: 1000, orderBy: { createdAt: "desc" } });
    if (type === "interactions")
      return await prisma.agentInteraction.findMany({ take: 1000, orderBy: { createdAt: "desc" } });
    if (type === "model-governance") return await prisma.modelUsage.findMany({ take: 1000, orderBy: { createdAt: "desc" } });
    if (type === "dashboard-metrics")
      return await prisma.dashboardMetricSnapshot.findMany({ take: 1000, orderBy: { createdAt: "desc" } });
    const [incidents, interactions, models] = await Promise.all([
      prisma.incident.findMany({ take: 500, orderBy: { createdAt: "desc" } }),
      prisma.agentInteraction.findMany({ take: 500, orderBy: { createdAt: "desc" } }),
      prisma.modelUsage.findMany({ take: 500, orderBy: { createdAt: "desc" } }),
    ]);
    return [{ incidents, interactions, modelUsage: models }];
  } catch {
    return [];
  }
}

export async function exportCsv(type: ExportType, _filters: Record<string, unknown> = {}) {
  const rows = await fetchRows(type);
  return { type, format: "csv", content: toCsv(rows) };
}

export async function exportJson(type: ExportType, _filters: Record<string, unknown> = {}) {
  const rows = await fetchRows(type);
  return { type, format: "json", content: rows };
}

export async function exportHtmlReport(type: "executive-board" | "audit-readiness" | "incident-evidence", _filters: Record<string, unknown> = {}) {
  const title =
    type === "executive-board"
      ? "Executive Board Report"
      : type === "audit-readiness"
        ? "Audit Readiness Report"
        : "Incident Evidence Summary";
  const body = `<h1>${title}</h1><p>Generated at ${new Date().toISOString()}</p>`;
  return {
    type,
    format: "html",
    content: `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`,
  };
}
