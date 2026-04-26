import { GlobalLiveIntelligenceBriefing } from "@/components/global-live-intelligence-briefing";
import { HclSignalsNav } from "@/components/hcl-signals-nav";
import UtilizationCharts from "@/components/utilization-charts";
import UtilizationInspiration from "@/components/utilization-inspiration";
import { loadAndProcessCsvDataset, loadServicesSignalsWorkspaceSeed } from "@/lib/dataProcessor";
import ServicesSignalsAppWorkspace from "@/services-signals/app-workspace";

export const dynamic = "force-dynamic";

function formatScopeDate(value: string | null): string {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "n/a";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

export default async function UtilizationPage() {
  const [dataset, workspaceSeed] = await Promise.all([loadAndProcessCsvDataset(), loadServicesSignalsWorkspaceSeed()]);
  const products = dataset.utilization.products;
  const managers = dataset.utilization.managers.slice(0, 12);
  const hasUtilizationData = Boolean(
    dataset.utilization.sourceFiles.timesheet && dataset.utilization.sourceFiles.resource
  );

  return (
    <main className="hcl-enhanced min-h-screen text-slate-200">
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-gradient-to-r from-[#002952] via-[#003a70] to-[#002952] text-white shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md ring-1 ring-white/[0.06]">
        <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-100">HCLSoftware</p>
            <h1 className="text-xl font-semibold">Xperience Services Signals Dashboard</h1>
            <p className="text-[11px] text-blue-100/90">Utilization overview by product and manager</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 lg:gap-3">
            <p className="text-xs text-blue-100">
              Source: <span className="font-semibold">{dataset.sourceFile}</span>
            </p>
            <p className="text-xs text-blue-100">
              Utilization:{" "}
              <span className="font-semibold">
                {dataset.utilization.sourceFiles.timesheet ?? "n/a"}
              </span>{" "}
              /{" "}
              <span className="font-semibold">
                {dataset.utilization.sourceFiles.resource ?? "n/a"}
              </span>
            </p>
            <HclSignalsNav active="utilization" />
          </div>
        </div>
      </header>

      <GlobalLiveIntelligenceBriefing />

      <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-4 px-4 py-4">
        <section className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm">
          <span className="font-medium text-slate-500">Reports</span>
          <span className="mx-1 text-slate-400">/</span>
          <span className="font-semibold text-slate-800">Utilization</span>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600 shadow-sm">
          Timesheet file:{" "}
          <span className="font-semibold text-slate-800">
            {dataset.utilization.sourceFiles.timesheet ?? "No timesheet file found"}
          </span>
          {"  "} | {"  "}
          Resource file:{" "}
          <span className="font-semibold text-slate-800">
            {dataset.utilization.sourceFiles.resource ?? "No resource file found"}
          </span>
          {"  "} | {"  "}
          Period used:{" "}
          <span className="font-semibold text-slate-800">
            {formatScopeDate(dataset.utilization.scope.periodStart)} - {formatScopeDate(dataset.utilization.scope.periodEnd)}
          </span>
          {"  "} | {"  "}
          Posted+CSBIL rows:{" "}
          <span className="font-semibold text-slate-800">{dataset.utilization.scope.postedCsbilRows}</span>
          {"  "} | {"  "}
          Resources in scope:{" "}
          <span className="font-semibold text-slate-800">{dataset.utilization.scope.distinctResources}</span>
        </section>

        {!hasUtilizationData ? (
          <section className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
            Utilization data is not fully available yet. Upload both a timesheet file and a resource master file to populate utilization KPIs and charts.
          </section>
        ) : null}

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Utilization KPI by Product</h2>
          <div className="grid gap-3 md:grid-cols-5">
            {products.map((item) => (
              <div key={item.product} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">{item.product}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{item.utilizationPct.toFixed(1)}%</p>
                <p className="text-[11px] text-slate-500">
                  {item.postedHours.toFixed(0)}h / {item.availableHours.toFixed(0)}h
                </p>
                <p className="text-[11px] text-slate-500">Headcount: {item.headcount}</p>
              </div>
            ))}
          </div>
        </section>

        <UtilizationInspiration
          overallUtilizationPct={dataset.utilization.overallUtilizationPct}
          totalPostedHours={dataset.utilization.totalPostedHours}
          totalAvailableHours={dataset.utilization.totalAvailableHours}
          workByProduct={dataset.utilization.workByProduct}
          topResources={dataset.utilization.topResources}
          monthlyWorkVsCapacity={dataset.utilization.monthlyWorkVsCapacity}
          monthlyProductKeys={dataset.utilization.monthlyProductKeys}
        />

        <UtilizationCharts
          byGeo={dataset.utilization.byGeo}
          byPractice={dataset.utilization.byPractice}
          trend={dataset.utilization.trend}
        />

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Manager Utilization (Top 12)</h2>
          <div className="overflow-auto rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="p-2 text-left">Manager</th>
                  <th className="p-2 text-right">Utilization</th>
                  <th className="p-2 text-right">Posted Hours</th>
                  <th className="p-2 text-right">Available Hours</th>
                  <th className="p-2 text-right">Headcount</th>
                </tr>
              </thead>
              <tbody>
                {managers.map((row) => (
                  <tr key={row.manager} className="border-t border-white/10 transition-colors hover:bg-white/5">
                    <td className="p-2">{row.manager}</td>
                    <td className="p-2 text-right font-semibold">{row.utilizationPct.toFixed(1)}%</td>
                    <td className="p-2 text-right">{row.postedHours.toFixed(0)}</td>
                    <td className="p-2 text-right">{row.availableHours.toFixed(0)}</td>
                    <td className="p-2 text-right">{row.headcount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <ServicesSignalsAppWorkspace
            key={[
              dataset.utilization.sourceFiles.timesheet ?? "",
              dataset.utilization.sourceFiles.resource ?? "",
              String(dataset.utilization.scope.postedCsbilRows),
              String(dataset.utilization.scope.distinctResources),
            ].join("|")}
            initialTimesheetRows={workspaceSeed.timesheetRows}
            initialResourceRows={workspaceSeed.resourceRows}
          />
        </section>
      </div>
    </main>
  );
}
