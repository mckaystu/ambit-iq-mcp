import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileText, Moon, Sun } from "lucide-react";
import { Badge, Card, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@tremor/react";
import { PRODUCT_NAME } from "./brand";
import HclBrandStrip from "./components/HclBrandStrip";
import GovernanceTabs from "./components/GovernanceTabs";
import { apiPath } from "./apiBase";

type ArtifactRefs = {
  certificate_html_url?: string;
  traceability_json_url?: string;
  traceability_markdown_url?: string;
  boi_markdown_url?: string;
  report_markdown_url?: string;
  report_pdf_url?: string;
  uploaded_at?: string;
  [key: string]: unknown;
};

type ReportRow = {
  id: string;
  trace_id: string;
  timestamp: string | null;
  actor_id: string;
  decision: "ALLOW" | "DENY";
  project_id: string;
  artifact_refs: ArtifactRefs;
};

function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function formatUtc(v: string | null): string {
  if (!v) return "n/a";
  return new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function shortTrace(id: string): string {
  return id.length > 16 ? `${id.slice(0, 14)}…` : id;
}

export default function AuditReportsPage() {
  const [darkMode, setDarkMode] = useState(false);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [decisionFilter, setDecisionFilter] = useState<"all" | "ALLOW" | "DENY">("all");
  const [actorFilter, setActorFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(apiPath("/api/audit-reports?limit=250"))
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((json) => {
        if (!active) return;
        const reports = Array.isArray(json?.reports) ? json.reports : [];
        setRows(reports);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(String(e?.message || e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      if (decisionFilter !== "all" && r.decision !== decisionFilter) return false;
      if (actorFilter && !r.actor_id.toLowerCase().includes(actorFilter.toLowerCase())) return false;
      if (projectFilter && !(r.project_id || "").toLowerCase().includes(projectFilter.toLowerCase())) return false;
      return true;
    });
  }, [rows, decisionFilter, actorFilter, projectFilter]);

  return (
    <div className="min-h-screen bg-carbon-bg dark:bg-slate-950">
      <HclBrandStrip />
      <header className="sticky top-0 z-20 border-b border-carbon-border bg-carbon-layer/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-hcl-blue">{PRODUCT_NAME}</p>
            <h1 className="text-2xl font-semibold tracking-tight text-carbon-text dark:text-slate-50">Audit Reports</h1>
            <p className="mt-1 text-sm text-carbon-text-secondary dark:text-slate-400">
              Browse referenceable audit artifacts linked from <code className="rounded bg-carbon-layer-01 px-1 dark:bg-slate-800">ambit_decision_logs.metadata.artifact_refs</code>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDarkMode((v) => !v)}
              className="rounded-lg border border-carbon-border p-2 hover:bg-carbon-layer-01 dark:border-slate-700 dark:hover:bg-slate-800"
              aria-label="Toggle dark mode"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="mx-auto w-full max-w-7xl px-6 pb-4">
          <GovernanceTabs />
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <Card className="enchanted-card">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Total rows</p>
              <p className="text-xl font-semibold">{rows.length}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Visible rows</p>
              <p className="text-xl font-semibold">{visibleRows.length}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">DENY rows</p>
              <p className="text-xl font-semibold">{rows.filter((r) => r.decision === "DENY").length}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">ALLOW rows</p>
              <p className="text-xl font-semibold">{rows.filter((r) => r.decision === "ALLOW").length}</p>
            </div>
          </div>
        </Card>

        <Card className="enchanted-card">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Decision
              <select
                value={decisionFilter}
                onChange={(e) => setDecisionFilter(e.target.value as "all" | "ALLOW" | "DENY")}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
              >
                <option value="all">All</option>
                <option value="ALLOW">ALLOW</option>
                <option value="DENY">DENY</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Actor contains
              <input
                value={actorFilter}
                onChange={(e) => setActorFilter(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
                placeholder="mcp-user"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Project contains
              <input
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
                placeholder="project_id"
              />
            </label>
          </div>
        </Card>

        <Card className="enchanted-card">
          {loading ? (
            <div className="p-6 text-sm text-carbon-text-secondary dark:text-slate-400">Loading audit reports…</div>
          ) : error ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100">
              {error}
            </div>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Timestamp</TableHeaderCell>
                  <TableHeaderCell>Decision</TableHeaderCell>
                  <TableHeaderCell>Actor</TableHeaderCell>
                  <TableHeaderCell>Project</TableHeaderCell>
                  <TableHeaderCell>Trace</TableHeaderCell>
                  <TableHeaderCell>Artifacts</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleRows.map((row) => {
                  const refs = row.artifact_refs || {};
                  const links = [
                    { label: "Certificate", url: String(refs.certificate_html_url || "") },
                    { label: "Trace JSON", url: String(refs.traceability_json_url || "") },
                    { label: "Trace MD", url: String(refs.traceability_markdown_url || "") },
                    { label: "BoI MD", url: String(refs.boi_markdown_url || "") },
                    { label: "Report MD", url: String(refs.report_markdown_url || "") },
                    { label: "Report PDF", url: String(refs.report_pdf_url || "") },
                  ].filter((x) => x.url);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-sm">{formatUtc(row.timestamp)}</TableCell>
                      <TableCell>
                        <Badge color={row.decision === "DENY" ? "red" : "emerald"}>{row.decision}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate text-sm" title={row.actor_id}>
                        {row.actor_id || "unknown"}
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate text-sm" title={row.project_id || ""}>
                        {row.project_id || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs" title={row.trace_id}>
                        {shortTrace(row.trace_id)}
                      </TableCell>
                      <TableCell>
                        {links.length ? (
                          <div className="flex flex-wrap gap-2">
                            {links.map((link) => (
                              <a
                                key={`${row.id}-${link.label}`}
                                href={link.url}
                                target="_blank"
                                rel="noreferrer"
                                className={cls(
                                  "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs",
                                  "border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800",
                                )}
                              >
                                <FileText className="h-3 w-3" />
                                {link.label}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm text-slate-500">No artifact refs</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </main>
    </div>
  );
}

