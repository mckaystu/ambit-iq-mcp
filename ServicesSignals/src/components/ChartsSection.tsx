import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { chartTooltipDarkProps } from "../lib/chart-tooltip";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

type ChartDatum = {
  label: string;
  averageUtilizationPct: number;
};

type TrendDatum = {
  date: string;
  averageUtilizationPct: number;
};

type ChartsSectionProps = {
  byGeo: ChartDatum[];
  byPractice: ChartDatum[];
  trend: TrendDatum[];
};

export function ChartsSection({ byGeo, byPractice, trend }: ChartsSectionProps) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <Card className="border-slate-700 bg-slate-950/40">
        <CardHeader>
          <CardTitle className="text-slate-200">Utilization % by GEO</CardTitle>
        </CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byGeo}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="label" stroke="#cbd5e1" />
              <YAxis unit="%" stroke="#cbd5e1" />
              <Tooltip {...chartTooltipDarkProps} />
              <Legend />
              <Bar dataKey="averageUtilizationPct" name="Utilization %" fill="#22d3ee" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-950/40">
        <CardHeader>
          <CardTitle className="text-slate-200">Utilization % by Practice</CardTitle>
        </CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byPractice}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="label" stroke="#cbd5e1" />
              <YAxis unit="%" stroke="#cbd5e1" />
              <Tooltip {...chartTooltipDarkProps} />
              <Legend />
              <Bar
                dataKey="averageUtilizationPct"
                name="Utilization %"
                fill="#fde047"
                stroke="#fef08a"
                strokeWidth={1}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-950/40 lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-slate-200">Utilization Trend</CardTitle>
        </CardHeader>
        <CardContent className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#cbd5e1" />
              <YAxis unit="%" stroke="#cbd5e1" />
              <Tooltip {...chartTooltipDarkProps} />
              <Legend />
              <Line
                type="monotone"
                dataKey="averageUtilizationPct"
                name="Utilization %"
                stroke="#f8fafc"
                strokeWidth={3}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </section>
  );
}
