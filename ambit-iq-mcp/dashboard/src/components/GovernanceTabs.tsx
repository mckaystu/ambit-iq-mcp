import { BrainCircuit, FileText, FlaskConical, LayoutGrid, Scale } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const TABS = [
  { to: "/?view=metrics", label: "Metrics", icon: LayoutGrid },
  { to: "/?view=rules", label: "Policy Rules", icon: Scale },
  { to: "/dashboard/policies", label: "Policy IDE", icon: FlaskConical },
  { to: "/dashboard/signal-intelligence", label: "Signal Intelligence", icon: BrainCircuit },
  { to: "/dashboard/audit-reports", label: "Audit Reports", icon: FileText },
];

export default function GovernanceTabs() {
  const location = useLocation();

  function isActive(to: string): boolean {
    const target = new URL(to, "https://agent-gate.local");
    if (target.pathname !== location.pathname) return false;
    const current = new URL(
      `${location.pathname}${location.search || ""}`,
      "https://agent-gate.local",
    );
    const view = target.searchParams.get("view");
    if (!view) return true;
    return (current.searchParams.get("view") || "metrics").toLowerCase() === view.toLowerCase();
  }

  return (
    <nav
      aria-label="Primary governance navigation"
      className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-carbon-border/80 bg-carbon-layer-01/70 p-2 dark:border-slate-700 dark:bg-slate-900/70"
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={
              cls(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
                isActive(tab.to)
                  ? "bg-hcl-blue text-white shadow-sm hover:bg-[#0043ce]"
                  : "text-carbon-text-secondary hover:bg-carbon-layer-02 dark:text-slate-200 dark:hover:bg-slate-800",
              )
            }
          >
            <Icon className="h-4 w-4 opacity-90" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
