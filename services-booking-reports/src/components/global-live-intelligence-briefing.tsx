"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";

import { ExecutiveInsightsHeader } from "@/services-signals/components/ExecutiveInsightsHeader";
import type { DataAuditReport } from "@/services-signals/lib/data-audit";
import type { UtilizationRecord } from "@/services-signals/lib/utils";

type ApiPayload = {
  utilizationRows: UtilizationRecord[];
  dataAudit: DataAuditReport | null;
};

export function GlobalLiveIntelligenceBriefing() {
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/live-intelligence-context", { cache: "no-store" });
      const body = (await res.json()) as ApiPayload;
      setPayload({
        utilizationRows: Array.isArray(body.utilizationRows) ? body.utilizationRows : [],
        dataAudit: body.dataAudit ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load briefing context.");
      setPayload({ utilizationRows: [], dataAudit: null });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="border-b border-slate-800/90 bg-[#070b14] text-slate-100">
      <div className="mx-auto w-full max-w-[1720px] px-4 py-4 sm:px-6">
        {error ? <p className="mb-2 text-xs text-amber-300/90">{error}</p> : null}
        <ExecutiveInsightsHeader
          filteredRows={payload?.utilizationRows ?? []}
          dataAudit={payload?.dataAudit ?? null}
          subtitle="DS / MX / DX lanes and GEO utilization (HCL GEO OBS) from the latest server timesheet and resource files. Refreshes after uploads or when you click Refresh insights."
          dataHealthPlacement="global"
          onDataReload={load}
        />
      </div>
    </div>
  );
}
