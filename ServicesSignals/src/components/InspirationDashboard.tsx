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

import { chartTooltipDarkProps } from "../lib/chart-tooltip";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

type WorkByType = {
  name: string;
  value: number;
};

type TopResource = {
  resourceName: string;
  utilizationPct: number;
};

type StackedDatum = {
  month: string;
  capacity: number;
  [key: string]: string | number;
};

type InspirationDashboardProps = {
  overallUtilizationPct: number;
  totalHoursPosted: number;
  totalAvailableHours: number;
  workByType: WorkByType[];
  topResources: TopResource[];
  stackedWorkVsCapacity: StackedDatum[];
  stackedPracticeKeys: string[];
};

const COLORS = ["#f59e0b", "#eab308", "#14b8a6", "#0f766e", "#334155", "#64748b", "#94a3b8", "#a3a3a3"];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getColorByKey(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function InspirationDashboard({
  overallUtilizationPct,
  totalHoursPosted,
  totalAvailableHours,
  workByType,
  topResources,
  stackedWorkVsCapacity,
  stackedPracticeKeys,
}: InspirationDashboardProps) {
  const normalizedUtilization = clamp(overallUtilizationPct, 0, 100);
  const availabilityScore = clamp(100 - normalizedUtilization, 0, 100);
  const workVsCapacityPct = totalAvailableHours > 0 ? clamp((totalHoursPosted / totalAvailableHours) * 100, 0, 100) : 0;
  const highestAllocated = topResources[0];
  const dominantWorkType = workByType[0];
  const totalWorkTypeHours = workByType.reduce((acc, item) => acc + item.value, 0);

  return (
    <section className="space-y-4 rounded-2xl border border-slate-700/70 bg-slate-900/40 p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-slate-100">Executive Allocation Snapshot</h2>
        <p className="text-xs text-slate-400">Project management dashboard with resource allocation insights</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="border-slate-700 bg-slate-950/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-300">% of availability</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                data={[{ value: availabilityScore }]}
                startAngle={180}
                endAngle={0}
                innerRadius="65%"
                outerRadius="100%"
                barSize={20}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar dataKey="value" cornerRadius={8} fill="#f59e0b" background={{ fill: "#1f2937" }} />
                <text x="50%" y="56%" textAnchor="middle" className="fill-slate-100 text-xl font-semibold">
                  {availabilityScore.toFixed(0)}/100
                </text>
                <text x="50%" y="68%" textAnchor="middle" className="fill-slate-400 text-xs">
                  Overall
                </text>
              </RadialBarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-slate-700 bg-slate-950/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-300">Work by project type</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={workByType}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={92}
                  paddingAngle={2}
                  stroke="none"
                  label={({ name }) => name}
                >
                  {workByType.map((entry) => (
                    <Cell key={entry.name} fill={getColorByKey(entry.name)} />
                  ))}
                </Pie>
                <Tooltip {...chartTooltipDarkProps} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-slate-700 bg-slate-950/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-300">Work vs capacity</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                data={[{ value: workVsCapacityPct }]}
                startAngle={180}
                endAngle={0}
                innerRadius="65%"
                outerRadius="100%"
                barSize={20}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar dataKey="value" cornerRadius={8} fill="#0f766e" background={{ fill: "#1f2937" }} />
                <text x="50%" y="56%" textAnchor="middle" className="fill-slate-100 text-xl font-semibold">
                  {totalHoursPosted.toFixed(0)}h / {totalAvailableHours.toFixed(0)}h
                </text>
                <text x="50%" y="68%" textAnchor="middle" className="fill-slate-400 text-xs">
                  {workVsCapacityPct.toFixed(1)}%
                </text>
              </RadialBarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-slate-700 bg-slate-950/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-300">Top allocated resource</CardTitle>
          </CardHeader>
          <CardContent className="max-h-64 overflow-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resource name</TableHead>
                  <TableHead className="text-right">Utilization</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topResources.map((row) => (
                  <TableRow key={row.resourceName}>
                    <TableCell className="truncate">{row.resourceName}</TableCell>
                    <TableCell className="text-right">{row.utilizationPct.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-700 bg-slate-950/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-300">Work vs capacity by month</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1fr_250px]">
          <div className="h-[25rem]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stackedWorkVsCapacity}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip {...chartTooltipDarkProps} />
                <Legend />
                {stackedPracticeKeys.map((key) => (
                  <Bar key={key} dataKey={key} stackId="work" fill={getColorByKey(key)} />
                ))}
                <Line type="monotone" dataKey="capacity" stroke="#f8fafc" strokeWidth={2.5} dot={false} name="Capacity" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-4">
            <div className="rounded-md border border-slate-700 bg-slate-900/60 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Key insights</p>
              <ul className="mt-2 space-y-2 text-sm text-slate-200">
                <li>
                  Overall utilization is <span className="font-semibold text-amber-300">{normalizedUtilization.toFixed(1)}%</span>.
                </li>
                <li>
                  Capacity consumed is <span className="font-semibold text-emerald-300">{workVsCapacityPct.toFixed(1)}%</span>.
                </li>
                {dominantWorkType && totalWorkTypeHours > 0 && (
                  <li>
                    Largest work type:{" "}
                    <span className="font-semibold text-slate-100">
                      {dominantWorkType.name} ({((dominantWorkType.value / totalWorkTypeHours) * 100).toFixed(1)}%)
                    </span>
                    .
                  </li>
                )}
                {highestAllocated && (
                  <li>
                    Top allocated resource:{" "}
                    <span className="font-semibold text-slate-100">
                      {highestAllocated.resourceName} ({highestAllocated.utilizationPct.toFixed(1)}%)
                    </span>
                    .
                  </li>
                )}
              </ul>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-900/60 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Work type legend</p>
              <div className="mt-2 max-h-48 space-y-2 overflow-auto text-xs">
                {stackedPracticeKeys.map((key) => (
                  <div key={key} className="flex items-center gap-2 text-slate-300">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: getColorByKey(key) }} />
                    <span className="truncate">{key}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
