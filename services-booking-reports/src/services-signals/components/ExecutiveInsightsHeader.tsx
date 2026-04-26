/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";

import { Button } from "./ui/button";
import {
  aggregateExecutiveSnapshot,
  generateInsights,
  type ExecutiveInsightsNarrative,
} from "../lib/executive-insights";
import type { DataAuditReport } from "../lib/data-audit";
import type { UtilizationRecord } from "../lib/utils";

type ExecutiveInsightsHeaderProps = {
  filteredRows: UtilizationRecord[];
  dataAudit?: DataAuditReport | null;
  /** Override default subtitle (e.g. global briefing vs workspace filters). */
  subtitle?: string;
  /** Where the header is shown — adjusts data-integrity footer copy. */
  dataHealthPlacement?: "global" | "workspace";
  /** When set, "Refresh insights" refetches server context before regenerating the narrative. */
  onDataReload?: () => void | Promise<void>;
};

const DEFAULT_SUBTITLE =
  "DS / MX / DX lanes and GEO utilization (HCL GEO OBS) for the current filters. Refreshes when uploads or filters change.";

export function ExecutiveInsightsHeader({
  filteredRows,
  dataAudit,
  subtitle = DEFAULT_SUBTITLE,
  dataHealthPlacement = "workspace",
  onDataReload,
}: ExecutiveInsightsHeaderProps) {
  const snapshot = useMemo(() => aggregateExecutiveSnapshot(filteredRows), [filteredRows]);
  const [narrative, setNarrative] = useState<ExecutiveInsightsNarrative | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async () => {
    if (filteredRows.length === 0) {
      setNarrative(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await generateInsights(snapshot);
      setNarrative(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load insights.");
      setNarrative(null);
    } finally {
      setLoading(false);
    }
  }, [filteredRows.length, snapshot]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const onRefresh = async () => {
    await onDataReload?.();
    setRefreshToken((n) => n + 1);
  };

  const hasData = filteredRows.length > 0;

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/50 p-6 shadow-[0_8px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl ring-1 ring-white/5"
      aria-busy={loading}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-500/10 via-transparent to-cyan-500/5" />
      <div className="relative flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-400/30">
              <Sparkles className="h-5 w-5 text-amber-300" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-slate-50">Live intelligence briefing</h2>
              <p className="text-xs text-slate-400">{subtitle}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 border-white/15 bg-white/5 text-slate-100 hover:bg-white/10"
            onClick={() => void onRefresh()}
            disabled={(!hasData && !onDataReload) || loading}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh insights
          </Button>
        </div>

        {!hasData && (
          <p className="text-sm text-slate-400">
            Upload timesheet and resource master data to generate an executive narrative. CSBIL + Posted rows drive utilization in this view.
          </p>
        )}

        {hasData && loading && !narrative && (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
            Generating insights…
          </p>
        )}

        {error && <p className="text-sm text-red-300">{error}</p>}

        {narrative && hasData && (
          <div className="space-y-3 text-sm leading-relaxed text-slate-200">
            <p className="text-[15px] text-slate-100">{narrative.summary}</p>
            <ul className="list-inside list-disc space-y-1.5 text-slate-300 marker:text-amber-400/90">
              {narrative.bullets.map((item, index) => (
                <li key={`${index}-${item.slice(0, 48)}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {dataAudit?.hasInputData ? (
          <p
            className={`text-xs leading-relaxed text-slate-400 ${narrative && hasData ? "border-t border-white/10 pt-3" : ""}`}
          >
            <span className="font-medium text-slate-300">Data integrity audit:</span> confidence score{" "}
            <span className="font-mono text-amber-200/90">{dataAudit.score}%</span>
            {dataAudit.hasAnyIssues ? (
              <>
                {" "}
                — <span className="text-red-300/90">{dataAudit.criticalCount}</span> critical and{" "}
                <span className="text-amber-200/90">{dataAudit.warningCount}</span> warning flag(s).{" "}
                {dataHealthPlacement === "global" ? (
                  <>
                    Review Self-Audit &amp; Data Health in the Utilization workspace; use the Compliance tab for late/missing week analysis and
                    verification exports.
                  </>
                ) : (
                  <>
                    Review Self-Audit &amp; Data Health at the top of the workspace; use the Compliance tab for late/missing week analysis and verification
                    exports.
                  </>
                )}
              </>
            ) : (
              <> — no automated integrity flags on the current uploads.</>
            )}
          </p>
        ) : null}
      </div>
    </section>
  );
}
