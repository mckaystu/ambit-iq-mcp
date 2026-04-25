import { useEffect, useMemo, useState } from "react";
import { Bot, BrainCircuit, ChevronDown, ChevronRight, Layers, Moon, Send, ShieldCheck, Sparkles, Sun, X } from "lucide-react";
import { Badge, Card } from "@tremor/react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PRODUCT_NAME } from "./brand";
import HclBrandStrip from "./components/HclBrandStrip";
import GovernanceTabs from "./components/GovernanceTabs";
import { apiPath } from "./apiBase";

type SignalRow = {
  id: string;
  repo_name: string;
  pr_url: string;
  action: "NEW_RULE" | "REFINE_RULE" | "NO_ACTION" | string;
  reasoning: string;
  natural_language_intent: string;
  efficacy_improvement: string;
  model: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  category: string;
  suggested_rego_logic: string;
  created_at: string | null;
};

type CopilotMessage = { id: string; role: "assistant" | "user"; text: string };

type PolicyRow = {
  rule_id: string;
  rule_name: string;
  domain_id: string | null;
  rule_logic: Record<string, unknown>;
};

function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function CircularKpi({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <Card className="enchanted-card">
      <div className="flex items-center gap-4">
        <div className="flex h-28 w-28 items-center justify-center rounded-full border-8 border-hcl-blue/20 bg-hcl-blue/5">
          <span className="text-center text-2xl font-semibold text-hcl-blue">{value}</span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-carbon-text dark:text-slate-100">{title}</p>
          <p className="mt-1 text-sm text-carbon-text-secondary dark:text-slate-400">{hint}</p>
        </div>
      </div>
    </Card>
  );
}

