import { Card, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@tremor/react";
import { Fragment, useEffect, useMemo, useState } from "react";
import EmptyState from "./components/EmptyState";
import ErrorState from "./components/ErrorState";
import LoadingState from "./components/LoadingState";
import MetricCard from "./components/MetricCard";
import PageShell from "./components/PageShell";
import StatusBadge from "./components/StatusBadge";
import { getAgentInteraction, searchAgentInteractions } from "./lib/api";

function asArray(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}

function fmt(v: unknown): string {
  if (!v) return "n/a";
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : String(v);
}

export default function AgentInteractionsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, Record<string, unknown>>>({});
  const [filters, setFilters] = useState({ repo: "", actor_id: "", agent_name: "", accepted: "" });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    searchAgentInteractions()
      .then((res) => {
        if (!active) return;
        setRows(asArray(res.interactions));
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

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (filters.repo && !String(row.repo || "").toLowerCase().includes(filters.repo.toLowerCase())) return false;
      if (filters.actor_id && !String(row.actor_id || row.actorId || "").toLowerCase().includes(filters.actor_id.toLowerCase())) return false;
      if (filters.agent_name && !String(row.agent_name || row.agentName || "").toLowerCase().includes(filters.agent_name.toLowerCase())) return false;
      if (filters.accepted) {
        const val = String(row.accepted);
        if (filters.accepted === "true" && val !== "true") return false;
        if (filters.accepted === "false" && val !== "false") return false;
      }
      return true;
    });
  }, [rows, filters]);

  const summary = useMemo(() => {
    const total = rows.length;
    const promptCaptured = rows.filter((r) => Boolean(r.prompt_captured ?? r.promptCaptured)).length;
    const responseCaptured = rows.filter((r) => Boolean(r.response_captured ?? r.responseCaptured)).length;
    const accepted = rows.filter((r) => r.accepted === true).length;
    const rejectedUnknown = rows.filter((r) => r.accepted !== true).length;
    return {
      total,
      promptRate: total ? Math.round((promptCaptured / total) * 100) : 0,
      responseRate: total ? Math.round((responseCaptured / total) * 100) : 0,
      accepted,
      rejectedUnknown,
    };
  }, [rows]);

  async function loadDetail(id: string) {
    if (selectedId === id) {
      setSelectedId(null);
      return;
    }

    setSelectedId(id);
    if (detailCache[id]) return;

    try {
      const res = await getAgentInteraction(id);
      const interaction = (res.interaction || null) as Record<string, unknown> | null;
      if (!interaction) return;
      setDetailCache((prev) => ({ ...prev, [id]: interaction }));
    } catch {
      // Keep the row selected even if detail fetch fails.
    }
  }

  return (
    <PageShell
      title="Agent Interactions"
      subtitle="Captured prompts, responses, proposed code, and acceptance telemetry"
    >
      {loading ? <LoadingState message="Loading agent interactions..." /> : null}
      {error ? <ErrorState message={error} /> : null}

      {!loading && !error ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Total interactions" value={summary.total} />
            <MetricCard label="Prompt capture rate" value={`${summary.promptRate}%`} />
            <MetricCard label="Response capture rate" value={`${summary.responseRate}%`} />
            <MetricCard label="Accepted suggestions" value={summary.accepted} />
            <MetricCard label="Rejected/unknown suggestions" value={summary.rejectedUnknown} />
          </div>

          <Card className="enchanted-card">
            <div className="grid gap-3 md:grid-cols-4">
              <input className="carbon-field" placeholder="Repo" value={filters.repo} onChange={(e) => setFilters((cur) => ({ ...cur, repo: e.target.value }))} />
              <input className="carbon-field" placeholder="Actor ID" value={filters.actor_id} onChange={(e) => setFilters((cur) => ({ ...cur, actor_id: e.target.value }))} />
              <input className="carbon-field" placeholder="Agent name" value={filters.agent_name} onChange={(e) => setFilters((cur) => ({ ...cur, agent_name: e.target.value }))} />
              <select className="carbon-field" value={filters.accepted} onChange={(e) => setFilters((cur) => ({ ...cur, accepted: e.target.value }))}>
                <option value="">Accepted: all</option>
                <option value="true">Accepted only</option>
                <option value="false">Rejected/unknown</option>
              </select>
            </div>
          </Card>

          <Card className="enchanted-card">
            <h3 className="mb-3 text-base font-semibold">Interactions</h3>
            {!filtered.length ? (
              <EmptyState message="No interaction rows match the current filters." />
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Created At</TableHeaderCell>
                    <TableHeaderCell>Agent</TableHeaderCell>
                    <TableHeaderCell>Actor</TableHeaderCell>
                    <TableHeaderCell>Repo</TableHeaderCell>
                    <TableHeaderCell>Branch</TableHeaderCell>
                    <TableHeaderCell>Prompt Captured</TableHeaderCell>
                    <TableHeaderCell>Response Captured</TableHeaderCell>
                    <TableHeaderCell>Accepted</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map((row) => {
                    const id = String(row.id);
                    const isSelected = selectedId === id;
                    const selected = detailCache[id] || row;
                    return (
                      <Fragment key={id}>
                        <TableRow
                          className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50 ${isSelected ? "bg-slate-50 dark:bg-slate-900/40" : ""}`}
                          onClick={() => loadDetail(id)}
                        >
                          <TableCell>{fmt(row.created_at || row.createdAt)}</TableCell>
                          <TableCell>{String(row.agent_name || row.agentName || "unknown")}</TableCell>
                          <TableCell>{String(row.actor_id || row.actorId || "n/a")}</TableCell>
                          <TableCell>{String(row.repo || "n/a")}</TableCell>
                          <TableCell>{String(row.branch || "n/a")}</TableCell>
                          <TableCell><StatusBadge status={String(Boolean(row.prompt_captured ?? row.promptCaptured))} /></TableCell>
                          <TableCell><StatusBadge status={String(Boolean(row.response_captured ?? row.responseCaptured))} /></TableCell>
                          <TableCell><StatusBadge status={String(row.accepted)} /></TableCell>
                        </TableRow>
                        {isSelected ? (
                          <TableRow>
                            <TableCell colSpan={8}>
                              <div className="space-y-3 rounded border border-slate-200 bg-slate-50/60 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/30">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <div>
                                    <p className="font-medium">Prompt (redacted)</p>
                                    <pre className="mt-1 max-h-32 overflow-auto rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                                      {String(selected.prompt_redacted || selected.promptRedacted || "n/a")}
                                    </pre>
                                  </div>
                                  <div>
                                    <p className="font-medium">Response (redacted)</p>
                                    <pre className="mt-1 max-h-32 overflow-auto rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                                      {String(selected.response_redacted || selected.responseRedacted || "n/a")}
                                    </pre>
                                  </div>
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                  <div>
                                    <p className="font-medium">Proposed code (redacted)</p>
                                    <pre className="mt-1 max-h-32 overflow-auto rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                                      {String(selected.proposed_code_redacted || selected.proposedCodeRedacted || "n/a")}
                                    </pre>
                                  </div>
                                  <div>
                                    <p className="font-medium">Final code (redacted)</p>
                                    <pre className="mt-1 max-h-32 overflow-auto rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                                      {String(selected.final_code_redacted || selected.finalCodeRedacted || "n/a")}
                                    </pre>
                                  </div>
                                </div>
                                <div className="grid gap-2 md:grid-cols-3">
                                  <p><strong>Prompt hash:</strong> {String(selected.prompt_hash || selected.promptHash || "n/a")}</p>
                                  <p><strong>Response hash:</strong> {String(selected.response_hash || selected.responseHash || "n/a")}</p>
                                  <p><strong>Code hash:</strong> {String(selected.code_hash || selected.codeHash || "n/a")}</p>
                                </div>
                                <div>
                                  <p className="font-medium">Metadata</p>
                                  <pre className="mt-1 max-h-40 overflow-auto rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                                    {JSON.stringify(selected.metadata || {}, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      ) : null}
    </PageShell>
  );
}
