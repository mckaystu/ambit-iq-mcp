import { Card, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@tremor/react";
import { AlertTriangle, BadgeCheck, Database, Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import EmptyState from "./components/EmptyState";
import ErrorState from "./components/ErrorState";
import LoadingState from "./components/LoadingState";
import MetricCard from "./components/MetricCard";
import PageShell from "./components/PageShell";
import StatusBadge from "./components/StatusBadge";
import {
  assessModelRisk,
  exportData,
  getCurrentUser,
  getModelGovernance,
  type ModelGovernanceSummaryResponse,
} from "./lib/api";

function asArray(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}

export default function ModelGovernancePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ModelGovernanceSummaryResponse>({});
  const [assessment, setAssessment] = useState<Record<string, unknown> | null>(null);
  const [assessError, setAssessError] = useState<string | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({
    provider: "",
    modelName: "",
    modelVersion: "",
    hostingType: "",
    jurisdiction: "",
    dataClassification: "",
    trainingUsageAllowed: false,
    promptRetentionPolicy: "",
  });

  useEffect(() => {
    getCurrentUser()
      .then((r) => setCanExport(r.user.permissions.includes("*") || r.user.permissions.includes("export.reports")))
      .catch(() => setCanExport(false));
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getModelGovernance()
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
  }, []);

  const rows = asArray(data.summary);
  const summary = useMemo(() => {
    const total = rows.reduce((acc, r) => acc + Number(r.usage_count || 0), 0);
    const external = rows.filter((r) => String(r.hosting_type || "").toLowerCase().includes("external") || String(r.hosting_type || "").toLowerCase().includes("saas")).length;
    const unknownRetention = rows.filter((r) => !r.prompt_retention_policy && !r.response_retention_policy).length;
    const jurisdictionMismatch = rows.filter((r) => String(r.jurisdiction || "").toLowerCase().includes("unknown")).length;
    const highRisk = rows.filter((r) => String(r.risk || "").toLowerCase().includes("high")).length;
    return { total, highRisk, external, unknownRetention, jurisdictionMismatch };
  }, [rows]);

  async function onAssessSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAssessing(true);
    setAssessment(null);
    setAssessError(null);
    try {
      const res = await assessModelRisk({ model: form });
      setAssessment(res);
    } catch (err) {
      setAssessError(String((err as Error)?.message || err));
    } finally {
      setAssessing(false);
    }
  }

  return (
    <PageShell
      title="Model Governance"
      subtitle="Track model usage, jurisdiction, retention, and training exposure risk"
    >
      {canExport ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={async () => {
              const out = await exportData({ format: "csv", type: "model-governance" });
              setToast(`Export generated (${String(out.format || "csv")})`);
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
          >
            Export Governance Data
          </button>
        </div>
      ) : null}
      {toast ? <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm">{toast}</div> : null}
      {loading ? <LoadingState message="Loading model governance data..." /> : null}
      {error ? <ErrorState message={error} /> : null}

      {!loading && !error ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Total model usage events" value={summary.total} icon={<Database className="h-5 w-5" />} />
            <MetricCard label="High-risk model usage" value={summary.highRisk} icon={<AlertTriangle className="h-5 w-5" />} />
            <MetricCard label="External/SaaS model usage" value={summary.external} icon={<Shield className="h-5 w-5" />} />
            <MetricCard label="Unknown retention policies" value={summary.unknownRetention} icon={<BadgeCheck className="h-5 w-5" />} />
            <MetricCard label="Jurisdiction mismatches" value={summary.jurisdictionMismatch} icon={<AlertTriangle className="h-5 w-5" />} />
          </div>

          <Card className="enchanted-card">
            <h3 className="mb-3 text-base font-semibold">Model usage table</h3>
            {!rows.length ? (
              <EmptyState message="No model governance usage rows returned by API." />
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Provider</TableHeaderCell>
                    <TableHeaderCell>Model</TableHeaderCell>
                    <TableHeaderCell>Hosting</TableHeaderCell>
                    <TableHeaderCell>Jurisdiction</TableHeaderCell>
                    <TableHeaderCell>Data Classification</TableHeaderCell>
                    <TableHeaderCell>Training Usage</TableHeaderCell>
                    <TableHeaderCell>Risk</TableHeaderCell>
                    <TableHeaderCell>Last Seen</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row, idx) => (
                    <TableRow key={`${row.provider}-${row.model_name}-${idx}`}>
                      <TableCell>{String(row.provider || "unknown")}</TableCell>
                      <TableCell>{String(row.model_name || "unknown")}</TableCell>
                      <TableCell>{String(row.hosting_type || "unknown")}</TableCell>
                      <TableCell>{String(row.jurisdiction || "unknown")}</TableCell>
                      <TableCell>{String(row.data_classification || "unknown")}</TableCell>
                      <TableCell>{typeof row.training_usage_allowed === "boolean" ? String(row.training_usage_allowed) : "unknown"}</TableCell>
                      <TableCell>
                        <StatusBadge status={String(row.risk || "unknown")} />
                      </TableCell>
                      <TableCell>{String(row.last_seen || "n/a")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          <Card className="enchanted-card">
            <h3 className="mb-3 text-base font-semibold">Risk assessor</h3>
            <form onSubmit={onAssessSubmit} className="grid gap-3 md:grid-cols-2">
              {[
                { key: "provider", label: "Provider" },
                { key: "modelName", label: "Model Name" },
                { key: "modelVersion", label: "Model Version" },
                { key: "hostingType", label: "Hosting Type" },
                { key: "jurisdiction", label: "Jurisdiction" },
                { key: "dataClassification", label: "Data Classification" },
                { key: "promptRetentionPolicy", label: "Prompt Retention Policy" },
              ].map((field) => (
                <label key={field.key} className="text-sm">
                  <span className="mb-1 block">{field.label}</span>
                  <input
                    value={String(form[field.key as keyof typeof form] || "")}
                    onChange={(e) => setForm((cur) => ({ ...cur, [field.key]: e.target.value }))}
                    className="carbon-field"
                  />
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.trainingUsageAllowed}
                  onChange={(e) => setForm((cur) => ({ ...cur, trainingUsageAllowed: e.target.checked }))}
                />
                trainingUsageAllowed
              </label>
              <div className="md:col-span-2">
                <button type="submit" disabled={assessing} className="rounded-lg bg-hcl-blue px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                  {assessing ? "Assessing..." : "Assess Risk"}
                </button>
              </div>
            </form>

            {assessError ? <div className="mt-4"><ErrorState message={assessError} /></div> : null}
            {assessment ? (
              <div className="mt-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <p className="text-sm">
                  <strong>Risk level:</strong>{" "}
                  {String((assessment.risk as Record<string, unknown> | undefined)?.level || "unknown")}
                </p>
                <p className="mt-2 text-sm">
                  <strong>Rationale:</strong>{" "}
                  {Array.isArray((assessment.risk as Record<string, unknown> | undefined)?.rationale)
                    ? ((assessment.risk as Record<string, unknown>).rationale as unknown[]).map(String).join("; ")
                    : "n/a"}
                </p>
                <p className="mt-2 text-sm">
                  <strong>Recommended action:</strong>{" "}
                  {String(assessment.recommended_action || "warn")}
                </p>
              </div>
            ) : null}
          </Card>
        </>
      ) : null}
    </PageShell>
  );
}
