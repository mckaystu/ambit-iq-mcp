"use client";

import { type ReactNode, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { ProcessedDataset } from "@/types/opportunity";

type UtilizationData = ProcessedDataset["utilization"];
type TabKey = "dashboard" | "scorecard" | "audit" | "compliance" | "pnl";

const COLORS = ["#2563eb", "#f59e0b", "#22c55e", "#a855f7", "#06b6d4"];

export default function ServicesSignalsWorkspace({ utilization }: { utilization: UtilizationData }) {
  const [tab, setTab] = useState<TabKey>("dashboard");

  const health = useMemo(() => {
    const issues: string[] = [];
    if (!utilization.sourceFiles.timesheet) issues.push("Timesheet file missing");
    if (!utilization.sourceFiles.resource) issues.push("Resource master file missing");
    if (utilization.scope.postedCsbilRows === 0) issues.push("No Posted+CSBIL lines in scope");
    return {
      score: Math.max(0, 100 - issues.length * 30),
      issues,
    };
  }, [utilization]);

  const monthlyForChart: Array<{ month: string; capacity: number } & Record<string, number | string>> =
    utilization.monthlyWorkVsCapacity.map((row) => ({
      month: String(row.month),
      capacity: Number(row.capacity ?? 0),
      ...Object.fromEntries(utilization.monthlyProductKeys.map((key) => [key, Number(row[key] ?? 0)])),
    }));

  return (
    <section className="rounded-xl border border-slate-300 bg-slate-950 p-5 text-slate-100 shadow">
      <div className="mb-4 rounded-lg border border-slate-700 bg-slate-900 p-4">
        <p className="text-xs uppercase tracking-wider text-slate-400">Executive Insights Header</p>
        <h3 className="text-xl font-semibold text-amber-300">ServicesSignals Workspace</h3>
        <p className="text-sm text-slate-300">
          Posted + CSBIL utilization with region-adjusted monthly availability and integrated scorecard, audit, compliance, and P&L views.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["dashboard", "Global Dashboard"],
          ["scorecard", "Manager Scorecard"],
          ["audit", "Data Validation & Audit"],
          ["compliance", "Compliance"],
          ["pnl", "P&L"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value as TabKey)}
            className={`rounded-md px-3 py-2 text-sm ${
              tab === value ? "bg-amber-400 text-slate-900" : "bg-slate-800 text-slate-100 hover:bg-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "dashboard" ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Metric title="Overall Utilization" value={`${utilization.overallUtilizationPct.toFixed(1)}%`} />
            <Metric title="Posted Hours" value={utilization.totalPostedHours.toFixed(0)} />
            <Metric title="Available Hours" value={utilization.totalAvailableHours.toFixed(0)} />
            <Metric title="Resources In Scope" value={String(utilization.scope.distinctResources)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Utilization Trend">
              <ChartWrap>
                <LineChart data={utilization.trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="month" stroke="#cbd5e1" />
                  <YAxis stroke="#cbd5e1" />
                  <Tooltip />
                  <Line type="monotone" dataKey="utilizationPct" stroke="#34d399" strokeWidth={2} />
                </LineChart>
              </ChartWrap>
            </Card>
            <Card title="Work By Product">
              <ChartWrap>
                <BarChart data={utilization.workByProduct}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" stroke="#cbd5e1" />
                  <YAxis stroke="#cbd5e1" />
                  <Tooltip />
                  <Bar dataKey="value">
                    {utilization.workByProduct.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartWrap>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "scorecard" ? (
        <Card title="Manager Scorecard">
          <SimpleTable
            headers={["Manager", "Utilization %", "Posted", "Available", "Headcount"]}
            rows={utilization.managers.slice(0, 20).map((m) => [
              m.manager,
              m.utilizationPct.toFixed(1),
              m.postedHours.toFixed(0),
              m.availableHours.toFixed(0),
              String(m.headcount),
            ])}
          />
        </Card>
      ) : null}

      {tab === "audit" ? (
        <Card title="Data Validation & Audit">
          <div className="grid gap-3 md:grid-cols-3">
            <Metric title="Period Start" value={utilization.scope.periodStart?.slice(0, 10) ?? "n/a"} />
            <Metric title="Period End" value={utilization.scope.periodEnd?.slice(0, 10) ?? "n/a"} />
            <Metric title="Posted+CSBIL Rows" value={String(utilization.scope.postedCsbilRows)} />
          </div>
          <p className="mt-3 text-sm text-slate-300">
            Validation runs on Posted + CSBIL records and monthly availability per ServicesSignals holiday and geo-hour rules.
          </p>
        </Card>
      ) : null}

      {tab === "compliance" ? (
        <div className="space-y-4">
          <Card title="Compliance Overview">
            <p className="text-sm text-slate-300">
              Data confidence {health.score}% with {health.issues.length} flagged issue(s).
            </p>
            <ul className="mt-2 list-disc pl-5 text-sm text-slate-300">
              {health.issues.length ? health.issues.map((issue) => <li key={issue}>{issue}</li>) : <li>No major integrity issues detected.</li>}
            </ul>
          </Card>
          <Card title="Late Submission Heatmap">
            <div className="overflow-auto rounded border border-slate-700">
              <table className="w-full text-xs">
                <thead className="bg-slate-800 text-slate-200">
                  <tr>
                    <th className="p-2 text-left">Month</th>
                    {utilization.monthlyProductKeys.slice(0, 5).map((key) => (
                      <th key={key} className="p-2 text-right">{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthlyForChart.map((row) => (
                    <tr key={row.month} className="border-t border-slate-700">
                      <td className="p-2">{row.month}</td>
                      {utilization.monthlyProductKeys.slice(0, 5).map((key) => (
                        <td key={`${row.month}-${key}`} className="p-2 text-right">{Number(row[key]).toFixed(0)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "pnl" ? (
        <div className="space-y-4">
          <Card title="P&L - Work vs Capacity">
            <ChartWrap>
              <BarChart data={monthlyForChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" stroke="#cbd5e1" />
                <YAxis stroke="#cbd5e1" />
                <Tooltip />
                {utilization.monthlyProductKeys.slice(0, 5).map((key, idx) => (
                  <Bar key={key} dataKey={key} stackId="work" fill={COLORS[idx % COLORS.length]} />
                ))}
                <Line type="monotone" dataKey="capacity" stroke="#e2e8f0" strokeWidth={2} />
              </BarChart>
            </ChartWrap>
          </Card>
          <Card title="P&L Tabs">
            <p className="text-sm text-slate-300">
              Product/practice allocation is derived from mapped practice labels (including typo handling for &quot;Digital Experince&quot;) and aligned to monthly capacity.
            </p>
          </Card>
        </div>
      ) : null}

      <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900 p-4">
        <p className="text-xs uppercase tracking-wider text-slate-400">Data Health Panel</p>
        <p className="text-sm text-slate-200">Score: {health.score}%</p>
      </div>
    </section>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{title}</p>
      <p className="mt-1 text-lg font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
      <h4 className="mb-3 text-sm font-semibold text-slate-100">{title}</h4>
      {children}
    </div>
  );
}

function ChartWrap({ children }: { children: ReactNode }) {
  return <div className="h-72"><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>;
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-auto rounded border border-slate-700">
      <table className="w-full text-sm">
        <thead className="bg-slate-800 text-slate-200">
          <tr>
            {headers.map((header) => (
              <th key={header} className="p-2 text-left">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="border-t border-slate-700">
              {row.map((value, cellIdx) => (
                <td key={`${idx}-${cellIdx}`} className="p-2">{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
