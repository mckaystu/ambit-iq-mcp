"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  CartesianGrid,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownUp,
  Filter,
  LayoutDashboard,
  Target,
  TrendingUp,
  Upload,
  Users,
} from "lucide-react";
import {
  HCL_CHART_AXIS_STROKE,
  HCL_CHART_GRID,
  HCL_CHART_LEGEND,
  HCL_CHART_TICK,
  HCL_CHART_TOOLTIP,
} from "@/lib/hcl-chart-theme";
import {
  BOOKING_PRODUCT_DISPLAY_ORDER,
  bookingDisplayProductForRecord,
} from "@/lib/booking-display-product";
import { getFiscalPeriod } from "@/lib/fiscal-period";
import type { ProcessedDataset, SortDirection } from "@/types/opportunity";
import { BookingIntelligenceBriefing } from "@/components/booking-intelligence-briefing";
import { HclSignalsNav } from "@/components/hcl-signals-nav";

type DashboardProps = {
  dataset: ProcessedDataset;
  view?: "overview" | "lineByLine";
};

const DEFAULT_SERVICE_CATEGORIES = [
  "Digital Solutions & Collaboration",
  "Marketing",
  "Commerce",
];
const QUARTER_ORDER = ["AMJ", "JAS", "OND", "JFM"] as const;

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatCurrencyTooltip(value: unknown): string {
  const num = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(num)) return CURRENCY.format(0);
  return CURRENCY.format(num);
}

