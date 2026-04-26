import { AlertTriangle } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { chartTooltipDarkProps } from "../lib/chart-tooltip";
import { formatHours } from "../lib/utils";
import type { PnLModel, ProjectPnLRow } from "../lib/pnl-engine";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

function formatUsd(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function formatMargin(p: number | null) {
  if (p === null || Number.isNaN(p)) {
    return "—";
  }
  return `${p.toFixed(1)}%`;
}

function marginBarColor(m: number | null) {
  if (m === null || Number.isNaN(m)) {
    return "#64748b";
  }
  if (m < 20) {
    return "#f87171";
  }
  if (m > 80) {
    return "#fbbf24";
  }
  return "#34d399";
}

function projectTable(rows: ProjectPnLRow[], title: string) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects with both revenue and labor in scope for this ranking.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Labor cost</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
                <TableHead>Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={`${title}-${p.projectKey}`}>
                  <TableCell className="max-w-[220px] truncate font-medium" title={p.projectName}>
                    {p.projectName || p.projectKey}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatUsd(p.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUsd(p.actualLaborCost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMargin(p.marginPct)}</TableCell>
                  <TableCell>
                    {p.financialOutlier ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-600/50 bg-amber-950/40 px-2 py-0.5 text-xs text-amber-200">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        Financial outlier
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

type PnLDashboardProps = {
  model: PnLModel;
};

export function PnLDashboard({ model }: PnLDashboardProps) {
  const laborLedProjects = [...model.projects]
    .filter((p) => p.actualLaborCost > 0)
    .sort((a, b) => b.actualLaborCost - a.actualLaborCost)
    .slice(0, 15);

  const practiceChartData = model.practiceBuckets.map((b) => ({
    code: b.practice,
    label: b.practice,
    marginPct: b.marginPct ?? 0,
    marginTooltip: b.marginPct === null || Number.isNaN(b.marginPct) ? "—" : `${b.marginPct.toFixed(1)}%`,
    displayMargin: b.marginPct,
  }));

  const outlierProjects = model.projects.filter((p) => p.financialOutlier);

  const { diagnostics } = model;

  return (
    <div className="flex flex-col gap-6">
      {model.periodNote ? (
        <Card className="border-sky-700/50 bg-sky-950/30">
          <CardContent className="py-4 text-sm text-sky-100">{model.periodNote}</CardContent>
        </Card>
      ) : null}

      <Card className="border-slate-600/60 bg-slate-950/40">
        <CardHeader>
          <CardTitle className="text-base text-slate-100">P&amp;L data coverage</CardTitle>
          <p className="text-sm text-slate-400">
            When the revenue workbook names a quarter (JFM, AMJ, JAS, OND), labor is clipped to that calendar window. Otherwise joins use Project
            Investment ↔ Column I; codes and embedded numeric ids still apply as fallbacks.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-slate-200 sm:grid-cols-2 lg:grid-cols-3">
          <p>
            <span className="text-slate-500">Posted + CSBIL lines in window:</span>{" "}
            <span className="font-semibold tabular-nums text-slate-100">{diagnostics.postedCsbilLinesInPeriod}</span>
          </p>
          <p>
            <span className="text-slate-500">Posted hours in window:</span>{" "}
            <span className="font-semibold tabular-nums text-slate-100">{formatHours(diagnostics.postedCsbilHoursInPeriod)} h</span>
          </p>
          <p>
            <span className="text-slate-500">Distinct labor project keys:</span>{" "}
            <span className="font-semibold tabular-nums text-slate-100">{diagnostics.distinctLaborProjectKeys}</span>
          </p>
          <p>
            <span className="text-slate-500">Distinct revenue keys (file):</span>{" "}
            <span className="font-semibold tabular-nums text-slate-100">{diagnostics.distinctRevenueKeys}</span>
          </p>
          <p>
            <span className="text-slate-500">Projects with both revenue &amp; labor:</span>{" "}
            <span className="font-semibold tabular-nums text-emerald-300">{diagnostics.projectsWithRevenueAndLabor}</span>
          </p>
          <p>
            <span className="text-slate-500">Labor rows matched via numeric id hint:</span>{" "}
            <span className="font-semibold tabular-nums text-sky-300">{diagnostics.revenueMatchedByNumericHint}</span>
          </p>
          {diagnostics.periodFallbackUsed ? (
            <p className="text-amber-200/90">Period was auto-widened because the filter window had no eligible lines.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-slate-600/60 bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-lg text-slate-100">P&amp;L summary</CardTitle>
          <p className="text-sm text-slate-400">
            Labor cost uses Posted + CSBIL hours × ARC by Resource HCL GEO OBS (or line GEO / master join). <span className="text-slate-300">Total
            revenue</span> is the sum from your Projectwise upload; overall margin compares that to total ARC labor in scope. Per-project revenue shows
            the amount attributed to each project (code, name, or embedded id match).
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-700/80 bg-slate-950/60 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total revenue</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-emerald-300">{formatUsd(model.totalRevenue)}</p>
          </div>
          <div className="rounded-xl border border-slate-700/80 bg-slate-950/60 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total labor cost (ARC)</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-sky-300">{formatUsd(model.totalLaborCost)}</p>
          </div>
          <div className="rounded-xl border border-slate-700/80 bg-slate-950/60 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Overall margin</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-amber-200">{formatMargin(model.overallMarginPct)}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {projectTable(model.top5ByMargin, "Top 5 projects by margin %")}
        {projectTable(model.bottom5ByMargin, "Bottom 5 projects by margin %")}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Labor by project (top 15 by cost)</CardTitle>
          <p className="text-sm text-muted-foreground">
            Confirms ARC labor is flowing; $0 revenue here means the join key did not match your Projectwise Summary.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {laborLedProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No labor rows in the computed period.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Labor cost</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {laborLedProjects.map((p) => (
                  <TableRow key={`labor-${p.projectKey}`}>
                    <TableCell className="max-w-[240px] truncate font-medium" title={p.projectName}>
                      {p.projectName || p.projectKey}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatHours(p.totalHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(p.actualLaborCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(p.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMargin(p.marginPct)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Margin % by practice (DS / MX / DX)</CardTitle>
          <p className="text-sm text-muted-foreground">
            Revenue allocated by share of classified practice hours per project; labor from timesheet lines mapped to each practice.
          </p>
        </CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={practiceChartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="label" stroke="#cbd5e1" />
              <YAxis unit="%" stroke="#cbd5e1" domain={[0, "auto"]} />
              <Tooltip
                {...chartTooltipDarkProps}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) {
                    return null;
                  }
                  const row = payload[0].payload as { label: string; marginTooltip: string };
                  return (
                    <div
                      style={{
                        ...chartTooltipDarkProps.contentStyle,
                        padding: "8px 12px",
                      }}
                    >
                      <p style={chartTooltipDarkProps.labelStyle}>{row.label}</p>
                      <p style={chartTooltipDarkProps.itemStyle}>Margin %: {row.marginTooltip}</p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="marginPct" name="Margin %" radius={[6, 6, 0, 0]}>
                {practiceChartData.map((entry) => (
                  <Cell key={`cell-${entry.code}`} fill={marginBarColor(entry.displayMargin)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {(model.unmatchedLaborProjects.length > 0 || model.unmatchedRevenueProjects.length > 0) && (
        <Card className="border-amber-900/40 bg-amber-950/10">
          <CardHeader>
            <CardTitle className="text-base text-amber-100">Data integrity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-amber-100/90 md:grid-cols-2">
            {model.unmatchedLaborProjects.length > 0 && (
              <div>
                <p className="font-medium text-amber-200">Labor with no matching revenue key (sample)</p>
                <ul className="mt-2 list-inside list-disc text-xs text-amber-100/80">
                  {model.unmatchedLaborProjects.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
            {model.unmatchedRevenueProjects.length > 0 && (
              <div>
                <p className="font-medium text-amber-200">Revenue with no matching labor in period (sample)</p>
                <ul className="mt-2 list-inside list-disc text-xs text-amber-100/80">
                  {model.unmatchedRevenueProjects.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {outlierProjects.length > 0 && (
        <Card className="border-slate-600/60">
          <CardHeader>
            <CardTitle className="text-base">Financial outliers (margin &lt; 20% or &gt; 80%)</CardTitle>
            <p className="text-sm text-muted-foreground">Flagged for manual review per policy.</p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Labor</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outlierProjects.map((p) => (
                  <TableRow key={`out-${p.projectKey}`}>
                    <TableCell className="max-w-[260px] truncate" title={p.projectName}>
                      {p.projectName || p.projectKey}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(p.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(p.actualLaborCost)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium text-amber-200">{formatMargin(p.marginPct)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
