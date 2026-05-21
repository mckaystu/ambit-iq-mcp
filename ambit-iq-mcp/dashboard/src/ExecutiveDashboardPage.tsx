import { Card, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@tremor/react";
import { Activity, CheckCircle2, ShieldAlert, Users, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import EmptyState from "./components/EmptyState";
import ErrorState from "./components/ErrorState";
import LoadingState from "./components/LoadingState";
import MetricCard from "./components/MetricCard";
import PageShell from "./components/PageShell";
import { exportData, getCurrentUser, getExecutiveDashboard, type ExecutiveDashboardResponse } from "./lib/api";

type Preset = "7d" | "30d" | "90d";

function toDateRange(preset: Preset) {
  const now = new Date();
  const start = new Date();
  const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
  start.setDate(start.getDate() - days);
  return { date_from: start.toISOString().slice(0, 10), date_to: now.toISOString().slice(0, 10) };
}

function asArray(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function ExecutiveDashboardPage() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExecutiveDashboardResponse>({});
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
    getExecutiveDashboard(toDateRange(preset))
      .then((res) => {
        if (!active) return;
        setData(res || {});
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
  }, [preset]);

  const aiUsage = asArray(data.ai_usage_by_team);
  const blockedRisky = asArray(data.blocked_risky_commits);
  const trend = asArray(data.compliance_score_trend);
  const topRepos = asArray(data.top_violating_repos);
  const geo = asArray(data.model_usage_by_geography);
  const readiness = (data.audit_readiness_score || {}) as Record<string, unknown>;

  const summary = useMemo(() => {
    const interactions = aiUsage.reduce((acc, row) => acc + num(row.interactions), 0);
    const blocked = blockedRisky.reduce((acc, row) => acc + num(row.blocked), 0);
    const risky = blockedRisky.reduce((acc, row) => acc + num(row.risky), 0);
    const compliance = trend.length ? num(trend[trend.length - 1]?.score ?? 0) : 0;
    const highRiskModels = geo.reduce((acc, row) => acc + (String(row.geography || "").toLowerCase().includes("high") ? num(row.count) : 0), 0);
    return {
      readiness: num(readiness.score),
      interactions,
      blocked,
      compliance,
      risky,
      highRiskModels,
    };
  }, [aiUsage, blockedRisky, trend, geo, readiness.score]);

  return (
    <PageShell
      title="Executive Dashboard"
      subtitle="AI-assisted delivery governance, risk, and compliance overview"
    >
      <div className="flex items-center gap-2">
        {(["7d", "30d", "90d"] as Preset[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPreset(p)}
            className={`rounded-lg px-3 py-1.5 text-sm ${preset === p ? "bg-hcl-blue text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}
          >
            Last {p.replace("d", "")} days
          </button>
        ))}
        {canExport ? (
          <button
            type="button"
            onClick={async () => {
              const out = await exportData({ format: "html", type: "executive-board", filters: toDateRange(preset) });
              setToast(`Export generated (${String(out.format || "html")})`);
            }}
            className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
          >
            Export Report
          </button>
        ) : null}
      </div>
      {toast ? <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm">{toast}</div> : null}

      {loading ? <LoadingState message="Loading executive dashboard..." /> : null}
      {error ? <ErrorState message={error} /> : null}
      {!loading && !error ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Audit Readiness Score" value={`${summary.readiness.toFixed(1)}%`} icon={<CheckCircle2 className="h-5 w-5" />} />
            <MetricCard label="AI Interactions" value={summary.interactions} icon={<Users className="h-5 w-5" />} />
            <MetricCard label="Blocked Risky Commits" value={summary.blocked} icon={<ShieldAlert className="h-5 w-5" />} />
            <MetricCard label="Compliance Score" value={`${summary.compliance.toFixed(1)}%`} icon={<Activity className="h-5 w-5" />} />
            <MetricCard label="High Risk Models" value={summary.highRiskModels || summary.risky} icon={<Workflow className="h-5 w-5" />} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="enchanted-card">
              <h3 className="mb-3 text-sm font-semibold">AI usage by team</h3>
              {!aiUsage.length ? (
                <EmptyState message="No team usage data available for this period." />
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={aiUsage}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="team_id" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="interactions" fill="#0f62fe" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card className="enchanted-card">
              <h3 className="mb-3 text-sm font-semibold">Compliance score trend</h3>
              {!trend.length ? (
                <EmptyState message="No compliance trend points found." />
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="score" stroke="#0f62fe" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="enchanted-card">
              <h3 className="mb-3 text-sm font-semibold">Top violating repos</h3>
              {!topRepos.length ? (
                <EmptyState message="No violating repositories found." />
              ) : (
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Repo</TableHeaderCell>
                      <TableHeaderCell>Violations</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {topRepos.slice(0, 10).map((row, idx) => (
                      <TableRow key={`${row.repo}-${idx}`}>
                        <TableCell>{String(row.repo || "unknown")}</TableCell>
                        <TableCell>{num(row.violations)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>

            <Card className="enchanted-card">
              <h3 className="mb-3 text-sm font-semibold">Blocked risky commits</h3>
              {!blockedRisky.length ? (
                <EmptyState message="No blocked/risky commit activity found." />
              ) : (
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Repo</TableHeaderCell>
                      <TableHeaderCell>Blocked</TableHeaderCell>
                      <TableHeaderCell>Risky</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {blockedRisky.slice(0, 10).map((row, idx) => (
                      <TableRow key={`${row.repo}-${idx}`}>
                        <TableCell>{String(row.repo || "unknown")}</TableCell>
                        <TableCell>{num(row.blocked)}</TableCell>
                        <TableCell>{num(row.risky)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>

          <Card className="enchanted-card">
            <h3 className="mb-3 text-sm font-semibold">Model usage by geography</h3>
            {!geo.length ? (
              <EmptyState message="No model geography usage data found." />
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Geography</TableHeaderCell>
                    <TableHeaderCell>Usage Count</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {geo.slice(0, 20).map((row, idx) => (
                    <TableRow key={`${row.geography}-${idx}`}>
                      <TableCell>{String(row.geography || "unknown")}</TableCell>
                      <TableCell>{num(row.count)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      ) : null}
    </PageShell>
  );
}
