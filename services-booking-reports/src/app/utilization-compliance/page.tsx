import { HclSignalsNav } from "@/components/hcl-signals-nav";
import { UtilizationComplianceClient } from "@/components/utilization-compliance-client";
import { loadAndProcessCsvDataset, loadServicesSignalsWorkspaceSeed } from "@/lib/dataProcessor";

export const dynamic = "force-dynamic";

function scopeYmd(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export default async function UtilizationCompliancePage() {
  const [dataset, workspaceSeed] = await Promise.all([loadAndProcessCsvDataset(), loadServicesSignalsWorkspaceSeed()]);
  const defaultStart = scopeYmd(dataset.utilization.scope.periodStart);
  const defaultEnd = scopeYmd(dataset.utilization.scope.periodEnd);

  return (
    <main className="hcl-enhanced min-h-screen text-slate-200">
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-gradient-to-r from-[#002952] via-[#003a70] to-[#002952] text-white shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md ring-1 ring-white/[0.06]">
        <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-100">HCLSoftware</p>
            <h1 className="text-xl font-semibold">Xperience Services Signals Dashboard</h1>
            <p className="text-[11px] text-blue-100/90">Utilization compliance — late timesheet submission heatmap</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 lg:gap-3">
            <p className="text-xs text-blue-100">
              Timesheet:{" "}
              <span className="font-semibold">{dataset.utilization.sourceFiles.timesheet ?? "n/a"}</span>
            </p>
            <HclSignalsNav active="utilizationCompliance" />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-4 px-4 py-4">
        <section className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm">
          <span className="font-medium text-slate-500">Reports</span>
          <span className="mx-1 text-slate-400">/</span>
          <span className="font-semibold text-slate-800">Utilization Compliance</span>
        </section>

        <p className="text-sm text-slate-600">
          Posted CSBIL timesheet lines only. Cells show whole calendar days from <strong className="font-medium text-slate-800">Timesheet Finish</strong>{" "}
          to <strong className="font-medium text-slate-800">Timesheet Posted</strong> (0 = on time or early). Data matches the ServicesSignals
          compliance heatmap logic.
        </p>

        <UtilizationComplianceClient
          key={[dataset.utilization.sourceFiles.timesheet ?? "", String(workspaceSeed.timesheetRows.length)].join("|")}
          timesheetRows={workspaceSeed.timesheetRows}
          defaultStart={defaultStart}
          defaultEnd={defaultEnd}
        />
      </div>
    </main>
  );
}
