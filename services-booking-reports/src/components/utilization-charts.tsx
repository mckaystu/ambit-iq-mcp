"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
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

type UtilizationPoint = {
  label: string;
  postedHours: number;
  availableHours: number;
  utilizationPct: number;
};

type UtilizationTrendPoint = {
  month: string;
  postedHours: number;
  availableHours: number;
  utilizationPct: number;
};

type Props = {
  byGeo: UtilizationPoint[];
  byPractice: UtilizationPoint[];
  trend: UtilizationTrendPoint[];
};

function asFiniteNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function utilizationBandColor(value: number): string {
  if (value > 90) return "#dc2626";
  if (value >= 70) return "#059669";
  return "#d97706";
}

const PRODUCT_COLORS: Record<"Domino+" | "DX" | "MX" | "Commerce" | "Unica", string> = {
  "Domino+": "#2563eb",
  DX: "#06b6d4",
  MX: "#8b5cf6",
  Commerce: "#f59e0b",
  Unica: "#ec4899",
};

function productColorFromPractice(label: string): string {
  const v = label.toLowerCase();
  if (v.includes("unica")) return PRODUCT_COLORS.Unica;
  if (v.includes("commerce")) return PRODUCT_COLORS.Commerce;
  if (v.includes("mx") || v.includes("voltmx")) return PRODUCT_COLORS.MX;
  if (
    v.includes("dx") ||
    v.includes("digital experience") ||
    v.includes("digital experince") ||
    v.includes("digital exper") ||
    v.includes("tx")
  ) {
    return PRODUCT_COLORS.DX;
  }
  return PRODUCT_COLORS["Domino+"];
}

export default function UtilizationCharts({ byGeo, byPractice, trend }: Props) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Utilization % by GEO</h3>
        <p className="mb-3 text-xs text-slate-500">Amber under 70%, green 70-90%, red above 90%.</p>
        <div className="h-72 min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart data={byGeo}>
              <CartesianGrid {...HCL_CHART_GRID} />
              <XAxis dataKey="label" stroke={HCL_CHART_AXIS_STROKE} tick={HCL_CHART_TICK} />
              <YAxis stroke={HCL_CHART_AXIS_STROKE} tick={HCL_CHART_TICK} unit="%" />
              <Tooltip formatter={(value) => [`${asFiniteNumber(value).toFixed(1)}%`, "Utilization"]} {...HCL_CHART_TOOLTIP} />
              <Bar dataKey="utilizationPct" radius={[4, 4, 0, 0]}>
                {byGeo.map((entry) => (
                  <Cell key={entry.label} fill={utilizationBandColor(entry.utilizationPct)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Utilization % by Practice</h3>
        <p className="mb-3 text-xs text-slate-500">Top 12 practices by posted hours.</p>
        <div className="h-72 min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart data={byPractice}>
              <CartesianGrid {...HCL_CHART_GRID} />
              <XAxis
                dataKey="label"
                stroke={HCL_CHART_AXIS_STROKE}
                tick={HCL_CHART_TICK}
                interval={0}
                angle={-30}
                textAnchor="end"
                height={60}
              />
              <YAxis stroke={HCL_CHART_AXIS_STROKE} tick={HCL_CHART_TICK} unit="%" />
              <Tooltip formatter={(value) => [`${asFiniteNumber(value).toFixed(1)}%`, "Utilization"]} {...HCL_CHART_TOOLTIP} />
              <Bar dataKey="utilizationPct" radius={[4, 4, 0, 0]}>
                {byPractice.map((entry) => (
                  <Cell key={entry.label} fill={productColorFromPractice(entry.label)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">Utilization Trend</h3>
        <div className="h-80 min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={trend}>
              <CartesianGrid {...HCL_CHART_GRID} />
              <XAxis dataKey="month" stroke={HCL_CHART_AXIS_STROKE} tick={HCL_CHART_TICK} />
              <YAxis yAxisId="left" stroke={HCL_CHART_AXIS_STROKE} tick={HCL_CHART_TICK} unit="%" />
              <YAxis yAxisId="right" orientation="right" stroke={HCL_CHART_AXIS_STROKE} tick={HCL_CHART_TICK} />
              <Tooltip
                formatter={(value, name) => {
                  const amount = asFiniteNumber(value);
                  if (name === "utilizationPct") return [`${amount.toFixed(1)}%`, "Utilization"];
                  return [amount.toFixed(1), name === "postedHours" ? "Posted Hours" : "Available Hours"];
                }}
                {...HCL_CHART_TOOLTIP}
              />
              <Legend {...HCL_CHART_LEGEND} />
              <Line yAxisId="left" type="monotone" dataKey="utilizationPct" name="Utilization %" stroke="#0284c7" strokeWidth={3} />
              <Line yAxisId="right" type="monotone" dataKey="postedHours" name="Posted Hours" stroke="#16a34a" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="availableHours" name="Available Hours" stroke="#475569" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </article>
    </section>
  );
}
