import { useEffect, useState } from "react";
import { FlaskConical, Moon, Sun } from "lucide-react";
import { PRODUCT_NAME } from "./brand";
import HclBrandStrip from "./components/HclBrandStrip";
import GovernanceTabs from "./components/GovernanceTabs";
import PolicyManager from "./PolicyManager";

function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Policy IDE at `/dashboard/policies` (OpenAI-backed generation + shadow deploy). */
export default function PoliciesPage() {
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return (
    <div className="min-h-screen bg-carbon-bg dark:bg-slate-950">
      <HclBrandStrip />
      <header className="sticky top-0 z-20 border-b border-carbon-border bg-carbon-layer/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex w-full max-w-[min(96rem,calc(100%-1rem))] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-hcl-blue text-white shadow-sm">
                <FlaskConical className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-hcl-blue">HCL Software · {PRODUCT_NAME}</p>
                <h1 className="truncate text-lg font-semibold tracking-tight text-carbon-text dark:text-white sm:text-xl">Policy IDE</h1>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-widest text-carbon-text-secondary">HCL Software</p>
              <p className="text-lg font-semibold text-hcl-blue">HCLSoftware</p>
            </div>
            <button
              type="button"
              onClick={() => setDarkMode((v) => !v)}
              className={cls(
                "rounded-lg border border-carbon-border p-2 hover:bg-carbon-layer-01 dark:border-slate-700 dark:hover:bg-slate-800",
              )}
              aria-label="Toggle dark mode"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[min(96rem,calc(100%-1rem))] px-4 pb-4 sm:px-6 lg:px-8">
          <GovernanceTabs />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[min(96rem,calc(100%-1rem))] px-4 py-6 sm:px-6 lg:px-8">
        <PolicyManager />
      </main>
    </div>
  );
}