export default function SignalIntelligencePage() {
  const [darkMode, setDarkMode] = useState(false);
  const [rows, setRows] = useState<SignalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [promoted, setPromoted] = useState<Record<string, boolean>>({});
  const [clusterCategory, setClusterCategory] = useState<string | null>(null);
  const [synthCategory, setSynthCategory] = useState<string | null>(null);
  const [clarifyOpen, setClarifyOpen] = useState<Record<string, boolean>>({});
  const [intentOverrides, setIntentOverrides] = useState<Record<string, string>>({});
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<"HIGH" | "MEDIUM" | "LOW" | null>(null);
  const [quickFilter, setQuickFilter] = useState<"all" | "missing-intent" | "new-rule">("all");
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotInput, setCopilotInput] = useState("");
  const [copilotMessages, setCopilotMessages] = useState<CopilotMessage[]>([
    {
      id: "m0",
      role: "assistant",
      text:
        "Signal Agent ready. I can filter signals, draft policy logic, summarize top rejection trends, stage a deployment bundle, and recover missing intents.",
    },
  ]);
  const [stagedBundle, setStagedBundle] = useState<string[]>([]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(apiPath("/api/signals-intelligence?limit=250"))
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((json) => {
        if (!active) return;
        const list = Array.isArray(json?.signals) ? json.signals : [];
        setRows(list);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(String(e?.message || e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    fetch(apiPath("/api/rules-library"))
      .then(async (res) => {
        if (!res.ok) return { rules: [] };
        return res.json();
      })
      .then((json) => {
        const rules = Array.isArray(json?.rules) ? json.rules : [];
        setPolicies(
          rules.map((r: PolicyRow) => ({
            rule_id: String(r.rule_id || ""),
            rule_name: String(r.rule_name || ""),
            domain_id: r.domain_id ? String(r.domain_id) : null,
            rule_logic: r.rule_logic && typeof r.rule_logic === "object" ? r.rule_logic : {},
          })),
        );
      })
      .catch(() => {
        setPolicies([]);
      });
  }, []);

  const categoryData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = row.category || "Uncategorized";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [rows]);

  const highPriorityCount = rows.filter((r) => r.priority === "HIGH").length;
  const uniqueCategoryCount = new Set(rows.map((r) => r.category || "Uncategorized")).size;
  const automationPotentialPct = rows.length
    ? Math.round((rows.filter((r) => r.action === "NEW_RULE").length / rows.length) * 100)
    : 0;
  const estimatedEngineeringHoursSaved = rows.filter((r) => r.action === "NEW_RULE").length * 2;

  const visibleRows = useMemo(() => {
    const cat = synthCategory || clusterCategory;
    return rows.filter((r) => {
      if (cat && r.category !== cat) return false;
      if (priorityFilter && r.priority !== priorityFilter) return false;
      const intent = (intentOverrides[r.id] ?? r.natural_language_intent ?? "").trim();
      const isMissingIntent = !intent || /^no intent generated/i.test(intent);
      if (quickFilter === "missing-intent" && !isMissingIntent) return false;
      if (quickFilter === "new-rule" && r.action !== "NEW_RULE") return false;
      return true;
    });
  }, [rows, clusterCategory, synthCategory, priorityFilter, quickFilter, intentOverrides]);

  function pushCopilot(role: "assistant" | "user", text: string) {
    setCopilotMessages((cur) => [...cur, { id: `m${cur.length + 1}`, role, text }]);
  }

  function topCategorySummary() {
    return categoryData
      .slice(0, 5)
      .map((c, i) => `${i + 1}. ${c.category}: ${c.count}`)
      .join("\n");
  }

  function findMissingIntentSignals() {
    return rows.filter((r) => {
      const intent = (intentOverrides[r.id] ?? r.natural_language_intent ?? "").trim();
      return !intent || /^no intent generated/i.test(intent);
    });
  }

  function buildGeneralInsight() {
    if (!rows.length) {
      return "Signal feed is currently empty, so there is nothing to summarize yet.";
    }

    const topCategory = categoryData[0];
    const newRuleCount = rows.filter((r) => r.action === "NEW_RULE").length;
    const missingIntentCount = findMissingIntentSignals().length;
    const highPriority = rows.filter((r) => r.priority === "HIGH");
    const topSignal = highPriority[0] ?? rows[0];
    const topSignalIntent = (intentOverrides[topSignal.id] ?? topSignal.natural_language_intent ?? "").trim();

    return [
      "Here is a quick signal snapshot:",
      `- Total signals in scope: ${rows.length}`,
      topCategory ? `- Top rejection category: ${topCategory.category} (${topCategory.count} signals)` : "- Top rejection category: unavailable",
      `- High-priority signals: ${highPriorityCount}`,
      `- NEW_RULE opportunities: ${newRuleCount}`,
      `- Signals missing intent: ${missingIntentCount}`,
      "",
      `Most urgent example: ${topSignal.repo_name} (${topSignal.priority})`,
      `Intent: ${topSignalIntent || "No intent generated yet."}`,
      "",
      "Try: 'Executive Summary' for ranked trends or 'Show high-priority dependency issues' for focused triage.",
    ].join("\n");
  }

  function handleCopilotSubmit() {
    const q = copilotInput.trim();
    if (!q) return;
    pushCopilot("user", q);
    setCopilotInput("");
    const lower = q.toLowerCase();

    if (lower.includes("executive summary") || lower.includes("top 5")) {
      pushCopilot(
        "assistant",
        `Executive Summary (Top 5 rejection trends)\n${topCategorySummary()}\n\nHigh-priority signals: ${highPriorityCount}\nAutomation potential: ${automationPotentialPct}%`,
      );
      return;
    }

    if (lower.includes("show") && lower.includes("high")) {
      setPriorityFilter("HIGH");
      if (lower.includes("dependency")) {
        setClusterCategory("Dependency Management");
      }
      pushCopilot("assistant", "Applied filter: HIGH priority signals. I also prioritized dependency category when available.");
      return;
    }

    if (lower.includes("clear filter")) {
      setPriorityFilter(null);
      setClusterCategory(null);
      setSynthCategory(null);
      pushCopilot("assistant", "Filters cleared. Showing full Signal Feed.");
      return;
    }

    if (lower.includes("synthesize") && lower.includes("category")) {
      const top = categoryData[0]?.category;
      if (top) {
        setSynthCategory(top);
        setClusterCategory(top);
        pushCopilot("assistant", `Synthesis context set to category "${top}". You can now run Combine into Master Policy.`);
      } else {
        pushCopilot("assistant", "No category data is available yet.");
      }
      return;
    }

    if (lower.includes("stage for deployment") || lower.includes("bundle")) {
      const candidateIds = visibleRows
        .filter((r) => r.action === "NEW_RULE" || r.action === "REFINE_RULE")
        .slice(0, 5)
        .map((r) => r.id);
      setStagedBundle(candidateIds);
      pushCopilot(
        "assistant",
        candidateIds.length
          ? `Staged ${candidateIds.length} signals for deployment bundle (mock PR package).`
          : "No eligible signals in current view to stage.",
      );
      return;
    }

    if (lower.includes("intent recover") || lower.includes("no intent") || lower.includes("intent discover")) {
      const missing = findMissingIntentSignals();
      if (!missing.length) {
        pushCopilot("assistant", "All visible signals already have intents.");
      } else {
        const first = missing[0];
        setClarifyOpen((cur) => ({ ...cur, [first.id]: true }));
        pushCopilot(
          "assistant",
          `I found ${missing.length} signals without intent. Starting interview on ${first.repo_name}. What policy outcome do you want enforced?`,
        );
      }
      return;
    }

    if (lower.includes("draft rego") || lower.includes("generate rego")) {
      const baseIntent = visibleRows[0]?.natural_language_intent || "Enforce dependency and safety checks on pull requests.";
      const draft = `package agent.gate.policy\n\ndefault allow = true\n\nviolation[msg] {\n  input.context.intent == "${baseIntent.replace(/"/g, '\\"')}"\n  not input.context.has_policy_guardrail\n  msg := "Policy guardrail missing for declared intent"\n}`;
      pushCopilot("assistant", `Draft Rego logic based on current context:\n${draft}`);
      return;
    }

    if (
      lower.includes("tell me") ||
      lower.includes("something") ||
      lower.includes("insight") ||
      lower.includes("what should i do") ||
      lower.includes("what's next") ||
      lower.includes("whats next")
    ) {
      pushCopilot("assistant", buildGeneralInsight());
      return;
    }

    pushCopilot("assistant", `${buildGeneralInsight()}\n\nYou can also ask me to run a specific action.`);
  }

  return (
    <div className="min-h-screen bg-carbon-bg dark:bg-slate-950">
      <HclBrandStrip />
      <header className="sticky top-0 z-20 border-b border-carbon-border bg-carbon-layer/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex w-full max-w-[min(110rem,calc(100%-1rem))] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-hcl-blue text-white shadow-sm">
                <BrainCircuit className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-hcl-blue">HCL Software · {PRODUCT_NAME}</p>
                <h1 className="truncate text-lg font-semibold tracking-tight text-carbon-text dark:text-white sm:text-xl">Signal Intelligence</h1>
                <p className="text-xs text-carbon-text-secondary dark:text-slate-400">Human-in-the-loop governance signal review and promotion.</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setDarkMode((v) => !v)}
              className={cls("rounded-lg border border-carbon-border p-2 hover:bg-carbon-layer-01 dark:border-slate-700 dark:hover:bg-slate-800")}
              aria-label="Toggle dark mode"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[min(110rem,calc(100%-1rem))] px-4 pb-4 sm:px-6 lg:px-8">
          <GovernanceTabs />
        </div>
      </header>

      <main className={cls("mx-auto w-full max-w-[min(110rem,calc(100%-1rem))] space-y-6 px-4 py-6 sm:px-6 lg:px-8", copilotOpen && "pr-[22rem]")}>
        {loading ? <Card className="enchanted-card p-6 text-sm text-carbon-text-secondary">Loading signal intelligence…</Card> : null}
        {error ? (
          <Card className="enchanted-card border-amber-300 bg-amber-50 p-6 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
            Signal intelligence data unavailable: {error}
          </Card>
        ) : null}

        {!loading && !error ? (
          <>
            <section className="grid gap-4 md:grid-cols-3">
              <CircularKpi title="Policy Coverage Gap" value={String(uniqueCategoryCount)} hint="Unique rejection categories requiring governance attention." />
              <CircularKpi title="High-Priority Signals" value={String(highPriorityCount)} hint="Signals marked HIGH by reviewer-aligned analysis." />
              <CircularKpi title="Automation Potential" value={`${automationPotentialPct}%`} hint="Signals mapped to NEW_RULE opportunities." />
            </section>
            <section>
              <Card className="enchanted-card">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-hcl-blue/10 text-hcl-blue">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Velocity Impact</p>
                    <p className="text-sm text-carbon-text-secondary dark:text-slate-400">
                      Estimated Engineering Time Saved: <span className="font-semibold text-carbon-text dark:text-slate-100">{estimatedEngineeringHoursSaved}h</span> (2h x NEW_RULE signals)
                    </p>
                  </div>
                </div>
              </Card>
            </section>

            <section>
              <Card className="enchanted-card">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold">Signal Trend: Rejection Categories</h2>
                  <div className="flex items-center gap-2">
                    {categoryData.length ? (
                      <select
                        value={synthCategory || ""}
                        onChange={(e) => setSynthCategory(e.target.value || null)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900"
                      >
                        <option value="">Select category</option>
                        {categoryData.map((c) => (
                          <option key={c.category} value={c.category}>
                            {c.category}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <button
                      type="button"
                      disabled={!synthCategory}
                      onClick={() => setClusterCategory(synthCategory)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
                    >
                      Synthesize Category
                    </button>
                    {clusterCategory ? (
                      <button
                        type="button"
                        onClick={() => {
                          setClusterCategory(null);
                          setSynthCategory(null);
                        }}
                        className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                      >
                        Clear Cluster
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={categoryData} margin={{ left: 40, right: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="category" width={220} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#0f62fe" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </section>

            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Signal Feed</h2>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setQuickFilter("all")}
                      className={cls(
                        "rounded px-2 py-1 text-xs",
                        quickFilter === "all"
                          ? "bg-hcl-blue text-white"
                          : "border border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800",
                      )}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickFilter("missing-intent")}
                      className={cls(
                        "rounded px-2 py-1 text-xs",
                        quickFilter === "missing-intent"
                          ? "bg-hcl-blue text-white"
                          : "border border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800",
                      )}
                    >
                      Missing Intent
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickFilter("new-rule")}
                      className={cls(
                        "rounded px-2 py-1 text-xs",
                        quickFilter === "new-rule"
                          ? "bg-hcl-blue text-white"
                          : "border border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800",
                      )}
                    >
                      NEW_RULE
                    </button>
                  </div>
                  <p className="text-xs text-carbon-text-secondary dark:text-slate-400">
                    {clusterCategory ? `Clustered by ${clusterCategory}` : `Showing ${visibleRows.length} signals`}
                  </p>
                  {clusterCategory ? (
                    <button
                      type="button"
                      onClick={() => {
                        const clustered = rows.filter((r) => r.category === clusterCategory);
                        const merged = clustered
                          .map((r) => r.suggested_rego_logic)
                          .filter(Boolean)
                          .join("\n\n# ----\n\n")
                          .slice(0, 5000);
                        if (merged) {
                          void navigator.clipboard.writeText(merged).catch(() => {});
                        }
                      }}
                      className="rounded bg-hcl-blue px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0043ce]"
                    >
                      Combine into Master Policy
                    </button>
                  ) : null}
                </div>
              </div>
              {visibleRows.map((row) => {
                const isExpanded = Boolean(expanded[row.id]);
                const isPromoted = Boolean(promoted[row.id]);
                const rawIntent = (intentOverrides[row.id] ?? row.natural_language_intent ?? "").trim();
                const missingIntent = !rawIntent || /^no intent generated/i.test(rawIntent);
                return (
                  <Card key={row.id} className="enchanted-card">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <a href={row.pr_url} target="_blank" rel="noreferrer" className="font-medium text-hcl-blue hover:underline">
                            {row.repo_name}
                          </a>
                          <Badge color={row.priority === "HIGH" ? "red" : row.priority === "LOW" ? "emerald" : "amber"}>{row.priority}</Badge>
                          <Badge color="gray">{row.category || "Uncategorized"}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-carbon-text dark:text-slate-200">
                          <span className="font-semibold">Natural Language Intent:</span>{" "}
                          {rawIntent || "No intent generated for this signal."}
                        </p>
                        {row.efficacy_improvement ? (
                          <p className="mt-1 text-xs text-carbon-text-secondary dark:text-slate-400">{row.efficacy_improvement}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setClusterCategory((cur) => (cur === row.category ? null : row.category))}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                        >
                          <Layers className="h-3.5 w-3.5" />
                          Cluster Similar
                        </button>
                        {missingIntent ? (
                          <button
                            type="button"
                            onClick={() => setClarifyOpen((cur) => ({ ...cur, [row.id]: !cur[row.id] }))}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
                          >
                            Clarify Intent
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPromoted((cur) => ({ ...cur, [row.id]: !cur[row.id] }))}
                            className={cls(
                              "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-white",
                              isPromoted ? "bg-emerald-700 hover:bg-emerald-800" : "bg-hcl-blue hover:bg-[#0043ce]",
                            )}
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            {isPromoted ? "Deployed (mock)" : "Approve & Deploy"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setExpanded((cur) => ({ ...cur, [row.id]: !cur[row.id] }))}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                        >
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          Details
                        </button>
                      </div>
                      {clarifyOpen[row.id] ? (
                        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40">
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-100">
                            Manual Intent Override
                          </label>
                          <textarea
                            value={intentOverrides[row.id] ?? ""}
                            onChange={(e) => setIntentOverrides((cur) => ({ ...cur, [row.id]: e.target.value }))}
                            rows={3}
                            className="w-full rounded border border-amber-300 bg-white px-2 py-1 text-sm dark:border-amber-700 dark:bg-slate-900"
                            placeholder="Describe the policy intent to unblock Approve & Deploy."
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => setClarifyOpen((cur) => ({ ...cur, [row.id]: false }))}
                              className="rounded bg-hcl-blue px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0043ce]"
                            >
                              Save Intent
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    {isExpanded ? (
                      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/70">
                        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                          Model: <span className="font-semibold text-slate-700 dark:text-slate-200">{row.model || "unknown"}</span>
                        </p>
                        <p className="mb-3 rounded border border-hcl-blue/20 bg-hcl-blue/5 p-2 text-xs text-slate-700 dark:text-slate-200">
                          <span className="font-semibold">Efficacy Improvement:</span>{" "}
                          {row.efficacy_improvement || "No efficacy rationale provided."}
                        </p>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Reasoning</p>
                        <p className="mt-1 text-sm text-carbon-text dark:text-slate-200">{row.reasoning || "No reviewer reasoning captured."}</p>
                        <p className="mt-4 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          <Sparkles className="h-3.5 w-3.5" />
                          Suggested Rego Logic
                        </p>
                        <pre className="mt-1 max-h-52 overflow-auto rounded border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-950">
                          {row.suggested_rego_logic || "// No suggested logic provided for this signal"}
                        </pre>
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </section>
          </>
        ) : null}
      </main>
      <aside
        className={cls(
          "fixed right-0 top-0 z-30 h-screen w-[22rem] border-l border-slate-200 bg-white/95 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95",
          !copilotOpen && "translate-x-full",
          "transition-transform duration-300",
        )}
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-hcl-blue/10 p-1.5 text-hcl-blue">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Signal Agent</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">agent.gate conversational intelligence</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCopilotOpen(false)}
                className="rounded border border-slate-300 p-1 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                aria-label="Close Signal Agent"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Context: {rows.length} signals, {policies.length} active policies.
            </p>
            {stagedBundle.length ? (
              <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                Staged for deployment: {stagedBundle.length} signals
              </p>
            ) : null}
          </div>
          <div className="flex-1 space-y-2 overflow-auto px-3 py-3">
            {copilotMessages.map((m) => (
              <div
                key={m.id}
                className={cls(
                  "rounded-lg border px-3 py-2 text-xs whitespace-pre-wrap",
                  m.role === "assistant"
                    ? "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200"
                    : "border-hcl-blue/30 bg-hcl-blue/5 text-slate-800 dark:text-slate-100",
                )}
              >
                {m.text}
              </div>
            ))}
          </div>
          <div className="border-t border-slate-200 p-3 dark:border-slate-700">
            <textarea
              rows={3}
              value={copilotInput}
              onChange={(e) => setCopilotInput(e.target.value)}
              placeholder="Ask: 'Show me high-priority dependency issues' or 'Executive Summary'"
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-950"
            />
            <button
              type="button"
              onClick={handleCopilotSubmit}
              className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded bg-hcl-blue px-2 py-1.5 text-xs font-semibold text-white hover:bg-[#0043ce]"
            >
              <Send className="h-3.5 w-3.5" />
              Send
            </button>
          </div>
        </div>
      </aside>
      {!copilotOpen ? (
        <button
          type="button"
          onClick={() => setCopilotOpen(true)}
          className="fixed bottom-6 right-6 z-20 inline-flex items-center gap-2 rounded-full bg-hcl-blue px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-hcl-blue/30 hover:bg-[#0043ce]"
          aria-label="Open Signal Agent"
        >
          <Bot className="h-4 w-4" />
          Signal Agent
        </button>
      ) : null}
    </div>
  );
}

