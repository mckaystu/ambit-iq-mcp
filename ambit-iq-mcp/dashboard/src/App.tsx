import { Fragment, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Text } from "@tremor/react";
import { Activity, Building2, ChevronDown, ChevronRight, CircleGauge, Copy, Moon, Sun } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { PRODUCT_NAME } from "./brand";
import HclBrandStrip from "./components/HclBrandStrip";
import GovernanceTabs from "./components/GovernanceTabs";
import { defaultDateRange, getDashboardData } from "./data";
import RulesLibraryPage from "./RulesLibraryPage";
import type { ActiveIssue, DashboardData, DateRangeFilter, DateRangePreset } from "./types";

type AdminPage = "metrics" | "rules";

function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function ComplianceGauge({ value }: { value: number }) {
  const radius = 72;
  const stroke = 12;
  const c = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, value));
  const dash = c - (pct / 100) * c;

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 180 180" className="h-40 w-40">
        <circle cx="90" cy="90" r={radius} strokeWidth={stroke} className="stroke-slate-200 dark:stroke-slate-800" fill="none" />
        <circle
          cx="90"
          cy="90"
          r={radius}
          strokeWidth={stroke}
          fill="none"
          className="stroke-hcl-blue"
          strokeDasharray={c}
          strokeDashoffset={dash}
          strokeLinecap="round"
          transform="rotate(-90 90 90)"
        />
        <text x="90" y="88" textAnchor="middle" className="fill-slate-900 text-2xl font-semibold dark:fill-slate-100">
          {pct}%
        </text>
        <text x="90" y="108" textAnchor="middle" className="fill-slate-500 text-[10px] uppercase tracking-widest dark:fill-slate-400">
          Health
        </text>
      </svg>
      <div>
        <p className="text-sm text-slate-500 dark:text-slate-400">Org Compliance Health</p>
        <p className="mt-2 text-xl font-semibold">
          {pct >= 90 ? "Excellent" : pct >= 75 ? "Stable" : "Needs Attention"}
        </p>
      </div>
    </div>
  );
}

function InsightCards({ insights }: { insights: DashboardData["insights"] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {insights.map((insight) => (
        <Card key={insight.title} className="enchanted-card">
          <p className="text-sm font-medium text-hcl-blue">{insight.title}</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{insight.summary}</p>
        </Card>
      ))}
    </div>
  );
}

