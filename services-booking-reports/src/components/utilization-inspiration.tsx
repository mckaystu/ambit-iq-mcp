"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  HCL_CHART_AXIS_STROKE,
  HCL_CHART_GRID,
  HCL_CHART_LEGEND,
  HCL_CHART_TICK,
  HCL_CHART_TOOLTIP,
} from "@/lib/hcl-chart-theme";

type WorkSlice = { name: string; value: number };
type TopResource = { resourceName: string; utilizationPct: number };
type MonthlyPoint = ({ month: string; capacity: number } & Record<string, number | string>);

type Props = {
  overallUtilizationPct: number;
  totalPostedHours: number;
  totalAvailableHours: number;
  workByProduct: WorkSlice[];
  topResources: TopResource[];
  monthlyWorkVsCapacity: MonthlyPoint[];
  monthlyProductKeys: string[];
};

const COLORS = ["#0f766e", "#0ea5e9", "#eab308", "#f97316", "#8b5cf6", "#94a3b8"];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function colorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length] ?? "#0ea5e9";
}

function asFiniteNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

export default function UtilizationInspiration({
  overallUtilizationPct,
  totalPostedHours,
  totalAvailableHours,
  workByProduct,
  topResources,
  monthlyWorkVsCapacity,
  monthlyProductKeys,
}: Props) {
  const availabilityScore = clamp(100 - overallUtilizationPct, 0, 100);
  const workVsCapacityPct = totalAvailableHours > 0 ? clamp((totalPostedHours / totalAvailableHours) * 100, 0, 100) : 0;

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">Utilization Snapshot</h2>
        <p className="text-xs text-slate-500">Utilization-only signals from timesheet and resource data</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-600">% Availability</p>
          <div className="h-44 min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <RadialBarChart data={[{ value: availabilityScore }]} startAngle={180} endAngle={0} innerRadius="65%" outerRadius="100%" barSize={18}>
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar dataKey="value" cornerRadius={8} fill="#f59e0b" background={{ fill: "#334155" }} />
                <text x="50%" y="58%" textAnchor="middle" className="fill-slate-100 text-xl font-semibold">
                  {availabilityScore.toFixed(0)}
                </text>
              </RadialBarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-600">Work by Product</p>
          <div className="h-44 min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <PieChart>
                <Pie data={workByProduct} dataKey="value" nameKey="name" innerRadius={30} outerRadius={65} stroke="none">
                  {workByProduct.map((entry) => (
                    <Cell key={entry.name} fill={colorForKey(entry.name)} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [`${asFiniteNumber(value).toFixed(1)}h`, "Posted Hours"]} {...HCL_CHART_TOOLTIP} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-600">Work vs Capacity</p>
          <div className="h-44 min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <RadialBarChart data={[{ value: workVsCapacityPct }]} startAngle={180} endAngle={0} innerRadius="65%" outerRadius="100%" barSize={18}>
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar dataKey="value" cornerRadius={8} fill="#0f766e" background={{ fill: "#334155" }} />
                <text x="50%" y="58%" textAnchor="middle" className="fill-slate-100 text-base font-semibold">
                  {workVsCapacityPct.toFixed(1)}%
                </text>
              </RadialBarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-600">Top Utilized Resources</p>
          <div className="max-h-44 overflow-auto rounded border border-slate-600/80 bg-slate-950/50">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-800/95 text-slate-300">
                <tr>
                  <th className="p-1.5 text-left">Resource</th>
                  <th className="p-1.5 text-right">Util %</th>
                </tr>
              </thead>
              <tbody>
                {topResources.map((row) => (
                  <tr key={row.resourceName} className="border-t border-slate-700/80">
                    <td className="p-1.5 text-slate-200">{row.resourceName}</td>
                    <td className="p-1.5 text-right font-semibold text-slate-100">{row.utilizationPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="mb-2 text-sm font-semibold text-slate-800">Work vs Capacity by Month</p>
        <div className="h-80 min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart data={monthlyWorkVsCapacity}>
              <CartesianGrid {...HCL_CHART_GRID} />
              <XAxis dataKey="month" stroke={HCL_CHART_AXIS_STROKE} tick={HCL_CHART_TICK} />
              <YAxis stroke={HCL_CHART_AXIS_STROKE} tick={HCL_CHART_TICK} />
              <Tooltip {...HCL_CHART_TOOLTIP} />
              <Legend {...HCL_CHART_LEGEND} />
              {monthlyProductKeys.map((key) => (
                <Bar key={key} dataKey={key} stackId="work" fill={colorForKey(key)} />
              ))}
              <Line type="monotone" dataKey="capacity" stroke="#94a3b8" strokeWidth={2.5} dot={false} name="Capacity" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>
    </section>
  );
}
