/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Loader2, Sparkles } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { generateManagerInsights, type ManagerInsightsNarrative } from "../lib/executive-insights";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { chartTooltipDarkProps } from "../lib/chart-tooltip";
import { formatHours, formatPercent, type UtilizationRecord } from "../lib/utils";

export type ManagerHealthStatus = "Overloaded" | "Healthy" | "Under-utilized";

export type ManagerScoreRow = {
  managerName: string;
  headcount: number;
  /** Sum of posted hours for all direct reports in the filter window. */
  teamTotalPostedHours: number;
  /** Mean posted hours per direct report (team total ÷ headcount). */
  avgPostedHoursPerPerson: number;
  /** Mean of each report's utilization % (posted ÷ available within the window), not one pooled ratio. */
  avgUtilizationPct: number;
  healthStatus: ManagerHealthStatus;
};

function managerHealthFromAvg(avg: number): ManagerHealthStatus {
  if (avg > 90) {
    return "Overloaded";
  }
  if (avg >= 70 && avg <= 90) {
    return "Healthy";
  }
  return "Under-utilized";
}

function aggregateManagers(rows: UtilizationRecord[]): ManagerScoreRow[] {
  const byResource = new Map<string, { manager: string; postedActuals: number; availableHours: number }>();

  for (const row of rows) {
    const id = row.resourceId || "Unassigned";
    const existing = byResource.get(id);
    if (existing) {
      existing.postedActuals += row.postedActuals;
      existing.availableHours += row.availableHours;
    } else {
      byResource.set(id, {
        manager: row.manager || "Unassigned",
        postedActuals: row.postedActuals,
        availableHours: row.availableHours,
      });
    }
  }

  const byManager = new Map<string, { utilizationPcts: number[]; teamTotalPostedHours: number }>();

  for (const agg of byResource.values()) {
    const name = agg.manager || "Unassigned";
    const utilizationPct =
      agg.availableHours > 0 ? (agg.postedActuals / agg.availableHours) * 100 : 0;
    const cur = byManager.get(name) ?? { utilizationPcts: [], teamTotalPostedHours: 0 };
    cur.utilizationPcts.push(utilizationPct);
    cur.teamTotalPostedHours += agg.postedActuals;
    byManager.set(name, cur);
  }

  return Array.from(byManager.entries()).map(([managerName, data]) => {
    const headcount = data.utilizationPcts.length;
    const avgUtilizationPct =
      headcount > 0 ? data.utilizationPcts.reduce((sum, v) => sum + v, 0) / headcount : 0;
    const teamTotalPostedHours = data.teamTotalPostedHours;
    const avgPostedHoursPerPerson = headcount > 0 ? teamTotalPostedHours / headcount : 0;
    return {
      managerName,
      headcount,
      teamTotalPostedHours,
      avgPostedHoursPerPerson,
      avgUtilizationPct,
      healthStatus: managerHealthFromAvg(avgUtilizationPct),
    };
  });
}

