import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Text, Textarea } from "@tremor/react";
import {
  CirclePlus,
  FileJson2,
  Layers,
  RotateCw,
  Scale,
  Search,
  Shield,
  Sparkles,
  SquarePen,
  X,
} from "lucide-react";
import { PRODUCT_NAME } from "./brand";
import { apiPath } from "./apiBase";
import type { RulesLibraryRow } from "./types";

function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

async function fetchRules(): Promise<{ rules: RulesLibraryRow[]; error?: string }> {
  const res = await fetch(apiPath("/api/rules-library"));
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    return { rules: [], error: msg };
  }
  const data = (await res.json()) as { rules: RulesLibraryRow[] };
  return { rules: Array.isArray(data.rules) ? data.rules : [] };
}

type Draft = {
  rule_id: string;
  rule_name: string;
  domain_id: string;
  industry_id: string;
  compliance_tags_csv: string;
  tenant_id: string;
  is_mandatory: boolean;
  rule_logic_json: string;
};

function rowToDraft(row: RulesLibraryRow | null): Draft {
  if (!row) {
    return {
      rule_id: "",
      rule_name: "",
      domain_id: "quality",
      industry_id: "",
      compliance_tags_csv: "",
      tenant_id: "",
      is_mandatory: false,
      rule_logic_json: JSON.stringify(
        {
          id: "NEW-001",
          pattern: "",
          severity: "MEDIUM",
          action: "Review",
          description: "Describe what this rule detects.",
        },
        null,
        2,
      ),
    };
  }
  return {
    rule_id: row.rule_id,
    rule_name: row.rule_name,
    domain_id: row.domain_id || "quality",
    industry_id: row.industry_id || "",
    compliance_tags_csv: (row.compliance_tags || []).join(", "),
    tenant_id: row.tenant_id || "",
    is_mandatory: row.is_mandatory,
    rule_logic_json: JSON.stringify(row.rule_logic || {}, null, 2),
  };
}

function domainPillClass(domain: string | null): string {
  const d = (domain || "").toLowerCase();
  if (d === "regulatory")
    return "bg-amber-100 text-amber-950 ring-1 ring-amber-200/80 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-800/60";
  if (d === "ux")
    return "bg-violet-100 text-violet-950 ring-1 ring-violet-200/80 dark:bg-violet-950/40 dark:text-violet-100 dark:ring-violet-800/60";
  if (d === "quality")
    return "bg-sky-100 text-sky-950 ring-1 ring-sky-200/80 dark:bg-sky-950/40 dark:text-sky-100 dark:ring-sky-800/60";
  return "bg-slate-100 text-slate-800 ring-1 ring-slate-200/80 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600/60";
}

function KpiTile({
  label,
  value,
  icon: Icon,
  sub,
}: {
  label: string;
  value: string | number;
  icon: typeof Layers;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm dark:border-slate-700/90 dark:bg-slate-900/80">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-white">{value}</p>
          {sub ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p> : null}
        </div>
        <div className="rounded-xl bg-hcl-blue/10 p-2.5 text-hcl-blue dark:bg-hcl-blue/20">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
      </div>
    </div>
  );
}

