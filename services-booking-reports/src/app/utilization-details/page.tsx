import { HclSignalsNav } from "@/components/hcl-signals-nav";
import { loadAndProcessCsvDataset } from "@/lib/dataProcessor";

export const dynamic = "force-dynamic";

export default async function UtilizationDetailsPage() {
  const dataset = await loadAndProcessCsvDataset();
  const resources = [...dataset.utilization.resources].sort(
    (a, b) => b.utilizationPct - a.utilizationPct
  );

  return (
    <main className="hcl-enhanced min-h-screen text-slate-200">
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-gradient-to-r from-[#002952] via-[#003a70] to-[#002952] text-white shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md ring-1 ring-white/[0.06]">
        <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-100">HCLSoftware</p>
            <h1 className="text-xl font-semibold">Xperience Services Signals Dashboard</h1>
            <p className="text-[11px] text-blue-100/90">Resource-level utilization details</p>
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
            <HclSignalsNav active="utilizationDetails" />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-4 px-4 py-4">
        <section className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm">
          <span className="font-medium text-slate-500">Reports</span>
          <span className="mx-1 text-slate-400">/</span>
          <span className="font-semibold text-slate-800">Utilization Details</span>
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
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Resource Utilization</h2>
          <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="p-2 text-left">Resource</th>
                  <th className="p-2 text-left">Manager</th>
                  <th className="p-2 text-left">Product</th>
                  <th className="p-2 text-left">Practice</th>
                  <th className="p-2 text-left">GEO</th>
                  <th className="p-2 text-right">Utilization</th>
                  <th className="p-2 text-right">Posted Hours</th>
                  <th className="p-2 text-right">Available Hours</th>
                </tr>
              </thead>
              <tbody>
                {resources.map((row) => (
                  <tr key={`${row.resourceId}-${row.resourceName}`} className="border-t border-white/10 transition-colors hover:bg-white/5">
                    <td className="p-2">{row.resourceName}</td>
                    <td className="p-2">{row.manager}</td>
                    <td className="p-2">{row.product}</td>
                    <td className="p-2">{row.practice}</td>
                    <td className="p-2">{row.geo}</td>
                    <td className="p-2 text-right font-semibold">{row.utilizationPct.toFixed(1)}%</td>
                    <td className="p-2 text-right">{row.postedHours.toFixed(1)}</td>
                    <td className="p-2 text-right">{row.availableHours.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
