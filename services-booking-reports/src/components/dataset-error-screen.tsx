import { LayoutDashboard } from "lucide-react";

import { HclSignalsNav, type HclSignalsActiveNav } from "@/components/hcl-signals-nav";

const headerShell =
  "sticky top-0 z-30 border-b border-slate-800/90 bg-gradient-to-r from-[#002952] via-[#003a70] to-[#002952] text-white shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md ring-1 ring-white/[0.06]";

type DatasetErrorScreenProps = {
  message: string | null;
  /** Extra guidance under the main alert (e.g. where to place CSV files). */
  hint?: string;
  /** Breadcrumb leaf label under Reports /. */
  breadcrumb?: string;
  /** Which nav tab is active while on this error state. */
  navActive?: HclSignalsActiveNav;
};

/**
 * Branded full-page state when booking / pipeline data could not be loaded (matches other app shells).
 */
export function DatasetErrorScreen({
  message,
  hint,
  breadcrumb = "Data setup",
  navActive = "dashboard",
}: DatasetErrorScreenProps) {
  return (
    <main className="hcl-enhanced min-h-screen text-slate-200">
      <header className={headerShell}>
        <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="shrink-0 rounded bg-white/15 p-2 ring-1 ring-white/25">
              <LayoutDashboard className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-100">HCLSoftware</p>
              <h1 className="text-xl font-semibold leading-tight">Xperience Services Signals Dashboard</h1>
              <p className="text-[11px] text-blue-100/90">Add pipeline data to continue</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:gap-3">
            <HclSignalsNav active={navActive} />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-4 px-4 py-4">
        <section className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm">
          <span className="font-medium text-slate-500">Reports</span>
          <span className="mx-1 text-slate-400">/</span>
          <span className="font-semibold text-slate-800">{breadcrumb}</span>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800">Unable to load booking report data</h2>
          <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            Check that a valid opportunities file exists under <span className="font-mono text-rose-900">/data</span> and try again.
          </p>
          {hint ? <p className="mt-3 text-sm text-slate-400">{hint}</p> : null}
          {message ? (
            <pre className="mt-4 max-h-64 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
              {message}
            </pre>
          ) : null}
        </section>
      </div>
    </main>
  );
}