function HealthBadge({ status }: { status: ManagerHealthStatus }) {
  const styles: Record<ManagerHealthStatus, string> = {
    Overloaded: "bg-red-500/15 text-red-300 ring-1 ring-red-500/40",
    Healthy: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40",
    "Under-utilized": "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/40",
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>{status}</span>;
}

type SortKey =
  | "managerName"
  | "headcount"
  | "teamTotalPostedHours"
  | "avgPostedHoursPerPerson"
  | "avgUtilizationPct"
  | "healthStatus";

type ManagerScorecardProps = {
  filteredRows: UtilizationRecord[];
  onManagerDrillDown: (managerName: string) => void;
};

function ConfidencePill({ level, note }: { level: ManagerInsightsNarrative["confidenceLevel"]; note: string }) {
  const styles: Record<ManagerInsightsNarrative["confidenceLevel"], string> = {
    High: "bg-emerald-500/15 text-emerald-200 ring-emerald-500/35",
    Medium: "bg-amber-500/15 text-amber-100 ring-amber-500/35",
    Low: "bg-slate-500/15 text-slate-200 ring-slate-500/40",
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Confidence</span>
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${styles[level]}`}>{level}</span>
      </div>
      <p className="text-xs leading-relaxed text-slate-400">{note}</p>
    </div>
  );
}

export function ManagerScorecard({ filteredRows, onManagerDrillDown }: ManagerScorecardProps) {
  const [sortKey, setSortKey] = useState<SortKey>("avgUtilizationPct");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [selectedManager, setSelectedManager] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [insightNarrative, setInsightNarrative] = useState<ManagerInsightsNarrative | null>(null);

  const managerRows = useMemo(() => aggregateManagers(filteredRows), [filteredRows]);

  const managerNameOptions = useMemo(
    () => [...managerRows].sort((a, b) => a.managerName.localeCompare(b.managerName)).map((r) => r.managerName),
    [managerRows],
  );

  useEffect(() => {
    const names = new Set(managerRows.map((r) => r.managerName));
    if (managerRows.length === 0) {
      setSelectedManager("");
      return;
    }
    if (!selectedManager || !names.has(selectedManager)) {
      const first = [...managerRows].sort((a, b) => a.managerName.localeCompare(b.managerName))[0];
      if (first) {
        setSelectedManager(first.managerName);
      }
    }
  }, [managerRows, selectedManager]);

  useEffect(() => {
    setInsightNarrative(null);
    setInsightError(null);
  }, [selectedManager]);

  const teamRowsForInsights = useMemo(
    () => filteredRows.filter((r) => (r.manager || "Unassigned") === selectedManager),
    [filteredRows, selectedManager],
  );

  const sortedRows = useMemo(() => {
    const healthOrder: Record<ManagerHealthStatus, number> = {
      Overloaded: 2,
      Healthy: 1,
      "Under-utilized": 0,
    };
    return [...managerRows].sort((a, b) => {
      const dir = sortOrder === "asc" ? 1 : -1;
      if (sortKey === "healthStatus") {
        return (healthOrder[a.healthStatus] - healthOrder[b.healthStatus]) * dir;
      }
      const left = a[sortKey];
      const right = b[sortKey];
      if (typeof left === "number" && typeof right === "number") {
        return (left - right) * dir;
      }
      return String(left).localeCompare(String(right)) * dir;
    });
  }, [managerRows, sortKey, sortOrder]);

  const summary = useMemo(() => {
    if (managerRows.length === 0) {
      return {
        highest: null as ManagerScoreRow | null,
        lowest: null as ManagerScoreRow | null,
        variance: 0,
      };
    }
    const sortedByAvg = [...managerRows].sort((a, b) => b.avgUtilizationPct - a.avgUtilizationPct);
    const highest = sortedByAvg[0];
    const lowest = sortedByAvg[sortedByAvg.length - 1];
    const variance = highest.avgUtilizationPct - lowest.avgUtilizationPct;
    return { highest, lowest, variance };
  }, [managerRows]);

  const chartData = useMemo(
    () =>
      [...managerRows]
        .sort((a, b) => a.managerName.localeCompare(b.managerName))
        .map((row) => ({
          name: row.managerName.length > 18 ? `${row.managerName.slice(0, 16)}…` : row.managerName,
          fullName: row.managerName,
          avgUtilizationPct: Number(row.avgUtilizationPct.toFixed(1)),
        })),
    [managerRows],
  );

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortOrder(key === "managerName" ? "asc" : "desc");
    }
  };

  const handleGenerateInsights = async () => {
    if (!selectedManager) {
      return;
    }
    setInsightLoading(true);
    setInsightError(null);
    try {
      const next = await generateManagerInsights(selectedManager, teamRowsForInsights, filteredRows);
      setInsightNarrative(next);
    } catch (e) {
      setInsightError(e instanceof Error ? e.message : "Unable to generate insights.");
      setInsightNarrative(null);
    } finally {
      setInsightLoading(false);
    }
  };

  if (managerRows.length === 0) {
    return (
      <Card className="border-slate-700 bg-slate-950/40">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No manager data in the current filter scope. Upload resource master and timesheet data, or widen filters.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-slate-400">
        Per manager: each direct report&apos;s hours and capacity are rolled up across the selected period, then utilization % is posted ÷ available
        hours for that person. <span className="font-medium text-slate-300">Avg utilization %</span> is the mean of those individual rates (not one
        pooled fraction). <span className="font-medium text-slate-300">Avg posted hrs / person</span> is team posted hours ÷ headcount. Uses Resource
        Master <span className="font-medium text-slate-300">Manager</span> joined to timesheets via Resource ID.
      </p>

      <Card className="border border-amber-500/20 bg-slate-950/60 shadow-[0_0_0_1px_rgba(251,191,36,0.08)]">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-400/25">
              <Sparkles className="h-5 w-5 text-amber-300" aria-hidden />
            </span>
            <div>
              <CardTitle className="text-base text-slate-100">Manager analytical insights</CardTitle>
              <p className="text-xs text-slate-400">
                Choose a manager, then generate a gentle narrative on team performance, strengths, gaps, and practical next steps. Uses the same
                filtered utilization data as the scorecard; when AI is configured (see Executive Intelligence), responses are model-generated.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="min-w-0 w-full max-w-md flex-1">
              <label className="mb-1.5 block text-xs font-medium text-slate-400" htmlFor="manager-insights-select">
                Manager
              </label>
              <Select value={selectedManager} onValueChange={setSelectedManager}>
                <SelectTrigger
                  id="manager-insights-select"
                  className="h-10 w-full border-slate-600 bg-slate-900/95 text-left text-sm text-slate-100 shadow-inner shadow-black/20"
                >
                  <SelectValue placeholder="Select a manager" />
                </SelectTrigger>
                <SelectContent className="border-slate-600">
                  {managerNameOptions.map((name) => (
                    <SelectItem key={name} value={name} className="truncate">
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              className="shrink-0 bg-amber-500/90 text-slate-950 hover:bg-amber-400"
              disabled={!selectedManager || insightLoading}
              onClick={() => void handleGenerateInsights()}
            >
              {insightLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                  Generate insights
                </>
              )}
            </Button>
          </div>
          {insightError ? <p className="text-sm text-red-300">{insightError}</p> : null}
          {insightNarrative ? (
            <div className="space-y-4 rounded-xl border border-slate-700/80 bg-slate-900/40 p-4">
              <ConfidencePill level={insightNarrative.confidenceLevel} note={insightNarrative.confidenceNote} />
              <p className="text-sm leading-relaxed text-slate-100">{insightNarrative.summary}</p>
              <ul className="list-inside list-disc space-y-2 text-sm leading-relaxed text-slate-300 marker:text-amber-400/90">
                {insightNarrative.bullets.map((item, index) => (
                  <li key={`${index}-${item.slice(0, 40)}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Select a manager and click <span className="text-slate-400">Generate insights</span> to run the prompt: how is this manager&apos;s team
              performing, what is working, what is not, and suggested actions — in a soft tone with an explicit confidence level.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-slate-700 bg-slate-950/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300">Highest utilized manager</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold text-slate-100">{summary.highest?.managerName ?? "—"}</p>
            <p className="text-2xl font-bold text-amber-300">{summary.highest ? formatPercent(summary.highest.avgUtilizationPct) : "—"}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-700 bg-slate-950/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300">Lowest utilized manager</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold text-slate-100">{summary.lowest?.managerName ?? "—"}</p>
            <p className="text-2xl font-bold text-slate-300">{summary.lowest ? formatPercent(summary.lowest.avgUtilizationPct) : "—"}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-700 bg-slate-950/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300">Manager variance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-400">Delta (highest − lowest) Avg Utilization</p>
            <p className="text-2xl font-bold text-cyan-300">{formatPercent(summary.variance)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-700 bg-slate-950/40">
        <CardHeader>
          <CardTitle className="text-slate-200">Manager utilization distribution</CardTitle>
          <p className="text-xs text-muted-foreground">Target reference at 80% Avg Utilization</p>
        </CardHeader>
        <CardContent className="h-[min(28rem,50vh)] min-h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 64 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" stroke="#94a3b8" interval={0} angle={-35} textAnchor="end" height={70} tick={{ fontSize: 10 }} />
              <YAxis stroke="#94a3b8" domain={[0, "auto"]} unit="%" />
              <Tooltip
                {...chartTooltipDarkProps}
                labelFormatter={(_, payload) => {
                  const item = payload?.[0]?.payload as { fullName?: string } | undefined;
                  return item?.fullName ?? "";
                }}
                formatter={(value) => {
                  const num = typeof value === "number" ? value : Number(value);
                  const safe = Number.isFinite(num) ? num : 0;
                  return [`${safe}%`, "Avg utilization"];
                }}
              />
              <ReferenceLine y={80} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: "80% target", fill: "#fbbf24", fontSize: 11 }} />
              <Bar dataKey="avgUtilizationPct" fill="#38bdf8" radius={[4, 4, 0, 0]} name="Avg Util %">
                <LabelList
                  dataKey="avgUtilizationPct"
                  position="top"
                  formatter={(v) => `${typeof v === "number" ? v : Number(v)}%`}
                  fill="#e2e8f0"
                  fontSize={10}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-950/40">
        <CardHeader>
          <CardTitle className="text-slate-200">Manager scorecard</CardTitle>
          <p className="text-xs text-muted-foreground">Click a row to open the Global Dashboard filtered to that manager&apos;s team.</p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {(
                  [
                    { key: "managerName" as const, label: "Manager name" },
                    { key: "headcount" as const, label: "Headcount" },
                    { key: "teamTotalPostedHours" as const, label: "Team posted hrs" },
                    { key: "avgPostedHoursPerPerson" as const, label: "Avg posted hrs / person" },
                    { key: "avgUtilizationPct" as const, label: "Avg utilization %" },
                    { key: "healthStatus" as const, label: "Health status" },
                  ] as const
                ).map((col) => (
                  <TableHead key={col.key}>
                    <Button variant="outline" size="sm" className="h-7 gap-1 px-2" onClick={() => handleSort(col.key)}>
                      {col.label}
                      <ArrowUpDown className="h-3 w-3" />
                    </Button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((row) => (
                <TableRow
                  key={row.managerName}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() => onManagerDrillDown(row.managerName)}
                >
                  <TableCell className="font-medium text-slate-100">{row.managerName}</TableCell>
                  <TableCell>{row.headcount}</TableCell>
                  <TableCell>{formatHours(row.teamTotalPostedHours)}</TableCell>
                  <TableCell>{formatHours(row.avgPostedHoursPerPerson)}</TableCell>
                  <TableCell>{formatPercent(row.avgUtilizationPct)}</TableCell>
                  <TableCell>
                    <HealthBadge status={row.healthStatus} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
