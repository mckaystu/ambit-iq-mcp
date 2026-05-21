import { Moon, Sun } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { PRODUCT_NAME } from "../brand";
import HclBrandStrip from "./HclBrandStrip";
import GovernanceTabs from "./GovernanceTabs";

export default function PageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return (
    <div className="min-h-screen bg-carbon-bg dark:bg-slate-950">
      <HclBrandStrip />
      <header className="sticky top-0 z-20 border-b border-carbon-border bg-carbon-layer/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-hcl-blue">{PRODUCT_NAME}</p>
            <h1 className="text-2xl font-semibold tracking-tight text-carbon-text dark:text-slate-50">{title}</h1>
            <p className="mt-1 text-sm text-carbon-text-secondary dark:text-slate-400">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => setDarkMode((v) => !v)}
            className="rounded-lg border border-carbon-border p-2 hover:bg-carbon-layer-01 dark:border-slate-700 dark:hover:bg-slate-800"
            aria-label="Toggle dark mode"
          >
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
        <div className="mx-auto w-full max-w-7xl px-6 pb-4">
          <GovernanceTabs />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
