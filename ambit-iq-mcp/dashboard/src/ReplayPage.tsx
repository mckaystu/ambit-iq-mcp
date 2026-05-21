import { Card } from "@tremor/react";
import { useState } from "react";
import EmptyState from "./components/EmptyState";
import ErrorState from "./components/ErrorState";
import LoadingState from "./components/LoadingState";
import PageShell from "./components/PageShell";
import StatusBadge from "./components/StatusBadge";
import { getReplay } from "./lib/api";

export default function ReplayPage() {
  const [interactionId, setInteractionId] = useState("");
  const [incidentId, setIncidentId] = useState("");
  const [traceId, setTraceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await getReplay({
        interaction_id: interactionId || undefined,
        incident_id: incidentId || undefined,
        trace_id: traceId || undefined,
      });
      setData(res);
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setLoading(false);
    }
  }

  const drift = (data?.drift || {}) as Record<string, unknown>;

  return (
    <PageShell title="Forensic Replay" subtitle="Replay historical interactions/incidents against current governance logic">
      <Card className="enchanted-card">
        <form onSubmit={onSearch} className="grid gap-3 md:grid-cols-4">
          <input className="carbon-field" placeholder="interaction id" value={interactionId} onChange={(e) => setInteractionId(e.target.value)} />
          <input className="carbon-field" placeholder="incident id" value={incidentId} onChange={(e) => setIncidentId(e.target.value)} />
          <input className="carbon-field" placeholder="trace id (optional)" value={traceId} onChange={(e) => setTraceId(e.target.value)} />
          <button className="rounded-lg bg-hcl-blue px-4 py-2 text-sm font-medium text-white" type="submit">Replay</button>
        </form>
      </Card>
      {loading ? <LoadingState message="Running replay..." /> : null}
      {error ? <ErrorState message={error} /> : null}
      {!loading && !error && !data ? <EmptyState message="Search by interaction or incident id to compare original vs replay." /> : null}
      {data ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="enchanted-card">
            <h3 className="mb-2 text-base font-semibold">Original</h3>
            <pre className="max-h-[28rem] overflow-auto rounded bg-slate-50 p-3 text-xs dark:bg-slate-900">
              {JSON.stringify(data.original || {}, null, 2)}
            </pre>
          </Card>
          <Card className="enchanted-card">
            <h3 className="mb-2 text-base font-semibold">Replay</h3>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm">Drift:</span>
              <StatusBadge status={String(drift.driftClass || "UNCHANGED")} />
            </div>
            <pre className="max-h-[28rem] overflow-auto rounded bg-slate-50 p-3 text-xs dark:bg-slate-900">
              {JSON.stringify(data.replay || {}, null, 2)}
            </pre>
          </Card>
        </div>
      ) : null}
    </PageShell>
  );
}
