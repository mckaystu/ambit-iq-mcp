import { Card, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@tremor/react";
import { useEffect, useMemo, useState } from "react";
import EmptyState from "./components/EmptyState";
import ErrorState from "./components/ErrorState";
import LoadingState from "./components/LoadingState";
import PageShell from "./components/PageShell";
import StatusBadge from "./components/StatusBadge";
import {
  createIncident,
  exportData,
  getCurrentUser,
  getIncidentTimeline,
  searchIncidents,
} from "./lib/api";

function asArray(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}

function fmt(v: unknown): string {
  if (!v) return "n/a";
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : String(v);
}

export default function IncidentsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<Array<Record<string, unknown>>>([]);
  const [timeline, setTimeline] = useState<Array<Record<string, unknown>>>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [filters, setFilters] = useState({ severity: "", status: "", repo: "", actor_id: "" });
  const [form, setForm] = useState({ title: "", severity: "HIGH", repo: "", description: "" });
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [canExport, setCanExport] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser()
      .then((r) => setCanExport(r.user.permissions.includes("*") || r.user.permissions.includes("export.reports")))
      .catch(() => setCanExport(false));
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    searchIncidents()
      .then((res) => {
        if (!active) return;
        setIncidents(asArray(res.incidents));
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

  useEffect(() => {
    if (!selectedIncidentId) {
      setTimeline([]);
      return;
    }
    getIncidentTimeline({ incident_id: selectedIncidentId })
      .then((res) => setTimeline(asArray(res.timeline)))
      .catch(() => setTimeline([]));
  }, [selectedIncidentId]);

  const filtered = useMemo(() => {
    return incidents.filter((row) => {
      if (filters.severity && String(row.severity || "").toLowerCase() !== filters.severity.toLowerCase()) return false;
      if (filters.status && String(row.status || "").toLowerCase() !== filters.status.toLowerCase()) return false;
      if (filters.repo && !String(row.repo || "").toLowerCase().includes(filters.repo.toLowerCase())) return false;
      if (filters.actor_id && !String(row.actor_id || "").toLowerCase().includes(filters.actor_id.toLowerCase())) return false;
      return true;
    });
  }, [incidents, filters]);

  async function onCreateIncident(e: React.FormEvent) {
    e.preventDefault();
    setCreateMsg(null);
    try {
      await createIncident(form);
      setCreateMsg("Incident created.");
      const next = await searchIncidents();
      setIncidents(asArray(next.incidents));
      setForm({ title: "", severity: "HIGH", repo: "", description: "" });
    } catch (err) {
      setCreateMsg(`Failed to create incident: ${String((err as Error).message || err)}`);
    }
  }

  return (
    <PageShell
      title="Incident Response"
      subtitle="Investigate AI-assisted coding events and reconstruct forensic timelines"
    >
      {canExport ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={async () => {
              const out = await exportData({ format: "json", type: "incidents" });
              setToast(`Export generated (${String(out.format || "json")})`);
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
          >
            Export Incidents
          </button>
        </div>
      ) : null}
      {toast ? <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm">{toast}</div> : null}
      {loading ? <LoadingState message="Loading incidents..." /> : null}
      {error ? <ErrorState message={error} /> : null}

      {!loading && !error ? (
        <>
          <Card className="enchanted-card">
            <div className="grid gap-3 md:grid-cols-4">
              <input className="carbon-field" placeholder="Severity" value={filters.severity} onChange={(e) => setFilters((cur) => ({ ...cur, severity: e.target.value }))} />
              <input className="carbon-field" placeholder="Status" value={filters.status} onChange={(e) => setFilters((cur) => ({ ...cur, status: e.target.value }))} />
              <input className="carbon-field" placeholder="Repo" value={filters.repo} onChange={(e) => setFilters((cur) => ({ ...cur, repo: e.target.value }))} />
              <input className="carbon-field" placeholder="Actor ID" value={filters.actor_id} onChange={(e) => setFilters((cur) => ({ ...cur, actor_id: e.target.value }))} />
            </div>
          </Card>

          <Card className="enchanted-card">
            <h3 className="mb-3 text-base font-semibold">Incidents</h3>
            {!filtered.length ? (
              <EmptyState message="No incidents match the current filters." />
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Title</TableHeaderCell>
                    <TableHeaderCell>Severity</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Repo</TableHeaderCell>
                    <TableHeaderCell>Actor</TableHeaderCell>
                    <TableHeaderCell>First Seen</TableHeaderCell>
                    <TableHeaderCell>Last Seen</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow
                      key={String(row.id)}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50"
                      onClick={() => setSelectedIncidentId(String(row.id))}
                    >
                      <TableCell>{String(row.title || "untitled")}</TableCell>
                      <TableCell><StatusBadge status={String(row.severity || "")} /></TableCell>
                      <TableCell><StatusBadge status={String(row.status || "")} /></TableCell>
                      <TableCell>{String(row.repo || "n/a")}</TableCell>
                      <TableCell>{String(row.actor_id || "n/a")}</TableCell>
                      <TableCell>{fmt(row.first_seen_at || row.firstSeenAt)}</TableCell>
                      <TableCell>{fmt(row.last_seen_at || row.lastSeenAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          <Card className="enchanted-card">
            <h3 className="mb-3 text-base font-semibold">Timeline {selectedIncidentId ? `for ${selectedIncidentId}` : ""}</h3>
            {!selectedIncidentId ? (
              <EmptyState message="Select an incident row to load timeline events." />
            ) : !timeline.length ? (
              <EmptyState message="No timeline events found for this incident." />
            ) : (
              <div className="space-y-2">
                {timeline.map((item, idx) => (
                  <div key={`${item.timestamp}-${idx}`} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                    <p className="font-medium">{fmt(item.timestamp)} — {String(item.event_type || item.eventType || "event")}</p>
                    <p className="mt-1 text-slate-600 dark:text-slate-300">
                      actor: {String(item.actor_id || item.actorId || "n/a")} | repo: {String(item.repo || "n/a")} | commit: {String(item.commit_sha || "n/a")}
                    </p>
                    <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs dark:bg-slate-900">
                      {JSON.stringify(item.payload || {}, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="enchanted-card">
            <h3 className="mb-3 text-base font-semibold">Create incident</h3>
            <form onSubmit={onCreateIncident} className="grid gap-3 md:grid-cols-2">
              <input required className="carbon-field" placeholder="Title" value={form.title} onChange={(e) => setForm((cur) => ({ ...cur, title: e.target.value }))} />
              <select className="carbon-field" value={form.severity} onChange={(e) => setForm((cur) => ({ ...cur, severity: e.target.value }))}>
                <option>LOW</option>
                <option>MEDIUM</option>
                <option>HIGH</option>
                <option>CRITICAL</option>
              </select>
              <input className="carbon-field" placeholder="Repo" value={form.repo} onChange={(e) => setForm((cur) => ({ ...cur, repo: e.target.value }))} />
              <input className="carbon-field" placeholder="Description" value={form.description} onChange={(e) => setForm((cur) => ({ ...cur, description: e.target.value }))} />
              <div className="md:col-span-2">
                <button type="submit" className="rounded-lg bg-hcl-blue px-4 py-2 text-sm font-medium text-white">Create Incident</button>
              </div>
            </form>
            {createMsg ? <p className="mt-3 text-sm">{createMsg}</p> : null}
          </Card>
        </>
      ) : null}
    </PageShell>
  );
}
