import {
  BrainCircuit,
  FileText,
  FlaskConical,
  LayoutGrid,
  Scale,
  ShieldCheck,
  Siren,
  Bot,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getCurrentUser, type CurrentUser } from "../lib/api";

function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const TABS = [
  { to: "/?view=metrics", label: "Metrics", icon: LayoutGrid },
  { to: "/dashboard/executive", label: "Executive", icon: ShieldCheck, permission: "view.executive" },
  { to: "/dashboard/model-governance", label: "Model Governance", icon: Scale, permission: "view.governance" },
  { to: "/dashboard/incidents", label: "Incidents", icon: Siren, permission: "view.incidents" },
  { to: "/dashboard/agent-interactions", label: "Agent Interactions", icon: Bot, permission: "view.interactions" },
  { to: "/dashboard/replay", label: "Replay", icon: BrainCircuit, permission: "view.interactions" },
  { to: "/?view=rules", label: "Policy Rules", icon: Scale },
  { to: "/dashboard/policies", label: "Policy IDE", icon: FlaskConical, permission: "manage.policies" },
  { to: "/dashboard/signal-intelligence", label: "Signal Intelligence", icon: BrainCircuit },
  { to: "/dashboard/audit-reports", label: "Audit Reports", icon: FileText },
];

export default function GovernanceTabs() {
  const location = useLocation();
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    getCurrentUser()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null));
  }, []);

  const can = (perm?: string) => {
    if (!perm) return true;
    if (!user) return true;
    if (user.permissions.includes("*")) return true;
    return user.permissions.includes(perm);
  };

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
      {TABS.filter((tab) => can(tab.permission)).map((tab) => {
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
      {user ? (
        <div className="ml-auto flex items-center gap-2 rounded-lg border border-carbon-border px-3 py-1.5 text-xs dark:border-slate-700">
          <span className="font-medium">{user.email}</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 dark:bg-slate-800">{user.roles[0] || "user"}</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 dark:bg-slate-800">{user.tenant_id || "global"}</span>
        </div>
      ) : null}
    </nav>
  );
}