function startOfWeek(date: Date): Date {
  const clone = new Date(date);
  const day = clone.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  clone.setDate(clone.getDate() + diff);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

function stageBucket(stageOrder: number): "booked" | "commit" | "upside" | "pipeline" {
  if (stageOrder >= 4) return "booked";
  if (stageOrder === 3) return "commit";
  if (stageOrder === 2) return "upside";
  return "pipeline";
}

type ForecastRevenueBucket = "booked" | "commit" | "upside" | "pipeline";

/** Maps **Sales Forecast Stage** (e.g. `2 - Upside`) to the revenue column that should show booking dollars. */
function forecastRevenueBucket(salesForecastState: string): ForecastRevenueBucket | null {
  const raw = salesForecastState.trim();
  if (!raw || raw === "-" || raw === "—") return null;
  const t = raw.toLowerCase();
  const stageMatch = t.match(/stage\s*([1-4])/);
  if (stageMatch?.[1] === "4") return "booked";
  if (stageMatch?.[1] === "3") return "commit";
  if (stageMatch?.[1] === "2") return "upside";
  if (stageMatch?.[1] === "1") return "pipeline";
  if (/^4\s*[-–—]\s*booked\b/i.test(raw) || (t.startsWith("4") && t.includes("book"))) return "booked";
  if (/^3\s*[-–—]\s*commit\b/i.test(raw) || (t.startsWith("3") && t.includes("commit"))) return "commit";
  if (/^2\s*[-–—]\s*upside\b/i.test(raw) || (t.startsWith("2") && t.includes("upside"))) return "upside";
  if (/^1\s*[-–—]\s*pipeline\b/i.test(raw) || (t.startsWith("1") && t.includes("pipeline"))) {
    return "pipeline";
  }
  const lead = t.match(/^(\d)/);
  if (lead?.[1] === "4") return "booked";
  if (lead?.[1] === "3") return "commit";
  if (lead?.[1] === "2") return "upside";
  if (lead?.[1] === "1") return "pipeline";
  return null;
}

function forecastStageColumnValue(
  rowRevenue: number,
  salesForecastState: string,
  target: ForecastRevenueBucket
): string {
  return forecastRevenueBucket(salesForecastState) === target ? CURRENCY.format(rowRevenue) : "-";
}

function isUnicaDeal(record: ProcessedDataset["records"][number]): boolean {
  const fields = [
    record.name,
    record.serviceCategory,
    record.subServiceCategory,
    record.owner,
    record.hclOpportunityOwner,
    record.pipelineStage,
  ];
  return fields.some((value) => value.toLowerCase().includes("unica"));
}

const PRODUCT_COLORS: Record<(typeof BOOKING_PRODUCT_DISPLAY_ORDER)[number], string> = {
  "Domino+": "#b28900",
  DX: "#0f62fe",
  MX: "#f97316",
  Commerce: "#24a148",
  Unica: "#8a3ffc",
};
const ENCHANTED_BG =
  "radial-gradient(1200px 420px at 10% -10%, rgba(45,212,191,0.25), transparent 55%), radial-gradient(1000px 520px at 90% -20%, rgba(167,139,250,0.22), transparent 58%), linear-gradient(180deg, #0b2345 0%, #102548 28%, #101b3a 62%, #0f172a 100%)";
const ENCHANTED_ACCENT = "#2dd4bf";
const SURFACE_CARD =
  "rounded-2xl border border-cyan-300/20 bg-gradient-to-b from-[#0f2f58]/85 via-[#10284b]/82 to-[#161b35]/78 p-5 shadow-[0_10px_40px_rgba(0,0,0,0.35)] backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:border-fuchsia-300/35 hover:shadow-[0_14px_42px_rgba(0,0,0,0.45)]";

function weekLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** WoW: latest week with positive pipeline total vs latest prior week with positive total (skips empty weeks). */
function pickWeekOnWeekSnapshot(rows: { total: number; week: string }[]): {
  current: number;
  previous: number;
  growth: number | null;
  delta: number;
  currentWeekLabel: string;
  previousWeekLabel: string;
} | null {
  if (rows.length < 2) {
    return null;
  }

  let currentIdx = rows.length - 1;
  while (currentIdx >= 0 && (rows[currentIdx]?.total ?? 0) <= 0) {
    currentIdx -= 1;
  }
  if (currentIdx < 0) {
    currentIdx = rows.length - 1;
  }

  let previousIdx = currentIdx - 1;
  while (previousIdx >= 0 && (rows[previousIdx]?.total ?? 0) <= 0) {
    previousIdx -= 1;
  }
  if (previousIdx < 0) {
    previousIdx = currentIdx - 1;
  }
  if (previousIdx < 0) {
    return null;
  }

  const current = rows[currentIdx]?.total ?? 0;
  const previous = rows[previousIdx]?.total ?? 0;
  const growth = previous === 0 ? null : ((current - previous) / previous) * 100;
  return {
    current,
    previous,
    growth,
    delta: current - previous,
    currentWeekLabel: rows[currentIdx]?.week ?? "",
    previousWeekLabel: rows[previousIdx]?.week ?? "",
  };
}

function nextFiscalQuarter(
  fiscalYear: number,
  quarter: (typeof QUARTER_ORDER)[number]
): { fiscalYear: number; quarter: (typeof QUARTER_ORDER)[number] } {
  const idx = QUARTER_ORDER.indexOf(quarter);
  const nextIdx = (idx + 1) % QUARTER_ORDER.length;
  const wrapsYear = quarter === "OND";
  return {
    fiscalYear: wrapsYear ? fiscalYear + 1 : fiscalYear,
    quarter: QUARTER_ORDER[nextIdx]!,
  };
}

const LINE_BY_LINE_MULTI_SUMMARY =
  "list-none cursor-pointer rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50";
const LINE_BY_LINE_MULTI_PANEL =
  "absolute left-0 z-20 mt-1 w-56 rounded-md border border-slate-200 bg-white p-2 shadow-lg";
const LINE_BY_LINE_MULTI_LIST = "max-h-40 space-y-1 overflow-auto pr-1 text-[11px] font-normal";

function LineByLineColumnMultiSelect(props: {
  summaryEmpty: string;
  summarySelected: (count: number) => string;
  allLabel: string;
  options: readonly string[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  summaryIcon?: ReactNode;
  panelClassName?: string;
}) {
  const {
    summaryEmpty,
    summarySelected,
    allLabel,
    options,
    selected,
    onChange,
    summaryIcon,
    panelClassName,
  } = props;
  const summary =
    selected.length === 0 ? summaryEmpty : summarySelected(selected.length);
  return (
    <details className="group relative">
      <summary className={`flex items-center gap-1.5 ${LINE_BY_LINE_MULTI_SUMMARY}`}>
        {summaryIcon}
        <span className="truncate">{summary}</span>
      </summary>
      <div className={`${LINE_BY_LINE_MULTI_PANEL} ${panelClassName ?? ""}`}>
        <div className={LINE_BY_LINE_MULTI_LIST}>
          <label className="mb-1 flex items-center gap-2 rounded px-1.5 py-1 text-slate-700 hover:bg-slate-50">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-blue-600"
              checked={selected.length === 0}
              onChange={(e) => {
                if (e.target.checked) onChange([]);
              }}
            />
            <span className="font-medium">{allLabel}</span>
          </label>
          {options.map((value) => (
            <label
              key={value}
              className="flex items-center gap-2 rounded px-1.5 py-1 text-slate-700 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-blue-600"
                checked={selected.includes(value)}
                onChange={(e) => {
                  onChange(
                    e.target.checked
                      ? [...selected, value]
                      : selected.filter((item) => item !== value)
                  );
                }}
              />
              <span className="truncate" title={value}>
                {value}
              </span>
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}

function matchesForecastStageColumnFilter(
  selected: readonly ("withValue" | "blank")[],
  target: ForecastRevenueBucket,
  salesForecastState: string
): boolean {
  const bucket = forecastRevenueBucket(salesForecastState);
  const hasValueInCell = bucket === target;
  if (selected.length === 0 || selected.length >= 2) return true;
  if (selected.includes("withValue")) return hasValueInCell;
  if (selected.includes("blank")) return !hasValueInCell;
  return true;
}

function LineByLineStageBucketMultiSelect(props: {
  columnLabel: string;
  selected: ("withValue" | "blank")[];
  onChange: (next: ("withValue" | "blank")[]) => void;
}) {
  const { columnLabel, selected, onChange } = props;
  const summary =
    selected.length === 0 || selected.length >= 2
      ? `All ${columnLabel}`
      : selected.includes("withValue")
        ? "Has value"
        : "Blank";
  return (
    <details className="group relative">
      <summary className={LINE_BY_LINE_MULTI_SUMMARY}>
        <span className="truncate">{summary}</span>
      </summary>
      <div className={LINE_BY_LINE_MULTI_PANEL}>
        <div className={`${LINE_BY_LINE_MULTI_LIST} normal-case`}>
          <label className="mb-1 flex items-center gap-2 rounded px-1.5 py-1 text-slate-700 hover:bg-slate-50">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-blue-600"
              checked={selected.length === 0 || selected.length >= 2}
              onChange={(e) => {
                if (e.target.checked) onChange([]);
              }}
            />
            <span className="font-medium">All</span>
          </label>
          {(
            [
              { key: "withValue" as const, label: "Has value" },
              { key: "blank" as const, label: "Blank" },
            ] as const
          ).map(({ key, label }) => (
            <label
              key={key}
              className="flex items-center gap-2 rounded px-1.5 py-1 text-slate-700 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-blue-600"
                checked={selected.includes(key)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...selected.filter((item) => item !== key), key]
                    : selected.filter((item) => item !== key);
                  onChange(next);
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}

export default function Dashboard({ dataset, view = "overview" }: DashboardProps) {
  const currentWindow = useMemo(() => {
    const p = getFiscalPeriod(new Date(), dataset.fiscalYearStartMonth);
    return { fiscalYear: p.fiscalYear, quarter: p.fiscalQuarterLabel };
  }, [dataset.fiscalYearStartMonth]);
  const latestDate = useMemo(
    () => (dataset.latestDataDate ? new Date(dataset.latestDataDate) : null),
    [dataset.latestDataDate]
  );

  const fiscalYears = useMemo(
    () =>
      Array.from(
        new Set([
          ...dataset.records.map((r) => r.fiscalYear).filter(Boolean),
          currentWindow.fiscalYear,
        ])
      ).sort(
        (a, b) => Number(a) - Number(b)
      ) as number[],
    [currentWindow.fiscalYear, dataset.records]
  );

  const [selectedFiscalYear, setSelectedFiscalYear] = useState<number | "all">(
    currentWindow.fiscalYear
  );
  const [selectedQuarter, setSelectedQuarter] = useState<
    (typeof QUARTER_ORDER)[number] | "all"
  >(currentWindow.quarter);
  const [geoFilter, setGeoFilter] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);
  const [includeUnicaDeals, setIncludeUnicaDeals] = useState(false);
  const [sortBy, setSortBy] = useState<"serviceCategory" | "owner">("serviceCategory");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [tableFilters, setTableFilters] = useState({
    opportunitySearch: "",
    opportunityIds: [] as string[],
    owners: [] as string[],
    hclOwners: [] as string[],
    geos: [] as string[],
    services: [] as string[],
    lanes: [] as string[],
    forecastStates: [] as string[],
    booked: [] as ("withValue" | "blank")[],
    commit: [] as ("withValue" | "blank")[],
    upside: [] as ("withValue" | "blank")[],
    pipeline: [] as ("withValue" | "blank")[],
    revenueMin: "",
    revenueMax: "",
  });
  const [lineByLineCloseQuarter, setLineByLineCloseQuarter] = useState<
    (typeof QUARTER_ORDER)[number] | "all"
  >("all");

  const filterOptions = useMemo(
    () => ({
      geos: Array.from(new Set(dataset.records.map((r) => r.geo))).sort(),
      owners: Array.from(new Set(dataset.records.map((r) => r.owner))).sort(),
      services: Array.from(new Set(dataset.records.map((r) => r.serviceCategory))).sort(),
    }),
    [dataset.records]
  );

  const availableQuarterLabels = useMemo(() => {
    const labels = new Set(
      dataset.records
        .map((r) => r.fiscalQuarterLabel)
        .filter((q): q is (typeof QUARTER_ORDER)[number] => Boolean(q))
    );
    return QUARTER_ORDER.filter((q) => labels.has(q));
  }, [dataset.records]);

  const filtered = useMemo(() => {
    return dataset.records.filter((record) => {
      const fyMatch =
        selectedFiscalYear === "all" || record.fiscalYear === selectedFiscalYear;
      const qMatch =
        selectedQuarter === "all" || record.fiscalQuarterLabel === selectedQuarter;
      const geoMatch = geoFilter.length === 0 || geoFilter.includes(record.geo);
      const ownerMatch = ownerFilter.length === 0 || ownerFilter.includes(record.owner);
      const serviceMatch = DEFAULT_SERVICE_CATEGORIES.includes(record.serviceCategory);
      const unicaMatch = includeUnicaDeals || !isUnicaDeal(record);
      return fyMatch && qMatch && geoMatch && ownerMatch && serviceMatch && unicaMatch;
    });
  }, [
    dataset.records,
    selectedFiscalYear,
    selectedQuarter,
    geoFilter,
    ownerFilter,
    includeUnicaDeals,
  ]);

  /** Current fiscal year (Apr–Mar calendar), same notion as FY labels on the spreadsheet (e.g. FY27 → 2027). */
  const lineByLineCurrentFiscalYear = useMemo(
    () => getFiscalPeriod(new Date(), dataset.fiscalYearStartMonth).fiscalYear,
    [dataset.fiscalYearStartMonth]
  );

  const lineByLineSheetCloseQuarterOptions = useMemo(() => {
    const inCurrentFy = dataset.records.filter((r) => {
      const fy = r.sheetFiscalYear ?? r.fiscalYear;
      return fy === lineByLineCurrentFiscalYear;
    });
    const labels = new Set(
      inCurrentFy
        .map((r) => r.closeQuarterLabel ?? r.fiscalQuarterLabel)
        .filter((q): q is (typeof QUARTER_ORDER)[number] => Boolean(q))
    );
    return QUARTER_ORDER.filter((q) => labels.has(q));
  }, [dataset.records, lineByLineCurrentFiscalYear]);

  /** Line-by-Line: spreadsheet FY (+ close quarter below) with GEO / owner / service / Unica — not Overview filters. */
  const lineByLineContextFiltered = useMemo(() => {
    return dataset.records.filter((record) => {
      const effectiveFy = record.sheetFiscalYear ?? record.fiscalYear;
      if (effectiveFy !== lineByLineCurrentFiscalYear) return false;
      const geoMatch = geoFilter.length === 0 || geoFilter.includes(record.geo);
      const ownerMatch = ownerFilter.length === 0 || ownerFilter.includes(record.owner);
      const serviceMatch = DEFAULT_SERVICE_CATEGORIES.includes(record.serviceCategory);
      const unicaMatch = includeUnicaDeals || !isUnicaDeal(record);
      return geoMatch && ownerMatch && serviceMatch && unicaMatch;
    });
  }, [
    dataset.records,
    geoFilter,
    ownerFilter,
    includeUnicaDeals,
    lineByLineCurrentFiscalYear,
  ]);

  const recordsForLineByLineTable = useMemo(() => {
    if (view !== "lineByLine") return filtered;
    const base = lineByLineContextFiltered;
    if (lineByLineCloseQuarter === "all") return base;
    return base.filter(
      (r) => (r.closeQuarterLabel ?? r.fiscalQuarterLabel) === lineByLineCloseQuarter
    );
  }, [view, filtered, lineByLineContextFiltered, lineByLineCloseQuarter]);

  const totalRevenue = useMemo(
    () => filtered.reduce((sum, row) => sum + row.bookingRevenueUS, 0),
    [filtered]
  );

  /** Overview hero + charts: deals with **4 - Booked** in the current filter window (FY / quarter / GEO / owner / services). */
  const bookedDealsInScopeCount = useMemo(
    () => filtered.filter((row) => row.salesForecastBooked).length,
    [filtered]
  );

  /** Same buckets as Line-by-Line: **Sales Forecast Stage** (1–4), not pipeline booking stage. */
  const stageRollup = useMemo(() => {
    const out = {
      booked: 0,
      commit: 0,
      upside: 0,
      pipeline: 0,
      total: 0,
    };
    for (const row of filtered) {
      const bucket = forecastRevenueBucket(row.salesForecastState) ?? "pipeline";
      out[bucket] += row.bookingRevenueUS;
      out.total += row.bookingRevenueUS;
    }
    return out;
  }, [filtered]);

  const nextQuarterTarget = useMemo(() => {
    const fy = selectedFiscalYear === "all" ? currentWindow.fiscalYear : selectedFiscalYear;
    const q = selectedQuarter === "all" ? currentWindow.quarter : selectedQuarter;
    return nextFiscalQuarter(fy, q);
  }, [currentWindow.fiscalYear, currentWindow.quarter, selectedFiscalYear, selectedQuarter]);

  const nextQuarterBaseRecords = useMemo(() => {
    return dataset.records.filter((record) => {
      const geoMatch = geoFilter.length === 0 || geoFilter.includes(record.geo);
      const ownerMatch = ownerFilter.length === 0 || ownerFilter.includes(record.owner);
      const serviceMatch = DEFAULT_SERVICE_CATEGORIES.includes(record.serviceCategory);
      const unicaMatch = includeUnicaDeals || !isUnicaDeal(record);
      return geoMatch && ownerMatch && serviceMatch && unicaMatch;
    });
  }, [dataset.records, geoFilter, includeUnicaDeals, ownerFilter]);

  const nextQuarterStageData = useMemo(() => {
    const scoped = nextQuarterBaseRecords.filter(
      (record) =>
        record.fiscalYear === nextQuarterTarget.fiscalYear &&
        record.fiscalQuarterLabel === nextQuarterTarget.quarter
    );
    const totals = {
      booked: 0,
      commit: 0,
      upside: 0,
      pipeline: 0,
    };
    for (const row of scoped) {
      totals[stageBucket(row.stageOrder)] += row.bookingRevenueUS;
    }
    return [
      { stage: "Booked", value: totals.booked, color: "#2f6f4f" },
      { stage: "Commit", value: totals.commit, color: "#0f62fe" },
      { stage: "Upside", value: totals.upside, color: "#8a3ffc" },
      { stage: "Pipeline", value: totals.pipeline, color: "#f97316" },
    ];
  }, [nextQuarterBaseRecords, nextQuarterTarget.fiscalYear, nextQuarterTarget.quarter]);

  const nextQuarterTotal = useMemo(
    () => nextQuarterStageData.reduce((sum, row) => sum + row.value, 0),
    [nextQuarterStageData]
  );

  const geoStackConfig = useMemo(() => {
    const totalsByProduct = new Map<(typeof BOOKING_PRODUCT_DISPLAY_ORDER)[number], number>();
    const byGeo = new Map<string, Record<(typeof BOOKING_PRODUCT_DISPLAY_ORDER)[number], number>>();

    for (const row of filtered) {
      const product = bookingDisplayProductForRecord(row);
      totalsByProduct.set(product, (totalsByProduct.get(product) ?? 0) + row.bookingRevenueUS);

      const geoRow =
        byGeo.get(row.geo) ??
        {
          "Domino+": 0,
          DX: 0,
          MX: 0,
          Commerce: 0,
          Unica: 0,
        };
      geoRow[product] = (geoRow[product] ?? 0) + row.bookingRevenueUS;
      byGeo.set(row.geo, geoRow);
    }

    const productKeys = [...totalsByProduct.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key);

    const data = [...byGeo.entries()]
      .map(([geo, values]) => {
        const row: Record<string, string | number> = { geo };
        for (const key of productKeys) {
          row[key] = values[key] ?? 0;
        }
        row.total = Object.values(values).reduce((sum, val) => sum + val, 0);
        return row;
      })
      .sort((a, b) => Number(b.total) - Number(a.total));

    return { productKeys, data };
  }, [filtered]);

  const ownerLeaderboard = useMemo(() => {
    const byOwner = new Map<string, number>();
    for (const row of filtered) {
      byOwner.set(row.owner, (byOwner.get(row.owner) ?? 0) + row.bookingRevenueUS);
    }
    return [...byOwner.entries()]
      .map(([owner, value]) => ({ owner, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filtered]);

  const tableFilterOptions = useMemo(() => {
    const laneSet = new Set(
      recordsForLineByLineTable.map((r) => bookingDisplayProductForRecord(r))
    );
    const lanes = BOOKING_PRODUCT_DISPLAY_ORDER.filter((lane) => laneSet.has(lane));
    const forecastStates = Array.from(
      new Set(
        recordsForLineByLineTable.map((r) => {
          const t = r.salesForecastState.trim();
          return t.length ? t : "—";
        })
      )
    ).sort();
    return {
      owners: Array.from(new Set(recordsForLineByLineTable.map((r) => r.owner))).sort(),
      hclOwners: Array.from(new Set(recordsForLineByLineTable.map((r) => r.hclOpportunityOwner))).sort(),
      geos: Array.from(new Set(recordsForLineByLineTable.map((r) => r.geo))).sort(),
      services: Array.from(new Set(recordsForLineByLineTable.map((r) => r.serviceCategory))).sort(),
      lanes,
      forecastStates,
    };
  }, [recordsForLineByLineTable]);

  const opportunityPickerOptions = useMemo(() => {
    const needle = tableFilters.opportunitySearch.trim().toLowerCase();
    const byId = new Map<string, { id: string; name: string }>();
    for (const r of recordsForLineByLineTable) {
      if (!byId.has(r.id)) byId.set(r.id, { id: r.id, name: r.name });
    }
    const list = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (!needle) return list;
    return list.filter(
      (row) =>
        row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle)
    );
  }, [recordsForLineByLineTable, tableFilters.opportunitySearch]);

  const tableFilteredDeals = useMemo(() => {
    const revenueMin = Number.parseFloat(tableFilters.revenueMin);
    const revenueMax = Number.parseFloat(tableFilters.revenueMax);
    const minValue = Number.isFinite(revenueMin) ? revenueMin : null;
    const maxValue = Number.isFinite(revenueMax) ? revenueMax : null;
    const opportunityNeedle = tableFilters.opportunitySearch.trim().toLowerCase();

    return recordsForLineByLineTable.filter((row) => {
      if (tableFilters.opportunityIds.length > 0 && !tableFilters.opportunityIds.includes(row.id)) {
        return false;
      }
      if (
        tableFilters.opportunityIds.length === 0 &&
        opportunityNeedle &&
        !row.name.toLowerCase().includes(opportunityNeedle) &&
        !row.id.toLowerCase().includes(opportunityNeedle)
      ) {
        return false;
      }
      if (tableFilters.owners.length > 0 && !tableFilters.owners.includes(row.owner)) return false;
      if (
        tableFilters.hclOwners.length > 0 &&
        !tableFilters.hclOwners.includes(row.hclOpportunityOwner)
      ) {
        return false;
      }
      if (tableFilters.geos.length > 0 && !tableFilters.geos.includes(row.geo)) return false;
      if (tableFilters.services.length > 0 && !tableFilters.services.includes(row.serviceCategory)) {
        return false;
      }
      if (tableFilters.lanes.length > 0) {
        const lane = bookingDisplayProductForRecord(row);
        if (!tableFilters.lanes.includes(lane)) return false;
      }
      if (tableFilters.forecastStates.length > 0) {
        const fs = row.salesForecastState.trim() || "—";
        if (!tableFilters.forecastStates.includes(fs)) return false;
      }
      if (!matchesForecastStageColumnFilter(tableFilters.booked, "booked", row.salesForecastState)) {
        return false;
      }
      if (!matchesForecastStageColumnFilter(tableFilters.commit, "commit", row.salesForecastState)) {
        return false;
      }
      if (!matchesForecastStageColumnFilter(tableFilters.upside, "upside", row.salesForecastState)) {
        return false;
      }
      if (!matchesForecastStageColumnFilter(tableFilters.pipeline, "pipeline", row.salesForecastState)) {
        return false;
      }
      if (minValue !== null && row.bookingRevenueUS < minValue) return false;
      if (maxValue !== null && row.bookingRevenueUS > maxValue) return false;
      return true;
    });
  }, [recordsForLineByLineTable, tableFilters]);

  const sortedDeals = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const collator = new Intl.Collator();
    return [...tableFilteredDeals].sort((a, b) => {
      const first = a[sortBy];
      const second = b[sortBy];
      const result = collator.compare(String(first), String(second));
      return result * direction;
    });
  }, [tableFilteredDeals, sortBy, sortDirection]);

  const tableStageRollup = useMemo(() => {
    const out = {
      booked: 0,
      commit: 0,
      upside: 0,
      pipeline: 0,
      total: 0,
    };
    for (const row of sortedDeals) {
      const bucket = forecastRevenueBucket(row.salesForecastState);
      if (bucket) out[bucket] += row.bookingRevenueUS;
      out.total += row.bookingRevenueUS;
    }
    return out;
  }, [sortedDeals]);

  const productMixData = useMemo(() => {
    const totals = new Map<(typeof BOOKING_PRODUCT_DISPLAY_ORDER)[number], number>();
    for (const row of filtered) {
      const product = bookingDisplayProductForRecord(row);
      totals.set(product, (totals.get(product) ?? 0) + row.bookingRevenueUS);
    }
    return BOOKING_PRODUCT_DISPLAY_ORDER.map((product) => ({
      name: product,
      value: totals.get(product) ?? 0,
    })).filter((row) => row.value > 0);
  }, [filtered]);

  const bookingAttainmentByProduct = useMemo(() => {
    const { targetsUsd, loaded } = dataset.bookingTargets;
    const fiscalYearOk = selectedFiscalYear === 2027;
    const quarterSlice: readonly (typeof QUARTER_ORDER)[number][] =
      selectedQuarter === "all" ? [...QUARTER_ORDER] : [selectedQuarter];

    const sumTargetForProduct = (product: (typeof BOOKING_PRODUCT_DISPLAY_ORDER)[number]) =>
      quarterSlice.reduce((sum, q) => sum + (targetsUsd[product]?.[q] ?? 0), 0);

    const actualByProduct = new Map<(typeof BOOKING_PRODUCT_DISPLAY_ORDER)[number], number>();
    for (const row of filtered) {
      if (!row.salesForecastBooked) continue;
      const p = bookingDisplayProductForRecord(row);
      actualByProduct.set(p, (actualByProduct.get(p) ?? 0) + row.bookingRevenueUS);
    }

    return BOOKING_PRODUCT_DISPLAY_ORDER.filter((p) => includeUnicaDeals || p !== "Unica").map(
      (product) => {
        const actualUsd = actualByProduct.get(product) ?? 0;
        const targetUsd = fiscalYearOk && loaded ? sumTargetForProduct(product) : 0;
        const attainmentPct =
          fiscalYearOk && loaded && targetUsd > 0 ? (actualUsd / targetUsd) * 100 : null;
        return { product, actualUsd, targetUsd, attainmentPct };
      }
    );
  }, [
    filtered,
    selectedFiscalYear,
    selectedQuarter,
    dataset.bookingTargets,
    includeUnicaDeals,
  ]);

  /** Overall USD attainment (4 - Booked vs plan) for the Forecast / Target chart — sums product rows below. */
  const attainmentPct = useMemo(() => {
    const sumActual = bookingAttainmentByProduct.reduce((sum, row) => sum + row.actualUsd, 0);
    const sumTarget = bookingAttainmentByProduct.reduce((sum, row) => sum + row.targetUsd, 0);
    if (sumTarget > 0) return (sumActual / sumTarget) * 100;
    return 0;
  }, [bookingAttainmentByProduct]);

  const inferredWeeklyTrendData = useMemo(() => {
    if (!latestDate) return [];
    const currentWeekStart = startOfWeek(latestDate);
    const weeks: Date[] = [];
    for (let idx = 11; idx >= 0; idx -= 1) {
      const point = new Date(currentWeekStart);
      point.setDate(point.getDate() - idx * 7);
      weeks.push(point);
    }

    return weeks.map((weekStart) => {
      const totals: Record<(typeof BOOKING_PRODUCT_DISPLAY_ORDER)[number], number> = {
        "Domino+": 0,
        DX: 0,
        MX: 0,
        Commerce: 0,
        Unica: 0,
      };
      for (const row of filtered) {
        const active = row.activeStageStarted ? new Date(row.activeStageStarted) : null;
        if (!active || active > weekStart) continue;
        const product = bookingDisplayProductForRecord(row);
        totals[product] += row.bookingRevenueUS;
      }
      const total = BOOKING_PRODUCT_DISPLAY_ORDER.reduce((sum, key) => sum + totals[key], 0);
      return {
        week: weekLabel(weekStart),
        ...totals,
        total,
      };
    });
  }, [filtered, latestDate]);

  const weeklyTrendData = useMemo(() => {
    if (!dataset.historicalTrend.length) return inferredWeeklyTrendData;
    return dataset.historicalTrend.slice(-12).map((point) => {
      const unica = includeUnicaDeals ? point.unica : 0;
      return {
        week: point.weekLabel,
        "Domino+": point.dominoPlus,
        DX: point.dx,
        MX: point.mx,
        Commerce: point.commerce,
        Unica: unica,
        total: point.dominoPlus + point.dx + point.mx + point.commerce + unica,
      };
    });
  }, [dataset.historicalTrend, includeUnicaDeals, inferredWeeklyTrendData]);

  const weeklySnapshot = useMemo(() => pickWeekOnWeekSnapshot(weeklyTrendData), [weeklyTrendData]);
  const viewingWeekLabel = useMemo(() => {
    if (weeklySnapshot?.currentWeekLabel) return weeklySnapshot.currentWeekLabel;
    return weeklyTrendData.at(-1)?.week ?? "n/a";
  }, [weeklySnapshot, weeklyTrendData]);

  const wowGrowthColorClass = useMemo(() => {
    if (!weeklySnapshot || weeklySnapshot.growth === null) return "text-slate-300";
    if (weeklySnapshot.growth > 0) return "text-emerald-400";
    if (weeklySnapshot.growth < 0) return "text-rose-400";
    return "text-slate-200";
  }, [weeklySnapshot]);

  const toggleFilterValue = (
    value: string,
    selected: string[],
    setter: (next: string[]) => void
  ) => {
    setter(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <div className="hcl-enhanced min-h-screen text-slate-200" style={{ background: ENCHANTED_BG }}>
      <header className="sticky top-0 z-30 border-b border-cyan-300/20 bg-gradient-to-r from-[#0a2f66] via-[#00539a] to-[#163c78] text-white shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md ring-1 ring-white/[0.06]">
        <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded bg-white/15 p-2 ring-1 ring-white/25">
              <LayoutDashboard className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-100">HCLSoftware</p>
              <h1 className="text-xl font-semibold">Xperience Services Signals Dashboard</h1>
              <p className="text-[11px] text-blue-100/90">Pipeline performance, attainment, and line-level visibility</p>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 lg:gap-3">
            <p className="text-xs text-blue-100">
              Viewing week: <span className="font-semibold">{viewingWeekLabel}</span>
            </p>
            <HclSignalsNav active={view === "overview" ? "dashboard" : "details"} />
            <label className="inline-flex items-center gap-2 rounded-md border border-white/30 bg-white/10 px-2 py-1 text-xs text-white">
              <input
                type="checkbox"
                checked={includeUnicaDeals}
                onChange={(e) => setIncludeUnicaDeals(e.target.checked)}
                className="h-3.5 w-3.5 accent-blue-600"
              />
              Include Unica deals
            </label>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1720px] flex-col gap-5 px-4 py-6">
        <section className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/60 shadow-[0_6px_30px_rgba(0,0,0,0.35)]">
          <div className="border-b border-white/10 px-4 py-2 text-sm text-slate-300">
            <span className="font-medium text-slate-400">Reports</span>
            <span className="mx-1 text-slate-500">/</span>
            <span className="font-semibold text-slate-100">
              {view === "overview" ? "Overview" : "Line-by-Line"}
            </span>
          </div>
          {view === "overview" ? (
            <BookingIntelligenceBriefing
              filtered={filtered}
              totalRevenue={totalRevenue}
              bookedDealsInScopeCount={bookedDealsInScopeCount}
              stageRollup={stageRollup}
              bookingAttainmentByProduct={bookingAttainmentByProduct}
              overallAttainmentPct={attainmentPct}
              bookingTargetsLoaded={dataset.bookingTargets.loaded}
              selectedFiscalYear={selectedFiscalYear}
              selectedQuarter={selectedQuarter === "all" ? "all" : selectedQuarter}
              sourceFile={dataset.sourceFile}
            />
          ) : null}
        </section>
        <section className="min-w-0 flex flex-col gap-4">
          {view === "overview" ? (
            <>
          <section className="rounded-xl border border-cyan-300/20 bg-gradient-to-r from-cyan-500/15 via-blue-500/10 to-transparent px-4 py-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
              Performance Snapshot
            </p>
          </section>
          <section className="grid gap-4 md:grid-cols-4">
            <div className={SURFACE_CARD}>
              <p className="text-xs uppercase tracking-wide text-slate-400">Current Quarter Revenue Pipeline</p>
              <p className="mt-2 text-3xl font-semibold text-slate-50">{CURRENCY.format(totalRevenue)}</p>
            </div>
            <div className={SURFACE_CARD}>
              <p className="text-xs uppercase tracking-wide text-slate-400">Visible Deals</p>
              <p className="mt-2 text-3xl font-semibold text-slate-50">{filtered.length}</p>
            </div>
            <div className={SURFACE_CARD}>
              <p className="text-xs uppercase tracking-wide text-slate-400">Booked deals (quarter)</p>
              <p className="mt-2 text-3xl font-semibold text-slate-50">{bookedDealsInScopeCount}</p>
              <p className="text-xs text-slate-400">
                <span className="font-medium text-slate-200">4 - Booked</span> opportunities in view ·{" "}
                {selectedFiscalYear === "all" ? "All fiscal years" : `FY${selectedFiscalYear}`} ·{" "}
                {selectedQuarter === "all" ? "All quarters" : selectedQuarter} · all service categories
                {filtered.length > 0 ? (
                  <>
                    {" "}
                    <span className="text-slate-500">·</span> {bookedDealsInScopeCount} of {filtered.length}{" "}
                    visible deals
                  </>
                ) : null}
              </p>
            </div>
            <div className="rounded-2xl border border-[#0070d2]/40 bg-gradient-to-br from-[#0070d2]/20 via-slate-900/80 to-slate-950/80 p-5 shadow-[0_10px_35px_rgba(0,112,210,0.25)]">
              <p className="text-xs uppercase tracking-wide text-blue-100/80">Week-on-Week Pipeline Growth</p>
              <p className={`mt-2 text-3xl font-semibold ${wowGrowthColorClass}`}>
                {dataset.pipelineVelocity.pctChange === null
                  ? "N/A"
                  : `${dataset.pipelineVelocity.pctChange >= 0 ? "+" : ""}${dataset.pipelineVelocity.pctChange.toFixed(1)}%`}
              </p>
              <p className={`text-xs ${wowGrowthColorClass}`}>
                {`${dataset.pipelineVelocity.delta >= 0 ? "+" : ""}${CURRENCY.format(dataset.pipelineVelocity.delta)}`}
              </p>
              <p className="text-[10px] text-slate-300/80">
                Compares the latest week with pipeline revenue to the latest prior week with revenue (skips empty weeks).
              </p>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-5">
            <div className={SURFACE_CARD}>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">4 - Booked</p>
              <p className="mt-1 text-lg font-semibold text-slate-50">
                {CURRENCY.format(stageRollup.booked)}
              </p>
            </div>
            <div className={SURFACE_CARD}>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">3 - Commit</p>
              <p className="mt-1 text-lg font-semibold text-slate-50">
                {CURRENCY.format(stageRollup.commit)}
              </p>
            </div>
            <div className={SURFACE_CARD}>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">2 - Upside</p>
              <p className="mt-1 text-lg font-semibold text-slate-50">
                {CURRENCY.format(stageRollup.upside)}
              </p>
            </div>
            <div className={SURFACE_CARD}>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">1 - Pipeline</p>
              <p className="mt-1 text-lg font-semibold text-slate-50">
                {CURRENCY.format(stageRollup.pipeline)}
              </p>
            </div>
            <div className="rounded-xl border border-[#0f62fe]/40 bg-[#0f62fe]/12 p-3.5 shadow-sm ring-1 ring-[#0f62fe]/25">
              <p className="text-[11px] uppercase tracking-wide text-blue-100/90">Grand Total</p>
              <p className="mt-1 text-lg font-semibold text-slate-50">{CURRENCY.format(stageRollup.total)}</p>
            </div>
          </section>

          <section className={SURFACE_CARD}>
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Booking attainment by product</h2>
            {!dataset.bookingTargets.loaded && dataset.bookingTargets.parseError ? (
              <p className="mb-3 text-xs text-amber-800">{dataset.bookingTargets.parseError}</p>
            ) : null}
            <div
              className={`grid gap-3 sm:grid-cols-2 ${
                bookingAttainmentByProduct.length >= 5
                  ? "md:grid-cols-5"
                  : bookingAttainmentByProduct.length === 4
                    ? "md:grid-cols-4"
                    : bookingAttainmentByProduct.length === 3
                      ? "md:grid-cols-3"
                      : ""
              }`}
            >
              {bookingAttainmentByProduct.map(({ product, actualUsd, targetUsd, attainmentPct }) => (
                <div key={product} className="rounded-lg border border-white/10 bg-slate-900/70 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">{product}</p>
                  <p className="mt-1 text-xl font-semibold text-slate-50">
                    {attainmentPct === null ? "—" : `${attainmentPct.toFixed(1)}%`}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {CURRENCY.format(actualUsd)}
                    {selectedFiscalYear === 2027 && dataset.bookingTargets.loaded && targetUsd > 0
                      ? ` / ${CURRENCY.format(targetUsd)} plan`
                      : ""}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className={SURFACE_CARD}>
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Utilization by Product</h2>
            <div className="grid gap-3 md:grid-cols-5">
              {dataset.utilization.products.map((item) => (
                <div key={item.product} className="rounded-lg border border-white/10 bg-slate-900/70 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">{item.product}</p>
                  <p className="mt-1 text-xl font-semibold text-slate-50">{item.utilizationPct.toFixed(1)}%</p>
                  <p className="text-[11px] text-slate-400">
                    {item.postedHours.toFixed(0)}h / {item.availableHours.toFixed(0)}h
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-slate-900/60 p-5 shadow-[0_10px_35px_rgba(0,0,0,0.35)]">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Filter className="h-4 w-4" /> Dynamic Filters
            </div>
            <p className="mb-3 text-[11px] leading-snug text-slate-500">
              Fiscal year is <span className="font-medium text-slate-700">Apr 1 – Mar 31</span> (FY number =
              year of the March close). Quarters: AMJ Apr–Jun, JAS Jul–Sep, OND Oct–Dec, JFM Jan–Mar. Deal period
              uses Est. Close Date, else Active Stage Started.{" "}
              <span className="font-medium text-slate-700">Booked deals (quarter)</span> (top row) counts
              opportunities with <span className="font-medium text-slate-700">4 - Booked</span> in the same FY /
              quarter and filters.{" "}
              <span className="font-medium text-slate-700">Booking attainment by product</span> (below) sums{" "}
              <span className="font-medium text-slate-700">Booking Revenue US</span> only when{" "}
              <span className="font-medium text-slate-700">Sales Forecast State = 4 - Booked</span>; other overview
              totals use the full filtered pipeline.
            </p>
            <div className="grid gap-4 md:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                Fiscal Year
                <select
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
                  value={selectedFiscalYear}
                  onChange={(e) =>
                    setSelectedFiscalYear(
                      e.target.value === "all" ? "all" : Number.parseInt(e.target.value, 10)
                    )
                  }
                >
                  <option value="all">All</option>
                  {fiscalYears.map((fy) => (
                    <option key={fy} value={fy}>
                      FY{fy}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                Fiscal Quarter
                <select
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
                  value={selectedQuarter}
                  onChange={(e) =>
                    setSelectedQuarter(e.target.value as (typeof QUARTER_ORDER)[number] | "all")
                  }
                >
                  <option value="all">All</option>
                  {availableQuarterLabels.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-sm text-slate-700">
                <p className="mb-1">GEO</p>
                <div className="max-h-28 overflow-auto rounded-md border border-slate-300 bg-slate-50 p-2">
                  {filterOptions.geos.map((geo) => (
                    <label key={geo} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={geoFilter.includes(geo)}
                        onChange={() => toggleFilterValue(geo, geoFilter, setGeoFilter)}
                      />
                      {geo}
                    </label>
                  ))}
                </div>
              </div>
              <div className="text-sm text-slate-700">
                <p className="mb-1">Opportunity Owner</p>
                <div className="max-h-28 overflow-auto rounded-md border border-slate-300 bg-slate-50 p-2">
                  {filterOptions.owners.map((owner) => (
                    <label key={owner} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ownerFilter.includes(owner)}
                        onChange={() => toggleFilterValue(owner, ownerFilter, setOwnerFilter)}
                      />
                      {owner}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Service category is fixed to defaults: Digital Solutions & Collaboration, Marketing, Commerce.
            </p>
          </section>
            </>
          ) : null}

          {view === "lineByLine" ? (
            <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/50 p-6 shadow-[0_8px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl ring-1 ring-white/5">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-cyan-500/5" />
            <div className="relative">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-slate-800">Line-by-Line Booking Report</h2>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  <span>
                    Y Close Quarter{" "}
                    <span className="text-xs font-normal text-slate-500">
                      (FY{lineByLineCurrentFiscalYear})
                    </span>
                  </span>
                  <select
                    className="min-w-[8.5rem] rounded-md border border-slate-300 bg-white px-2 py-1.5"
                    value={lineByLineCloseQuarter}
                    onChange={(e) =>
                      setLineByLineCloseQuarter(
                        e.target.value === "all" ? "all" : (e.target.value as (typeof QUARTER_ORDER)[number])
                      )
                    }
                  >
                    <option value="all">All</option>
                    {(lineByLineSheetCloseQuarterOptions.length
                      ? lineByLineSheetCloseQuarterOptions
                      : [...QUARTER_ORDER]
                    ).map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  Sort by
                  <select
                    className="min-w-[10rem] rounded-md border border-slate-300 bg-white px-2 py-1.5"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as "serviceCategory" | "owner")}
                  >
                    <option value="serviceCategory">Service Category</option>
                    <option value="owner">Customer Name</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="inline-flex h-[38px] items-center gap-2 self-end rounded-md border border-slate-300 px-2 py-1 text-xs"
                  onClick={() => setSortDirection((dir) => (dir === "asc" ? "desc" : "asc"))}
                >
                  <ArrowDownUp className="h-3.5 w-3.5" />
                  {sortDirection.toUpperCase()}
                </button>
                <button
                  type="button"
                  className="h-[38px] self-end rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                  onClick={() => {
                    setLineByLineCloseQuarter("all");
                    setTableFilters({
                      opportunitySearch: "",
                      opportunityIds: [],
                      owners: [],
                      hclOwners: [],
                      geos: [],
                      services: [],
                      lanes: [],
                      forecastStates: [],
                      booked: [],
                      commit: [],
                      upside: [],
                      pipeline: [],
                      revenueMin: "",
                      revenueMax: "",
                    });
                  }}
                >
                  Clear column filters
                </button>
              </div>
            </div>
            <div className="mb-3 grid gap-2 md:grid-cols-5">
              <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
                <span className="font-semibold text-slate-600">4-Booked:</span>{" "}
                <span className="font-semibold text-slate-900">{CURRENCY.format(tableStageRollup.booked)}</span>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
                <span className="font-semibold text-slate-600">3-Commit:</span>{" "}
                <span className="font-semibold text-slate-900">{CURRENCY.format(tableStageRollup.commit)}</span>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
                <span className="font-semibold text-slate-600">2-Upside:</span>{" "}
                <span className="font-semibold text-slate-900">{CURRENCY.format(tableStageRollup.upside)}</span>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
                <span className="font-semibold text-slate-600">1-Pipeline:</span>{" "}
                <span className="font-semibold text-slate-900">{CURRENCY.format(tableStageRollup.pipeline)}</span>
              </div>
              <div className="rounded-lg border border-[#0f62fe]/35 bg-[#0f62fe]/10 px-2 py-1.5 text-xs text-slate-100 ring-1 ring-[#0f62fe]/20">
                <span className="font-semibold text-blue-100/80">Total:</span>{" "}
                <span className="font-semibold text-slate-50">{CURRENCY.format(tableStageRollup.total)}</span>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-white/10 bg-slate-950/30 shadow-inner ring-1 ring-white/5">
              <table className="w-full table-fixed border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-600">
                    <th className="w-[15%] p-2">Opportunity</th>
                    <th className="w-[10%] p-2">Customer Name</th>
                    <th className="w-[10%] p-2 whitespace-normal text-[10px] font-semibold normal-case tracking-normal text-slate-600">
                      HCL Opportunity Owner
                    </th>
                    <th className="w-[6%] p-2">GEO</th>
                    <th className="w-[11%] p-2">Service</th>
                    <th className="w-[7%] p-2">Lane</th>
                    <th className="w-[10%] p-2">Sales forecast</th>
                    <th className="p-2 text-right">Booked</th>
                    <th className="p-2 text-right">Commit</th>
                    <th className="p-2 text-right">Upside</th>
                    <th className="p-2 text-right">Pipeline</th>
                    <th className="p-2 text-right">Revenue</th>
                  </tr>
                  <tr className="border-t border-slate-200 bg-slate-100 text-[11px] text-slate-700">
                    <th className="p-1.5 align-top">
                      <details className="group relative">
                        <summary className={LINE_BY_LINE_MULTI_SUMMARY}>
                          {tableFilters.opportunityIds.length === 0 &&
                          !tableFilters.opportunitySearch.trim()
                            ? "All opportunities"
                            : tableFilters.opportunityIds.length > 0
                              ? `${tableFilters.opportunityIds.length} selected`
                              : "Filtered"}
                        </summary>
                        <div
                          className={`${LINE_BY_LINE_MULTI_PANEL} w-[min(100vw-2rem,22rem)] max-w-[22rem]`}
                        >
                          <input
                            className="mb-2 w-full rounded border border-slate-300 px-1.5 py-1 text-[11px]"
                            placeholder="Search name or ID…"
                            value={tableFilters.opportunitySearch}
                            onChange={(e) =>
                              setTableFilters((prev) => ({
                                ...prev,
                                opportunitySearch: e.target.value,
                              }))
                            }
                          />
                          <div className={LINE_BY_LINE_MULTI_LIST}>
                            <label className="mb-1 flex items-center gap-2 rounded px-1.5 py-1 text-slate-700 hover:bg-slate-50">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-blue-600"
                                checked={tableFilters.opportunityIds.length === 0}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setTableFilters((prev) => ({
                                      ...prev,
                                      opportunityIds: [],
                                      opportunitySearch: "",
                                    }));
                                  }
                                }}
                              />
                              <span className="font-medium">All opportunities</span>
                            </label>
                            {opportunityPickerOptions.map((row) => (
                              <label
                                key={row.id}
                                className="flex items-center gap-2 rounded px-1.5 py-1 text-slate-700 hover:bg-slate-50"
                              >
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5 accent-blue-600"
                                  checked={tableFilters.opportunityIds.includes(row.id)}
                                  onChange={(e) =>
                                    setTableFilters((prev) => ({
                                      ...prev,
                                      opportunityIds: e.target.checked
                                        ? [...prev.opportunityIds, row.id]
                                        : prev.opportunityIds.filter((id) => id !== row.id),
                                    }))
                                  }
                                />
                                <span className="truncate" title={`${row.name} (${row.id})`}>
                                  {row.name}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </details>
                    </th>
                    <th className="p-1.5 align-top">
                      <LineByLineColumnMultiSelect
                        summaryEmpty="All customers"
                        summarySelected={(n) => `${n} selected`}
                        allLabel="All customers"
                        options={tableFilterOptions.owners}
                        selected={tableFilters.owners}
                        onChange={(next) => setTableFilters((prev) => ({ ...prev, owners: next }))}
                        summaryIcon={<Users className="h-3.5 w-3.5 shrink-0 text-[#0f62fe]" />}
                      />
                    </th>
                    <th className="p-1.5 align-top">
                      <LineByLineColumnMultiSelect
                        summaryEmpty="All HCL owners"
                        summarySelected={(n) => `${n} selected`}
                        allLabel="All HCL owners"
                        options={tableFilterOptions.hclOwners}
                        selected={tableFilters.hclOwners}
                        onChange={(next) =>
                          setTableFilters((prev) => ({ ...prev, hclOwners: next }))
                        }
                      />
                    </th>
                    <th className="p-1.5 align-top">
                      <LineByLineColumnMultiSelect
                        summaryEmpty="All GEOs"
                        summarySelected={(n) => `${n} selected`}
                        allLabel="All GEOs"
                        options={tableFilterOptions.geos}
                        selected={tableFilters.geos}
                        onChange={(next) => setTableFilters((prev) => ({ ...prev, geos: next }))}
                      />
                    </th>
                    <th className="p-1.5 align-top">
                      <LineByLineColumnMultiSelect
                        summaryEmpty="All services"
                        summarySelected={(n) => `${n} selected`}
                        allLabel="All services"
                        options={tableFilterOptions.services}
                        selected={tableFilters.services}
                        onChange={(next) => setTableFilters((prev) => ({ ...prev, services: next }))}
                      />
                    </th>
                    <th className="p-1.5 align-top">
                      <LineByLineColumnMultiSelect
                        summaryEmpty="All lanes"
                        summarySelected={(n) => `${n} selected`}
                        allLabel="All lanes"
                        options={tableFilterOptions.lanes}
                        selected={tableFilters.lanes}
                        onChange={(next) => setTableFilters((prev) => ({ ...prev, lanes: next }))}
                      />
                    </th>
                    <th className="p-1.5 align-top">
                      <LineByLineColumnMultiSelect
                        summaryEmpty="All forecasts"
                        summarySelected={(n) => `${n} selected`}
                        allLabel="All forecasts"
                        options={tableFilterOptions.forecastStates}
                        selected={tableFilters.forecastStates}
                        onChange={(next) =>
                          setTableFilters((prev) => ({ ...prev, forecastStates: next }))
                        }
                        panelClassName="min-w-[18rem] w-72"
                      />
                    </th>
                    {(
                      [
                        { key: "booked" as const, label: "Booked" },
                        { key: "commit" as const, label: "Commit" },
                        { key: "upside" as const, label: "Upside" },
                        { key: "pipeline" as const, label: "Pipeline" },
                      ] as const
                    ).map(({ key, label }) => (
                      <th key={key} className="p-1.5 align-top">
                        <LineByLineStageBucketMultiSelect
                          columnLabel={label}
                          selected={tableFilters[key]}
                          onChange={(next) =>
                            setTableFilters((prev) => ({ ...prev, [key]: next }))
                          }
                        />
                      </th>
                    ))}
                    <th className="p-1.5 align-top">
                      <details className="group relative">
                        <summary className={LINE_BY_LINE_MULTI_SUMMARY}>
                          {!tableFilters.revenueMin.trim() && !tableFilters.revenueMax.trim()
                            ? "All revenue"
                            : "Range"}
                        </summary>
                        <div className={`${LINE_BY_LINE_MULTI_PANEL} w-52`}>
                          <div className="flex flex-col gap-2 px-0.5 py-1">
                            <input
                              className="w-full rounded border border-slate-300 px-1.5 py-1"
                              placeholder="Min"
                              inputMode="decimal"
                              value={tableFilters.revenueMin}
                              onChange={(e) =>
                                setTableFilters((prev) => ({ ...prev, revenueMin: e.target.value }))
                              }
                            />
                            <input
                              className="w-full rounded border border-slate-300 px-1.5 py-1"
                              placeholder="Max"
                              inputMode="decimal"
                              value={tableFilters.revenueMax}
                              onChange={(e) =>
                                setTableFilters((prev) => ({ ...prev, revenueMax: e.target.value }))
                              }
                            />
                          </div>
                        </div>
                      </details>
                    </th>
                  </tr>
                </thead>
                <tbody className="text-[13px]">
                  {sortedDeals.map((deal) => (
                    <tr key={deal.id} className="border-t border-white/10 transition-colors hover:bg-white/5">
                      <td className="p-2 break-words">{deal.name}</td>
                      <td className="p-2 break-words">{deal.owner}</td>
                      <td className="p-2 break-words text-[12px]">{deal.hclOpportunityOwner}</td>
                      <td className="p-2">{deal.geo}</td>
                      <td className="p-2 break-words">{deal.serviceCategory}</td>
                      <td className="p-2 text-xs font-semibold text-slate-800">
                        {bookingDisplayProductForRecord(deal)}
                      </td>
                      <td
                        className={`p-2 break-words text-[11px] ${
                          deal.salesForecastBooked ? "font-medium text-emerald-900" : "text-slate-600"
                        }`}
                      >
                        {deal.salesForecastState || "—"}
                      </td>
                      <td className="p-2 text-right">
                        {forecastStageColumnValue(
                          deal.bookingRevenueUS,
                          deal.salesForecastState,
                          "booked"
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {forecastStageColumnValue(
                          deal.bookingRevenueUS,
                          deal.salesForecastState,
                          "commit"
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {forecastStageColumnValue(
                          deal.bookingRevenueUS,
                          deal.salesForecastState,
                          "upside"
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {forecastStageColumnValue(
                          deal.bookingRevenueUS,
                          deal.salesForecastState,
                          "pipeline"
                        )}
                      </td>
                      <td className="p-2 text-right font-medium">
                        {CURRENCY.format(deal.bookingRevenueUS)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 bg-slate-100 text-[13px]">
                  <tr className="border-t border-slate-300 font-semibold text-slate-800">
                    <td className="p-2" colSpan={7}>
                      Rollup Total ({sortedDeals.length} deals)
                    </td>
                    <td className="p-2 text-right">{CURRENCY.format(tableStageRollup.booked)}</td>
                    <td className="p-2 text-right">{CURRENCY.format(tableStageRollup.commit)}</td>
                    <td className="p-2 text-right">{CURRENCY.format(tableStageRollup.upside)}</td>
                    <td className="p-2 text-right">{CURRENCY.format(tableStageRollup.pipeline)}</td>
                    <td className="p-2 text-right">{CURRENCY.format(tableStageRollup.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            </div>
          </section>
          ) : null}
        </section>

        {view === "overview" ? <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          <section className="rounded-xl border border-emerald-300/20 bg-gradient-to-r from-emerald-500/15 via-teal-500/10 to-transparent px-4 py-2 lg:col-span-2 2xl:col-span-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
              Coverage And Attainment
            </p>
          </section>

          <section className="min-w-0 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/85 to-slate-950/70 p-5 shadow-[0_10px_40px_rgba(0,0,0,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Target className="h-4 w-4" />
              Forecast / Target Attainment
            </h2>
            <p className="text-xs text-slate-600">
              {selectedFiscalYear === "all" ? "All fiscal years" : `FY${selectedFiscalYear}`} /{" "}
              {selectedQuarter === "all" ? "All quarters" : selectedQuarter}
            </p>
            <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-700/80 ring-1 ring-slate-600/50">
              <div
                className="h-full bg-[#0f62fe]"
                style={{ width: `${Math.min(100, Math.max(0, attainmentPct))}%` }}
              />
            </div>
            <p className="mt-2 text-sm font-medium text-slate-800">
              {dataset.bookingTargets.loaded && selectedFiscalYear === 2027
                ? `${attainmentPct.toFixed(1)}% of FY27 booking plan (4 - Booked $ vs targets)`
                : `${attainmentPct.toFixed(1)}% · load Global Targets for FY27 to compare 4 - Booked $ to plan`}
            </p>
          </section>

          <section className="min-w-0 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/85 to-slate-950/70 p-5 shadow-[0_10px_40px_rgba(0,0,0,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20">
            <h2 className="mb-1 text-sm font-semibold text-slate-800">
              Next Quarter Pipeline by Stage
            </h2>
            <p className="text-xs text-slate-500">
              Target window: FY{nextQuarterTarget.fiscalYear} / {nextQuarterTarget.quarter}
            </p>
            <p className="mb-2 text-xs text-slate-500">
              X-axis: Booking Stage, Y-axis: Revenue (USD) | Total: {CURRENCY.format(nextQuarterTotal)}
            </p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={nextQuarterStageData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid {...HCL_CHART_GRID} />
                  <XAxis dataKey="stage" stroke={HCL_CHART_AXIS_STROKE} tick={HCL_CHART_TICK} />
                  <YAxis
                    stroke={HCL_CHART_AXIS_STROKE}
                    tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                    tick={HCL_CHART_TICK}
                    label={{
                      value: "Revenue (USD)",
                      angle: -90,
                      position: "insideLeft",
                      fill: "#94a3b8",
                      fontSize: 11,
                    }}
                  />
                  <Tooltip formatter={formatCurrencyTooltip} {...HCL_CHART_TOOLTIP} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {nextQuarterStageData.map((entry) => (
                      <Cell key={entry.stage} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="min-w-0 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/85 to-slate-950/70 p-5 shadow-[0_10px_40px_rgba(0,0,0,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Pipeline Mix by Product</h2>
            <p className="mb-2 text-xs text-slate-500">X-axis: Product, Y-axis: Revenue (USD)</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <PieChart margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                  <Pie
                    data={productMixData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={46}
                    outerRadius={72}
                    paddingAngle={2}
                    stroke="#1e293b"
                    strokeWidth={1}
                    label={false}
                    labelLine={false}
                  >
                    {productMixData.map((entry) => (
                      <Cell
                        key={`pipeline-mix-${entry.name}`}
                        fill={PRODUCT_COLORS[entry.name as (typeof BOOKING_PRODUCT_DISPLAY_ORDER)[number]]}
                      />
                    ))}
                  </Pie>
                  <Legend
                    verticalAlign="bottom"
                    align="center"
                    wrapperStyle={{ ...HCL_CHART_LEGEND.wrapperStyle, lineHeight: "14px" }}
                    formatter={(value: string) =>
                      value.length > 18 ? `${value.slice(0, 18)}…` : value
                    }
                  />
                  <Tooltip formatter={formatCurrencyTooltip} {...HCL_CHART_TOOLTIP} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="min-w-0 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/85 to-slate-950/70 p-5 shadow-[0_10px_40px_rgba(0,0,0,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Geo Breakdown</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={geoStackConfig.data.slice(0, 8)}
                  margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                >
                  <CartesianGrid {...HCL_CHART_GRID} />
                  <XAxis
                    dataKey="geo"
                    stroke={HCL_CHART_AXIS_STROKE}
                    angle={-20}
                    textAnchor="end"
                    interval={0}
                    height={52}
                    tick={HCL_CHART_TICK}
                  />
                  <YAxis
                    stroke={HCL_CHART_AXIS_STROKE}
                    tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                    label={{
                      value: "Revenue (USD)",
                      angle: -90,
                      position: "insideLeft",
                      fill: "#94a3b8",
                      fontSize: 11,
                    }}
                    tick={HCL_CHART_TICK}
                  />
                  <Tooltip formatter={formatCurrencyTooltip} {...HCL_CHART_TOOLTIP} />
                  <Legend {...HCL_CHART_LEGEND} />
                  {geoStackConfig.productKeys.map((key) => {
                    return (
                      <Bar
                        key={key}
                        dataKey={key}
                        stackId="subService"
                        fill={PRODUCT_COLORS[key]}
                      />
                    );
                  })}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="min-w-0 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/85 to-slate-950/70 p-5 shadow-[0_10px_40px_rgba(0,0,0,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Owner Leaderboard (Top 10)</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={ownerLeaderboard}
                  layout="vertical"
                  margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                >
                  <CartesianGrid {...HCL_CHART_GRID} />
                  <XAxis
                    type="number"
                    stroke={HCL_CHART_AXIS_STROKE}
                    tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                    label={{
                      value: "Revenue (USD)",
                      position: "insideBottom",
                      offset: -2,
                      fill: "#94a3b8",
                      fontSize: 11,
                    }}
                    tick={HCL_CHART_TICK}
                  />
                  <YAxis
                    type="category"
                    dataKey="owner"
                    width={150}
                    stroke={HCL_CHART_AXIS_STROKE}
                    label={{
                      value: "Owner",
                      angle: -90,
                      position: "insideLeft",
                      fill: "#94a3b8",
                      fontSize: 11,
                    }}
                    tick={HCL_CHART_TICK}
                  />
                  <Tooltip formatter={formatCurrencyTooltip} {...HCL_CHART_TOOLTIP} />
                  <Bar dataKey="value" fill="#22c55e" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-xl border border-fuchsia-300/20 bg-gradient-to-r from-fuchsia-500/15 via-purple-500/10 to-transparent px-4 py-2 lg:col-span-2 2xl:col-span-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-200">
              Momentum
            </p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 text-xs text-slate-600 shadow-sm">
            <p className="mb-1 flex items-center gap-2 font-semibold text-slate-800">
              <TrendingUp className="h-4 w-4" />
              Global Revenue Trend (All Snapshots)
            </p>
            <div className="mb-4 h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <ComposedChart
                  data={dataset.historicalTrend.map((point) => ({ week: point.weekLabel, total: point.total }))}
                  margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                >
                  <CartesianGrid {...HCL_CHART_GRID} />
                  <XAxis dataKey="week" stroke={HCL_CHART_AXIS_STROKE} tick={HCL_CHART_TICK} />
                  <YAxis stroke={HCL_CHART_AXIS_STROKE} tick={HCL_CHART_TICK} />
                  <Tooltip formatter={formatCurrencyTooltip} {...HCL_CHART_TOOLTIP} />
                  <Line type="monotone" dataKey="total" stroke={ENCHANTED_ACCENT} strokeWidth={3} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="mb-1 flex items-center gap-2 font-semibold text-slate-800">
              <TrendingUp className="h-4 w-4" />
              Weekly Pipeline Growth (12 Week Snapshot)
            </p>
            <p className="mb-2 text-xs text-slate-500">
              X-axis: Week start, Y-axis: Pipeline revenue (USD), stacked by product.
            </p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <ComposedChart data={weeklyTrendData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid {...HCL_CHART_GRID} />
                  <XAxis dataKey="week" stroke={HCL_CHART_AXIS_STROKE} tick={HCL_CHART_TICK} />
                  <YAxis
                    stroke={HCL_CHART_AXIS_STROKE}
                    tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                    tick={HCL_CHART_TICK}
                  />
                  <Tooltip formatter={formatCurrencyTooltip} {...HCL_CHART_TOOLTIP} />
                  <Legend {...HCL_CHART_LEGEND} />
                  {BOOKING_PRODUCT_DISPLAY_ORDER.map((product) => (
                    <Bar
                      key={product}
                      dataKey={product}
                      stackId="weeklyProduct"
                      fill={PRODUCT_COLORS[product]}
                    />
                  ))}
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke={ENCHANTED_ACCENT}
                    strokeWidth={2.5}
                    dot={{ r: 2, fill: ENCHANTED_ACCENT }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {weeklySnapshot ? (
              <p className="mt-2 text-xs">
                Latest week with revenue vs last prior week with revenue
                {weeklySnapshot.previousWeekLabel && weeklySnapshot.currentWeekLabel
                  ? ` (${weeklySnapshot.previousWeekLabel} → ${weeklySnapshot.currentWeekLabel})`
                  : ""}
                :{" "}
                <span className="font-semibold">
                  {weeklySnapshot.growth === null
                    ? "N/A"
                    : `${weeklySnapshot.growth >= 0 ? "+" : ""}${weeklySnapshot.growth.toFixed(1)}%`}
                </span>
              </p>
            ) : null}
            <p className="mt-2 flex items-center gap-2 text-slate-500">
              <Upload className="h-3.5 w-3.5" />
              Upload a new weekly file to refresh all charts.
            </p>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 text-xs text-slate-600 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Resource Heatmap (Practice x GEO)</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={dataset.resourceHeatmap} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid {...HCL_CHART_GRID} />
                  <XAxis dataKey="practice" stroke={HCL_CHART_AXIS_STROKE} tick={HCL_CHART_TICK} />
                  <YAxis stroke={HCL_CHART_AXIS_STROKE} tick={HCL_CHART_TICK} />
                  <Tooltip {...HCL_CHART_TOOLTIP} />
                  <Bar dataKey="headcount" fill={ENCHANTED_ACCENT} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </section> : null}
      </main>
    </div>
  );
}
