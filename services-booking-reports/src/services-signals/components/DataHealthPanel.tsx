import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";

import type { DataHealthAlert, DataHealthReport } from "../lib/data-health-engine";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

type DataHealthPanelProps = {
  report: DataHealthReport;
  onClose?: () => void;
};

function IntegrityRing({ score }: { score: number }) {
  const radius = 52;
  const stroke = 8;
  const normalizedRadius = radius - stroke / 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const pct = Math.max(0, Math.min(100, score));
  const strokeDashoffset = circumference - (pct / 100) * circumference;
  const color =
    pct >= 85 ? "#34d399" : pct >= 60 ? "#fbbf24" : pct >= 40 ? "#fb923c" : "#f87171";

  return (
    <div className="relative mx-auto flex h-36 w-36 items-center justify-center">
      <svg height={radius * 2} width={radius * 2} className="-rotate-90 transform">
        <circle
          stroke="#334155"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <circle
          stroke={color}
          fill="transparent"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          style={{ strokeDashoffset, transition: "stroke-dashoffset 0.4s ease" }}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-2xl font-bold tabular-nums text-slate-50">{Math.round(score)}</span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Integrity</span>
      </div>
    </div>
  );
}

function AlertBlock({ title, alerts, variant }: { title: string; alerts: DataHealthAlert[]; variant: "critical" | "warning" }) {
  if (alerts.length === 0) {
    return null;
  }
  const border = variant === "critical" ? "border-red-500/40 bg-red-950/25" : "border-amber-500/35 bg-amber-950/20";
  const titleColor = variant === "critical" ? "text-red-200" : "text-amber-100";
  const Icon = variant === "critical" ? ShieldAlert : AlertTriangle;

  return (
    <div className={cn("rounded-xl border p-4", border)}>
      <div className="mb-3 flex items-center gap-2">
        <Icon className={cn("h-4 w-4", variant === "critical" ? "text-red-400" : "text-amber-400")} />
        <h3 className={cn("text-sm font-semibold", titleColor)}>{title}</h3>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{alerts.length}</span>
      </div>
      <ul className="space-y-4">
        {alerts.map((a) => (
          <li key={a.id} className="border-t border-slate-700/60 pt-3 first:border-t-0 first:pt-0">
            <p className="text-sm font-medium text-slate-100">{a.title}</p>
            <p className="mt-1 text-xs text-slate-400">{a.detail}</p>
            <p className="mt-2 rounded-md bg-slate-950/60 p-2 text-xs leading-relaxed text-cyan-100/90">
              <span className="font-semibold text-cyan-300/90">Suggested fix: </span>
              {a.fixSuggestion}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DataHealthPanel({ report, onClose }: DataHealthPanelProps) {
  const awaitingUpload = !report.hasInputData;

  return (
    <div className="flex h-full w-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
        <div className="min-w-0 flex-1">
          <h2 id="data-health-title" className="text-lg font-semibold tracking-tight text-slate-50">
            Self-Audit &amp; Data Health
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Automated checks on timesheet vs resource master consistency, plus workspace signals (utilization rollups, filtered population, project
            revenue presence). Score starts at 100 and subtracts <span className="text-slate-300">5</span> per critical finding and{" "}
            <span className="text-slate-300">2</span> per warning (floor 0).
          </p>
        </div>
        {onClose && (
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </div>

      <Card className="w-full border-white/10 bg-slate-950/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-200">Data integrity score</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3 pb-6">
          <IntegrityRing score={report.score} />
          <div className="flex flex-wrap justify-center gap-3 text-center text-xs text-slate-400">
            <span>
              Critical: <span className="font-mono text-red-300">{report.criticalCount}</span>
            </span>
            <span>
              Warnings: <span className="font-mono text-amber-200">{report.warningCount}</span>
            </span>
            {report.datasetEndLabel && (
              <span className="w-full text-[11px] text-slate-500">
                Latest Posted timesheet start in file: <span className="text-slate-300">{report.datasetEndLabel}</span>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {awaitingUpload && (
        <div className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-900/40 p-3 text-sm text-slate-400">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p>Upload timesheet and resource master data to run integrity checks.</p>
        </div>
      )}

      {report.hasInputData && !report.hasAnyIssues && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-3 text-sm text-emerald-100/90">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p>No automated integrity flags for the current uploads.</p>
        </div>
      )}

      <AlertBlock title="Critical errors" alerts={report.criticalAlerts} variant="critical" />
      <AlertBlock title="Warnings" alerts={report.warningAlerts} variant="warning" />

      <p className="text-[11px] leading-relaxed text-slate-500">
        Core checks: orphaned SAP IDs, practice mismatch (Posted vs master), timesheet start before hire, weekly Posted overload, inactive master with
        Posted hours, active master with no Posted time in the extract. Extended: empty utilization pipeline with CSBIL data, missing project finance for
        P&amp;L, filters excluding all rows.
      </p>
    </div>
  );
}