export default function RulesLibraryPage() {
  const [rules, setRules] = useState<RulesLibraryRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [filter, setFilter] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => rowToDraft(null));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { rules: next, error } = await fetchRules();
    setRules(next);
    if (error) setLoadError(error);
    else setLastLoadedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter((r) => {
      const logicId = String((r.rule_logic as { id?: string })?.id || "").toLowerCase();
      const hay = [
        r.rule_name,
        r.domain_id,
        r.industry_id,
        logicId,
        r.rule_id,
        ...(r.compliance_tags || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rules, filter]);

  const kpis = useMemo(() => {
    const mandatory = rules.filter((r) => r.is_mandatory).length;
    const domains = new Set(rules.map((r) => r.domain_id).filter(Boolean)).size;
    return { mandatory, domains };
  }, [rules]);

  function openCreate() {
    setIsNew(true);
    setDraft(rowToDraft(null));
    setSaveError(null);
    setEditorOpen(true);
  }

  function openEdit(row: RulesLibraryRow) {
    setIsNew(false);
    setDraft(rowToDraft(row));
    setSaveError(null);
    setEditorOpen(true);
  }

  async function save() {
    setSaveError(null);
    let rule_logic: Record<string, unknown>;
    try {
      rule_logic = JSON.parse(draft.rule_logic_json) as Record<string, unknown>;
    } catch {
      setSaveError("rule_logic must be valid JSON.");
      return;
    }
    const compliance_tags = draft.compliance_tags_csv
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const body: Record<string, unknown> = {
      rule_name: draft.rule_name.trim(),
      domain_id: draft.domain_id.trim() || "quality",
      industry_id: draft.industry_id.trim() || null,
      compliance_tags,
      is_mandatory: draft.is_mandatory,
      tenant_id: draft.tenant_id.trim() || null,
      rule_logic,
    };
    if (!isNew) body.rule_id = draft.rule_id;

    setSaving(true);
    try {
      const res = await fetch(apiPath("/api/rules-library"), {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setSaveError(j.error || `Save failed (${res.status})`);
        return;
      }
      setEditorOpen(false);
      await reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-hcl-blue focus:ring-2 focus:ring-hcl-blue/25 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-hcl-blue";

  return (
    <div className="space-y-6 pb-10">
      {/* HCL hero */}
      <section className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white via-slate-50/80 to-slate-100/60 shadow-sm dark:border-slate-700/90 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-hcl-blue to-[#4589ff]" aria-hidden />
        <div className="relative flex flex-col gap-6 px-5 py-7 pl-6 sm:px-8 sm:pl-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-hcl-blue/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-[0.18em] text-hcl-blue dark:bg-hcl-blue/20">
                <Shield className="h-3.5 w-3.5" strokeWidth={2} />
                HCL Software
              </span>
              <span className="text-xs font-medium text-carbon-text-secondary dark:text-slate-500">{PRODUCT_NAME} governance</span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-hcl-blue text-white shadow-md shadow-hcl-blue/25">
                <Scale className="h-6 w-6" strokeWidth={1.75} />
              </div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-3xl">Policy rules library</h2>
                <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  Manage the <span className="font-medium text-slate-800 dark:text-slate-200">rules_library</span> catalog in Neon.
                  Edits are picked up by the MCP policy engine after cache refresh (~30s) or when{" "}
                  <code className="rounded-md bg-slate-200/80 px-1.5 py-0.5 font-mono text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                    refresh_rules_library
                  </code>{" "}
                  runs.
                </p>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 lg:pb-1">
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RotateCw className={cls("h-4 w-4", loading && "animate-spin")} strokeWidth={2} />
              Refresh
            </button>
            <button
              type="button"
              onClick={openCreate}
              disabled={loading || Boolean(loadError)}
              className="inline-flex items-center gap-2 rounded-xl bg-hcl-blue px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-hcl-blue/20 transition hover:bg-[#0043ce] focus:outline-none focus:ring-2 focus:ring-hcl-blue/40 disabled:opacity-50"
            >
              <CirclePlus className="h-4 w-4" strokeWidth={2} />
              Add rule
            </button>
          </div>
        </div>
      </section>

      {/* KPI strip */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Rules in library" value={loading ? "—" : rules.length} icon={Layers} sub="Loaded from Neon" />
        <KpiTile label="Mandatory rules" value={loading ? "—" : kpis.mandatory} icon={Shield} sub="Always-on when domain matches" />
        <KpiTile label="Domains covered" value={loading ? "—" : kpis.domains} icon={Sparkles} sub="quality · ux · regulatory …" />
        <KpiTile
          label="Last sync"
          value={lastLoadedAt ? lastLoadedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—"}
          icon={RotateCw}
          sub={lastLoadedAt ? lastLoadedAt.toLocaleDateString(undefined, { dateStyle: "medium" }) : "Refresh to load"}
        />
      </section>

      {loadError ? (
        <Card className="border-amber-300/90 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/35">
          <Text className="font-medium text-amber-950 dark:text-amber-100">Could not load rules</Text>
          <Text className="mt-1 text-sm text-amber-900/90 dark:text-amber-200/90">{loadError}</Text>
          <Text className="mt-2 text-xs text-amber-800/80 dark:text-amber-300/80">
            Set <code className="rounded bg-white/70 px-1 dark:bg-black/30">DATABASE_URL</code> on this project and ensure the{" "}
            <code className="rounded bg-white/70 px-1 dark:bg-black/30">rules_library</code> table exists.
          </Text>
        </Card>
      ) : null}

      {/* Search */}
      <div className="relative max-w-2xl">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={2} />
        <input
          type="search"
          className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 shadow-sm outline-none ring-0 transition placeholder:text-slate-400 focus:border-hcl-blue focus:ring-2 focus:ring-hcl-blue/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          placeholder="Filter by name, domain, industry, tag, logic id, or UUID…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter rules"
        />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-12">
        {/* Main table */}
        <div className="min-w-0 xl:col-span-8">
          <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-700/90 dark:bg-slate-900/60">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800 sm:px-5">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Catalog</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Showing <span className="font-medium text-slate-700 dark:text-slate-300">{filtered.length}</span> of {rules.length}{" "}
                  rules
                </p>
              </div>
            </div>
            <div className="max-h-[min(70vh,720px)] overflow-auto">
              {loading ? (
                <div className="flex items-center gap-3 px-5 py-16 text-sm text-slate-500">
                  <RotateCw className="h-4 w-4 animate-spin text-hcl-blue" />
                  Loading rules…
                </div>
              ) : (
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-5">
                        Rule
                      </th>
                      <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Domain</th>
                      <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Industry</th>
                      <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Tags</th>
                      <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Mandatory
                      </th>
                      <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Logic id</th>
                      <th className="sticky right-0 whitespace-nowrap bg-white/95 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 backdrop-blur dark:bg-slate-900/95 sm:px-5">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-14 text-center text-sm text-slate-500 dark:text-slate-400">
                          {rules.length === 0
                            ? "No rules yet. Run the rules seed script or add a rule."
                            : "No rules match your filter."}
                        </td>
                      </tr>
                    ) : (
                      filtered.map((r) => {
                        const logicId = String((r.rule_logic as { id?: string })?.id || "—");
                        return (
                          <tr
                            key={r.rule_id}
                            className="transition hover:bg-slate-50/90 dark:hover:bg-slate-800/40"
                          >
                            <td className="max-w-[14rem] px-4 py-3.5 align-top sm:px-5">
                              <p className="font-semibold text-slate-900 dark:text-slate-100">{r.rule_name}</p>
                              <p className="mt-0.5 font-mono text-[11px] text-slate-400 dark:text-slate-500">{r.rule_id}</p>
                            </td>
                            <td className="px-3 py-3.5 align-top">
                              <span
                                className={cls(
                                  "inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold capitalize",
                                  domainPillClass(r.domain_id),
                                )}
                              >
                                {r.domain_id || "—"}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-3.5 align-top text-slate-700 dark:text-slate-300">
                              {r.industry_id || "—"}
                            </td>
                            <td className="max-w-[11rem] px-3 py-3.5 align-top">
                              <div className="flex flex-wrap gap-1">
                                {(r.compliance_tags || []).slice(0, 5).map((t) => (
                                  <Badge key={t} color="gray" className="font-normal">
                                    {t}
                                  </Badge>
                                ))}
                                {(r.compliance_tags || []).length > 5 ? (
                                  <span className="self-center text-xs text-slate-400">+{(r.compliance_tags || []).length - 5}</span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-3.5 align-top">
                              <Badge color={r.is_mandatory ? "red" : "gray"}>{r.is_mandatory ? "Yes" : "No"}</Badge>
                            </td>
                            <td className="px-3 py-3.5 align-top font-mono text-xs text-slate-700 dark:text-slate-300">{logicId}</td>
                            <td className="sticky right-0 bg-white/80 px-4 py-3.5 text-right align-middle backdrop-blur-sm dark:bg-slate-900/80 sm:px-5">
                              <button
                                type="button"
                                onClick={() => openEdit(r)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-hcl-blue/40 hover:text-hcl-blue dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-hcl-blue/50 dark:hover:text-white"
                              >
                                <SquarePen className="h-3.5 w-3.5" strokeWidth={2} />
                                Edit
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar guidance */}
        <aside className="space-y-4 xl:col-span-4">
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm dark:border-slate-700/90 dark:bg-slate-900/60">
            <div className="flex items-center gap-2 text-hcl-blue">
              <FileJson2 className="h-5 w-5" strokeWidth={1.75} />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Rule logic schema</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Each rule&apos;s <span className="font-medium text-slate-800 dark:text-slate-200">rule_logic</span> JSON should include
              fields the policy engine expects:
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <li className="flex gap-2">
                <span className="font-mono text-xs text-hcl-blue">id</span>
                <span>Stable rule identifier (e.g. HIPAA-001).</span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-xs text-hcl-blue">pattern</span>
                <span>Regex as a string for code scanning.</span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-xs text-hcl-blue">severity</span>
                <span>BLOCKER, HIGH, MEDIUM, …</span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-xs text-hcl-blue">action</span>
                <span>Remediation hint for developers.</span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-xs text-hcl-blue">description</span>
                <span>Human-readable rationale.</span>
              </li>
            </ul>
          </div>
          <div className="rounded-2xl border border-dashed border-slate-300/90 bg-slate-50/80 p-5 dark:border-slate-600 dark:bg-slate-900/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">HCL Software</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Prefer mandatory rules only for non-negotiable controls (e.g. secrets, PHI). Optional rules can be gated with compliance
              tags so tenants opt in via MCP metadata.
            </p>
          </div>
        </aside>
      </div>

      {editorOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 pb-12 backdrop-blur-md sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rules-editor-title"
        >
          <div className="relative mt-4 w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="h-1.5 w-full bg-gradient-to-r from-hcl-blue to-[#4589ff]" aria-hidden />
            <button
              type="button"
              className="absolute right-3 top-5 rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Close"
              onClick={() => setEditorOpen(false)}
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
            <div className="px-6 pb-8 pt-7 sm:px-8">
              <div className="flex flex-wrap items-center gap-3 pr-10">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-hcl-blue/10 text-hcl-blue dark:bg-hcl-blue/20">
                  {isNew ? <CirclePlus className="h-5 w-5" strokeWidth={2} /> : <SquarePen className="h-5 w-5" strokeWidth={2} />}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-hcl-blue">HCL Software · {PRODUCT_NAME}</p>
                  <h3 id="rules-editor-title" className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                    {isNew ? "Create policy rule" : "Edit policy rule"}
                  </h3>
                </div>
              </div>

              <div className="mt-8 grid gap-8 lg:grid-cols-2">
                <div className="space-y-4">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Rule name
                    <input className={inputClass} value={draft.rule_name} onChange={(e) => setDraft((d) => ({ ...d, rule_name: e.target.value }))} />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                      Domain
                      <input
                        className={inputClass}
                        value={draft.domain_id}
                        onChange={(e) => setDraft((d) => ({ ...d, domain_id: e.target.value }))}
                        placeholder="quality, ux, regulatory"
                      />
                    </label>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                      Industry (optional)
                      <input
                        className={inputClass}
                        value={draft.industry_id}
                        onChange={(e) => setDraft((d) => ({ ...d, industry_id: e.target.value }))}
                        placeholder="healthcare, finance"
                      />
                    </label>
                  </div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Compliance tags
                    <input
                      className={inputClass}
                      value={draft.compliance_tags_csv}
                      onChange={(e) => setDraft((d) => ({ ...d, compliance_tags_csv: e.target.value }))}
                      placeholder="HIPAA, SOC2 — comma separated"
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Tenant UUID (optional)
                    <input
                      className={cls(inputClass, "font-mono text-xs")}
                      value={draft.tenant_id}
                      onChange={(e) => setDraft((d) => ({ ...d, tenant_id: e.target.value }))}
                      placeholder="Empty = global"
                    />
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-hcl-blue focus:ring-hcl-blue/30"
                      checked={draft.is_mandatory}
                      onChange={(e) => setDraft((d) => ({ ...d, is_mandatory: e.target.checked }))}
                    />
                    <span>
                      <span className="font-medium text-slate-900 dark:text-white">Mandatory rule</span>
                      <span className="mt-0.5 block text-sm font-normal text-slate-600 dark:text-slate-300">
                        When enabled, the rule applies whenever its domain is included in the active profile (subject to industry
                        scope).
                      </span>
                    </span>
                  </label>
                </div>
                <div className="flex min-h-0 flex-col">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Rule logic (JSON)</label>
                  <Textarea
                    className="mt-1.5 min-h-[22rem] flex-1 rounded-xl border-slate-200 font-mono text-xs leading-relaxed dark:border-slate-600"
                    value={draft.rule_logic_json}
                    onValueChange={(v) => setDraft((d) => ({ ...d, rule_logic_json: v }))}
                  />
                </div>
              </div>

              {saveError ? <p className="mt-4 text-sm font-medium text-red-600 dark:text-red-400">{saveError}</p> : null}

              <div className="mt-8 flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-6 dark:border-slate-800">
                <Button variant="secondary" onClick={() => setEditorOpen(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => void save()} loading={saving} disabled={saving}>
                  Save rule
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