function formatUtc(v: string): string {
  return new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function shortIssueId(id: string): string {
  if (UUID_RE.test(id)) return `${id.slice(0, 8)}…`;
  return id.length > 14 ? `${id.slice(0, 12)}…` : id;
}

function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function DateRangeControls({
  range,
  onChange,
}: {
  range: DateRangeFilter;
  onChange: (next: DateRangeFilter) => void;
}) {
  const presets: DateRangePreset[] = ["7d", "30d", "90d"];
  return (
    <Card className="enchanted-card">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {presets.map((preset) => (
            <button
              key={preset}
              className={cls(
                "rounded-lg px-3 py-1.5 text-sm",
                range.preset === preset
                  ? "bg-hcl-blue text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
              )}
              onClick={() => {
                const end = new Date();
                const start = new Date();
                const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
                start.setDate(start.getDate() - days);
                onChange({
                  preset,
                  startDate: start.toISOString().slice(0, 10),
                  endDate: end.toISOString().slice(0, 10),
                });
              }}
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="start">Start</label>
          <input
            id="start"
            type="date"
            value={range.startDate}
            onChange={(e) => onChange({ ...range, startDate: e.target.value })}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
          />
          <label htmlFor="end">End</label>
          <input
            id="end"
            type="date"
            value={range.endDate}
            onChange={(e) => onChange({ ...range, endDate: e.target.value })}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
          />
        </div>
      </div>
    </Card>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={cls("min-w-0 break-words", mono && "font-mono text-xs")}>{value}</dd>
    </>
  );
}

function ActiveIssuesTable({ rows }: { rows: ActiveIssue[] }) {
  const [sort, setSort] = useState<"createdAt" | "severity">("createdAt");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      if (sort === "severity") return a.severity === b.severity ? 0 : a.severity === "BLOCKER" ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
    return out;
  }, [rows, sort]);

  function toggleRow(id: string) {
    setExpandedId((cur) => (cur === id ? null : id));
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  return (
    <Card className="enchanted-card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold">Active Issues Feed</h3>
        <div className="space-x-2 text-xs">
          <button type="button" onClick={() => setSort("createdAt")} className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">
            Sort: Latest
          </button>
          <button type="button" onClick={() => setSort("severity")} className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">
            Sort: Severity
          </button>
        </div>
      </div>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Click a row to expand details (rule, tenant, context, ids).</p>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell className="w-8" />
            <TableHeaderCell>Issue</TableHeaderCell>
            <TableHeaderCell>Rule</TableHeaderCell>
            <TableHeaderCell>User</TableHeaderCell>
            <TableHeaderCell>Repo</TableHeaderCell>
            <TableHeaderCell>Industry</TableHeaderCell>
            <TableHeaderCell>Severity</TableHeaderCell>
            <TableHeaderCell>Created</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((row) => (
            <Fragment key={row.id}>
              <TableRow
                className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50"
                onClick={() => toggleRow(row.id)}
              >
                <TableCell className="align-middle text-slate-400">
                  {expandedId === row.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </TableCell>
                <TableCell title={row.id}>
                  <span className="font-mono text-xs">{shortIssueId(row.id)}</span>
                </TableCell>
                <TableCell title={row.ruleName} className="max-w-[14rem] truncate text-sm">
                  {truncateText(row.ruleName, 48)}
                </TableCell>
                <TableCell>{row.userId}</TableCell>
                <TableCell>{row.repoName}</TableCell>
                <TableCell>{row.industryId}</TableCell>
                <TableCell>
                  <Badge color={row.severity === "BLOCKER" ? "red" : "amber"}>{row.severity}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">{formatUtc(row.createdAt)}</TableCell>
              </TableRow>
              {expandedId === row.id ? (
                <TableRow className="bg-slate-50 dark:bg-slate-900/60">
                  <TableCell colSpan={8} className="align-top">
                    <div className="flex flex-col gap-3 py-2 pl-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Text className="text-sm font-semibold">Issue details</Text>
                        {row.isResolved ? (
                          <Badge color="emerald">Resolved</Badge>
                        ) : (
                          <Badge color="gray">Open</Badge>
                        )}
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-white dark:border-slate-600 dark:hover:bg-slate-800"
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyText(row.id);
                          }}
                        >
                          <Copy className="h-3 w-3" />
                          Copy activity id
                        </button>
                        {row.ruleId ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-white dark:border-slate-600 dark:hover:bg-slate-800"
                            onClick={(e) => {
                              e.stopPropagation();
                              void copyText(row.ruleId!);
                            }}
                          >
                            <Copy className="h-3 w-3" />
                            Copy rule id
                          </button>
                        ) : null}
                      </div>
                      <dl className="grid max-w-4xl gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(7rem,auto)_1fr]">
                        <DetailRow label="Activity id" value={row.id} mono />
                        <DetailRow label="Rule" value={row.ruleName} />
                        <DetailRow label="Rule id" value={row.ruleId || ""} mono />
                        <DetailRow label="User" value={row.userId} />
                        <DetailRow label="Repo" value={row.repoName} />
                        <DetailRow label="Tenant" value={row.tenant} />
                        <DetailRow label="Industry" value={row.industryId} />
                        <DetailRow label="Severity" value={row.severity} />
                        <DetailRow label="Recorded" value={formatUtc(row.createdAt)} />
                      </dl>
                      {row.contextSnippet ? (
                        <div>
                          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Context snippet</p>
                          <pre className="max-h-48 overflow-auto rounded-md border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                            {row.contextSnippet}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function DataSourceBanner({ source, error }: { source: "live" | "demo"; error?: string }) {
  if (source === "live") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
        <strong>Live data</strong> — metrics from Neon via <code className="rounded bg-white/60 px-1 dark:bg-black/30">/api/dashboard-metrics</code>.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100">
      <strong>Demo data</strong> — the dashboard API is not returning metrics (common causes: local <code className="rounded bg-white/60 px-1 dark:bg-black/30">npm run dev</code> without API, missing{" "}
      <code className="rounded bg-white/60 px-1 dark:bg-black/30">DATABASE_URL</code> on Vercel, or the deploy does not include <code className="rounded bg-white/60 px-1 dark:bg-black/30">api/</code>
      ). Charts below are mock data.
      {error ? (
        <p className="mt-2 font-mono text-xs opacity-90">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function DashboardSections({
  data,
  dataSource,
  dataError,
  range,
  onRangeChange,
}: {
  data: DashboardData;
  dataSource: "live" | "demo";
  dataError?: string;
  range: DateRangeFilter;
  onRangeChange: (next: DateRangeFilter) => void;
}) {
  return (
    <div className="space-y-8">
      <DataSourceBanner source={dataSource} error={dataError} />
      <DateRangeControls range={range} onChange={onRangeChange} />
      <section className="snap-start">
        <Card className="enchanted-card">
          <div className="flex items-center gap-2">
            <CircleGauge className="h-5 w-5 text-hcl-blue" />
            <h2 className="text-lg font-semibold">Compliance Health</h2>
          </div>
          <div className="mt-4">
            <ComplianceGauge value={data.complianceScore} />
          </div>
        </Card>
      </section>

      <section className="snap-start">
        <Card className="enchanted-card">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-hcl-blue" />
            <h2 className="text-lg font-semibold">Blockers vs Warnings (Trend)</h2>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.trendSeries}>
                <defs>
                  <linearGradient id="hclBlockers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0f62fe" stopOpacity={0.7} />
                    <stop offset="95%" stopColor="#0f62fe" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="warnings" stroke="#f59e0b" fill="#fcd34d" fillOpacity={0.25} />
                <Area type="monotone" dataKey="blockers" stroke="#0f62fe" fill="url(#hclBlockers)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      <section className="snap-start">
        <Card className="enchanted-card">
          <div className="mb-4 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-hcl-blue" />
            <h2 className="text-lg font-semibold">Industry Violation Heatmap</h2>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.industrySeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="industryId" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="violations" radius={[6, 6, 0, 0]}>
                  {data.industrySeries.map((_, idx) => (
                    <Cell key={idx} fill={idx % 2 === 0 ? "#0f62fe" : "#4589ff"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      <section className="snap-start space-y-4">
        <InsightCards insights={data.insights} />
        <ActiveIssuesTable rows={data.activeIssues} />
      </section>
    </div>
  );
}

export default function App() {
  const [searchParams] = useSearchParams();
  const [darkMode, setDarkMode] = useState(false);
  const [page, setPage] = useState<AdminPage>("metrics");
  const [range, setRange] = useState<DateRangeFilter>(defaultDateRange());
  const [data, setData] = useState<DashboardData | null>(null);
  const [dataSource, setDataSource] = useState<"live" | "demo">("demo");
  const [dataError, setDataError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const requestKey = useMemo(
    () => `${range.preset}-${range.startDate}-${range.endDate}`,
    [range.preset, range.startDate, range.endDate],
  );

  useEffect(() => {
    const raw = String(searchParams.get("view") || "metrics").toLowerCase();
    if (raw === "rules") {
      setPage("rules");
      return;
    }
    setPage("metrics");
  }, [searchParams]);

  useEffect(() => {
    if (page !== "metrics") {
      return;
    }
    let active = true;
    setLoading(true);
    getDashboardData(range)
      .then((next) => {
        if (!active) return;
        setData(next.data);
        setDataSource(next.source);
        setDataError(next.error);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, requestKey, range]);

  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", darkMode);
  }

  return (
    <div className="min-h-screen bg-carbon-bg dark:bg-slate-950">
      <HclBrandStrip />
      <header className="sticky top-0 z-20 border-b border-carbon-border bg-carbon-layer/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-hcl-blue">{PRODUCT_NAME}</p>
            <h1 className="text-2xl font-semibold tracking-tight text-carbon-text dark:text-slate-50">Governance console</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-widest text-carbon-text-secondary">HCL Software</p>
              <p className="text-lg font-semibold text-hcl-blue">HCLSoftware</p>
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
        </div>
        <div className="mx-auto w-full max-w-7xl px-6 pb-4">
          <GovernanceTabs />
        </div>
      </header>

      <main
        className={cls(
          "mx-auto w-full snap-y snap-proximity space-y-8 px-4 py-6 sm:px-6 lg:px-8",
          page === "rules" ? "max-w-[min(96rem,calc(100%-1rem))]" : "max-w-7xl",
        )}
      >
        {page === "rules" ? (
          <RulesLibraryPage />
        ) : loading || !data ? (
          <div className="p-8 text-sm text-carbon-text-secondary dark:text-slate-400">Loading {PRODUCT_NAME}…</div>
        ) : (
          <DashboardSections
            data={data}
            dataSource={dataSource}
            dataError={dataError}
            range={range}
            onRangeChange={setRange}
          />
        )}
      </main>
    </div>
  );
}
