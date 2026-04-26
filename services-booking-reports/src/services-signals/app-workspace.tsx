 "use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Filter } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ComplianceDashboard } from "./components/ComplianceDashboard";
import { PnLDashboard } from "./components/PnLDashboard";
import { DataHealthPanel } from "./components/DataHealthPanel";
import { DataValidationAuditPage } from "./components/DataValidationAuditPage";
import { ChartsSection } from "./components/ChartsSection";
import { DashboardMetrics } from "./components/DashboardMetrics";
import { FileUpload } from "./components/FileUpload";
import { InspirationDashboard } from "./components/InspirationDashboard";
import { ManagerScorecard } from "./components/ManagerScorecard";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { chartTooltipDarkProps } from "./lib/chart-tooltip";
import { runDataHealthAudit } from "./lib/data-health-engine";
import { AUDIT_MS_DAY, getAuditPeriodBounds } from "./lib/audit-compute";
import { buildMonthlyUtilizationRecords } from "./lib/build-monthly-utilization-records";
import { buildLateSubmissionHeatmapModel } from "./lib/late-submission-heatmap-model";
import type { FileUploadMeta } from "./components/FileUpload";
import { buildPnLModel, normalizeProjectJoinKey, type BuildPnLModelOptions, type ProjectRevenueRow } from "./lib/pnl-engine";
import { parseProjectFinanceWorkbook } from "./lib/project-revenue-workbook";
import { inferForecastPeriodFromTexts, type RevenueForecastPeriod } from "./lib/revenue-forecast-period";
import {
  aggregateByDimension,
  aggregateUtilizationTrend,
  formatHours,
  formatPercent,
  getAllocationHealth,
  isPostedCsbilTimesheetRow,
  normalizeKey,
  normalizeNumber,
  normalizeString,
  toDateInputValue,
  utcCalendarDayStartMs,
  type ResourceMasterRow,
  type TimesheetRow,
  type UtilizationRecord,
} from "./lib/utils";

export type ServicesSignalsAppWorkspaceProps = {
  initialTimesheetRows?: TimesheetRow[];
  initialResourceRows?: ResourceMasterRow[];
};

type GenericRow = Record<string, string | number | null>;

function canonicalizeHeader(value: string) {
  return normalizeKey(value).replace(/[^a-z0-9]/g, "");
}

function getRowValue(row: GenericRow, aliases: string[]) {
  const aliasSet = new Set(aliases.map(canonicalizeHeader));
  for (const [key, value] of Object.entries(row)) {
    if (aliasSet.has(canonicalizeHeader(key))) {
      return value;
    }
  }
  return null;
}

function maxTimesheetYearFromRows(rows: TimesheetRow[]): number | null {
  let y = 0;
  for (const r of rows) {
    const t = utcCalendarDayStartMs(r.timesheetStartDate);
    if (t === null) {
      continue;
    }
    y = Math.max(y, new Date(t).getUTCFullYear());
  }
  return y || null;
}

function App({ initialTimesheetRows = [], initialResourceRows = [] }: ServicesSignalsAppWorkspaceProps) {
  const [timesheetRows] = useState<TimesheetRow[]>(() => initialTimesheetRows);
  const [resourceRows] = useState<ResourceMasterRow[]>(() => initialResourceRows);
  const [projectRevenueRows, setProjectRevenueRows] = useState<ProjectRevenueRow[]>([]);
  const [projectRevenueForecastPeriod, setProjectRevenueForecastPeriod] = useState<RevenueForecastPeriod | null>(null);
  const [timesheetUploadCount] = useState(() => initialTimesheetRows.length);
  const [resourceUploadCount] = useState(() => initialResourceRows.length);
  const [projectRevenueUploadCount, setProjectRevenueUploadCount] = useState(0);
  const [search, setSearch] = useState("");
  const [activeView, setActiveView] = useState<"organization" | "geo" | "practice">("organization");
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [filters, setFilters] = useState({
    practice: "All",
    geo: "All",
    manager: "All",
    startDate: "",
    endDate: "",
  });
  const [sortBy, setSortBy] = useState<
    "resourceName" | "manager" | "practice" | "geo" | "postedActuals" | "utilizationPct" | "tenureYears" | "allocationHealth"
  >("utilizationPct");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(100);
  const [mainTab, setMainTab] = useState<"dashboard" | "scorecard" | "audit" | "compliance" | "pnl">("dashboard");
  const handleProjectRevenueUpload = (rows: GenericRow[], meta?: FileUploadMeta) => {
    setProjectRevenueUploadCount(rows.length);
    const defaultYear =
      Number(filters.endDate?.slice(0, 4)) ||
      Number(filters.startDate?.slice(0, 4)) ||
      maxTimesheetYearFromRows(timesheetRows) ||
      new Date().getUTCFullYear();

    const rowQuarterHints: string[] = [];
    for (const row of rows) {
      const q = getRowValue(row, ["Quarter", "Fiscal Quarter", "FY Quarter", "Period", "Revenue Quarter", "Forecast Quarter"]);
      if (q) {
        rowQuarterHints.push(String(q));
      }
    }
    const fileHints = [meta?.sourceFileName, ...rowQuarterHints].filter((s): s is string => Boolean(s && String(s).trim()));
    const inferredFromFile = inferForecastPeriodFromTexts(fileHints, defaultYear);
    const resolvedForecast = meta?.forecastPeriod ?? inferredFromFile;

    const normalized: ProjectRevenueRow[] = [];
    for (const row of rows) {
      const codeRaw = normalizeString(
        getRowValue(row, [
          "Investment Code",
          "Task ID",
          "Task Id",
          "Project ID",
          "Project Code",
          "Investment ID",
          "Investment Number",
          "Offering ID",
          "Engagement Code",
          "PSA Project ID",
        ]) ?? "",
      );
      const nameRaw = normalizeString(
        getRowValue(row, [
          "Project Name",
          "Investment Name",
          "Project Description",
          "Investment Description",
        ]) ?? "",
      );
      const projectKey = normalizeProjectJoinKey(codeRaw || nameRaw);
      if (!projectKey) {
        continue;
      }
      const revenue = normalizeNumber(
        getRowValue(row, [
          "Project Revenue",
          "Revenue",
          "Total Revenue",
          "Recognized Revenue",
          "Net Revenue",
          "Revenue USD",
          "Rev USD",
          "Amount",
          "Booking Amount",
          "Invoiced Amount",
        ]),
      );
      const projectName = nameRaw || codeRaw;
      normalized.push({ projectKey, projectName, revenue });
    }
    setProjectRevenueRows(normalized);
    setProjectRevenueForecastPeriod(normalized.length > 0 ? resolvedForecast : null);
  };

  const utilizationRows = useMemo<UtilizationRecord[]>(
    () => buildMonthlyUtilizationRecords(timesheetRows, resourceRows),
    [resourceRows, timesheetRows],
  );

  useEffect(() => {
    if (utilizationRows.length === 0) {
      return;
    }
    const timestamps = utilizationRows
      .map((row) => new Date(row.periodStart).getTime())
      .filter((value) => Number.isFinite(value));
    if (timestamps.length === 0) {
      return;
    }
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const defaultStart = toDateInputValue(new Date(minTime).toISOString());
    const defaultEnd = toDateInputValue(new Date(maxTime).toISOString());
    setFilters((prev) => {
      if (prev.startDate || prev.endDate) {
        return prev;
      }
      return { ...prev, startDate: defaultStart, endDate: defaultEnd };
    });
  }, [timesheetUploadCount, resourceUploadCount, utilizationRows]);

  const practiceOptions = useMemo(
    () => ["All", ...new Set(utilizationRows.map((row) => row.practice).filter(Boolean))],
    [utilizationRows],
  );
  const geoOptions = useMemo(() => ["All", ...new Set(utilizationRows.map((row) => row.geo).filter(Boolean))], [utilizationRows]);
  const managerOptions = useMemo(
    () => ["All", ...new Set(utilizationRows.map((row) => row.manager).filter(Boolean))],
    [utilizationRows],
  );

  const filteredRows = useMemo(() => {
    const startDate = filters.startDate ? new Date(filters.startDate).getTime() : Number.NEGATIVE_INFINITY;
    const endDate = filters.endDate ? new Date(filters.endDate).getTime() : Number.POSITIVE_INFINITY;

    return utilizationRows
      .filter((row) => (filters.practice === "All" ? true : row.practice === filters.practice))
      .filter((row) => (filters.geo === "All" ? true : row.geo === filters.geo))
      .filter((row) => (filters.manager === "All" ? true : row.manager === filters.manager))
      .filter((row) => {
        const date = new Date(row.periodStart).getTime();
        return date >= startDate && date <= endDate;
      })
      .filter((row) => {
        if (!search.trim()) {
          return true;
        }
        const candidate = `${row.resourceName} ${row.manager} ${row.practice} ${row.geo} ${row.geoCountry} ${row.allocationHealth}`.toLowerCase();
        return candidate.includes(search.toLowerCase());
      });
  }, [filters, search, utilizationRows]);

  const summarizedUserRows = useMemo(() => {
    const byUser = new Map<
      string,
      {
        resourceName: string;
        resourceId: string;
        manager: string;
        practice: string;
        geo: string;
        geoCountry: string;
        tenureYears: number;
        postedActuals: number;
        availableHours: number;
        allocationHealth: "Overloaded" | "Optimized" | "Under-utilized";
        utilizationPct: number;
        periodStart: string;
      }
    >();

    for (const row of filteredRows) {
      const existing = byUser.get(row.resourceId);
      if (existing) {
        existing.postedActuals += row.postedActuals;
        existing.availableHours += row.availableHours;
        existing.utilizationPct =
          existing.availableHours > 0 ? (existing.postedActuals / existing.availableHours) * 100 : 0;
        existing.allocationHealth = getAllocationHealth(existing.utilizationPct);
      } else {
        byUser.set(row.resourceId, {
          resourceName: row.resourceName,
          resourceId: row.resourceId,
          manager: row.manager,
          practice: row.practice,
          geo: row.geo,
          geoCountry: row.geoCountry,
          tenureYears: row.tenureYears,
          postedActuals: row.postedActuals,
          availableHours: row.availableHours,
          utilizationPct: row.availableHours > 0 ? (row.postedActuals / row.availableHours) * 100 : 0,
          allocationHealth: getAllocationHealth(
            row.availableHours > 0 ? (row.postedActuals / row.availableHours) * 100 : 0,
          ),
          periodStart: row.periodStart,
        });
      }
    }

    return Array.from(byUser.values());
  }, [filteredRows]);

  const sortedUserRows = useMemo(() => {
    return [...summarizedUserRows].sort((a, b) => {
      const direction = sortOrder === "asc" ? 1 : -1;
      const left = a[sortBy];
      const right = b[sortBy];
      if (typeof left === "number" && typeof right === "number") {
        return (left - right) * direction;
      }
      return String(left).localeCompare(String(right)) * direction;
    });
  }, [sortBy, sortOrder, summarizedUserRows]);

  const totalPages = Math.max(1, Math.ceil(sortedUserRows.length / rowsPerPage));
  const paginatedRows = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return sortedUserRows.slice(startIndex, startIndex + rowsPerPage);
  }, [currentPage, rowsPerPage, sortedUserRows]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filters.practice, filters.geo, filters.manager, filters.startDate, filters.endDate, rowsPerPage]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const totalHoursPosted = filteredRows.reduce((acc, row) => acc + row.postedActuals, 0);
  const totalHeadcount = new Set(filteredRows.map((row) => row.resourceId)).size;
  const totalAvailableHours = filteredRows.reduce((acc, row) => acc + row.availableHours, 0);
  const overallUtilizationPct =
    totalAvailableHours > 0 ? (totalHoursPosted / totalAvailableHours) * 100 : 0;
  const averageHolidayCount = filteredRows.length === 0 ? 0 : filteredRows.reduce((acc, row) => acc + row.holidayCount, 0) / filteredRows.length;

  const geoChart = aggregateByDimension(filteredRows, "geo");
  const practiceChart = aggregateByDimension(filteredRows, "practice");
  const trendChart = aggregateUtilizationTrend(filteredRows, "month").map((item) => ({ ...item, date: item.date }));
  const resourceTrend = aggregateUtilizationTrend(
    filteredRows.filter((row) => row.resourceId === selectedResourceId),
    "month",
  ).map((item) => ({ ...item, date: item.date }));

  const geoCapacityChart = useMemo(() => {
    const byGeo = new Map<string, { posted: number; available: number }>();
    for (const row of filteredRows) {
      const current = byGeo.get(row.geo) ?? { posted: 0, available: 0 };
      current.posted += row.postedActuals;
      current.available += row.availableHours;
      byGeo.set(row.geo, current);
    }
    return Array.from(byGeo.entries()).map(([geo, values]) => ({
      geo,
      postedHours: values.posted,
      availableHours: values.available,
    }));
  }, [filteredRows]);

  const workByProjectType = useMemo(() => {
    const byPractice = new Map<string, number>();
    for (const row of filteredRows) {
      byPractice.set(row.practice, (byPractice.get(row.practice) ?? 0) + row.postedActuals);
    }
    return Array.from(byPractice.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filteredRows]);

  const topAllocatedResources = useMemo(() => {
    const byResource = new Map<string, { resourceName: string; utilizationPct: number; count: number }>();
    for (const row of filteredRows) {
      const current = byResource.get(row.resourceId) ?? {
        resourceName: row.resourceName,
        utilizationPct: 0,
        count: 0,
      };
      current.utilizationPct += row.utilizationPct;
      current.count += 1;
      byResource.set(row.resourceId, current);
    }
    return Array.from(byResource.values())
      .map((item) => ({
        resourceName: item.resourceName,
        utilizationPct: item.count === 0 ? 0 : item.utilizationPct / item.count,
      }))
      .sort((a, b) => b.utilizationPct - a.utilizationPct)
      .slice(0, 15);
  }, [filteredRows]);

  const stackedWorkVsCapacity = useMemo(() => {
    const byMonth = new Map<string, { capacity: number; practiceHours: Record<string, number> }>();
    for (const row of filteredRows) {
      const current = byMonth.get(row.monthBucket) ?? { capacity: 0, practiceHours: {} };
      current.capacity += row.availableHours;
      current.practiceHours[row.practice] = (current.practiceHours[row.practice] ?? 0) + row.postedActuals;
      byMonth.set(row.monthBucket, current);
    }
    return Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, values]) => ({ month, capacity: values.capacity, ...values.practiceHours }));
  }, [filteredRows]);

  const stackedPracticeKeys = useMemo(() => {
    return Array.from(new Set(filteredRows.map((row) => row.practice))).sort((a, b) => a.localeCompare(b)).slice(0, 10);
  }, [filteredRows]);

  const handleSort = (column: typeof sortBy) => {
    if (column === sortBy) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column);
    setSortOrder("desc");
  };

  const hasData = utilizationRows.length > 0;
  const showWorkspaceTabs = timesheetRows.length > 0 && resourceRows.length > 0;

  const pnlModel = useMemo(() => {
    const buildOpts: BuildPnLModelOptions | undefined = projectRevenueForecastPeriod
      ? {
          disableEmptyWindowFallback: true,
          appendPeriodNote: `P&L labor, practice allocation, and project-level margins are limited to the revenue forecast window (${projectRevenueForecastPeriod.label}). Timesheet rows outside that quarter are excluded so totals align with forecast revenue (JFM / AMJ / JAS / OND).`,
        }
      : undefined;

    if (projectRevenueForecastPeriod) {
      let periodStart = projectRevenueForecastPeriod.periodStartMs;
      let periodEndExclusive = projectRevenueForecastPeriod.periodEndExclusiveMs;
      if (filters.startDate && filters.endDate) {
        const userBounds = getAuditPeriodBounds(filters.startDate, filters.endDate);
        if (userBounds) {
          const i0 = Math.max(periodStart, userBounds.periodStart);
          const i1 = Math.min(periodEndExclusive, userBounds.periodEndExclusive);
          if (i0 < i1) {
            periodStart = i0;
            periodEndExclusive = i1;
          }
        }
      }
      return buildPnLModel(timesheetRows, resourceRows, projectRevenueRows, periodStart, periodEndExclusive, buildOpts);
    }

    const bounds =
      filters.startDate && filters.endDate ? getAuditPeriodBounds(filters.startDate, filters.endDate) : null;
    let periodStart: number;
    let periodEndExclusive: number;
    if (bounds) {
      periodStart = bounds.periodStart;
      periodEndExclusive = bounds.periodEndExclusive;
    } else {
      const starts = timesheetRows
        .filter(isPostedCsbilTimesheetRow)
        .map((r) => utcCalendarDayStartMs(r.timesheetStartDate))
        .filter((x): x is number => x !== null);
      if (starts.length === 0) {
        return null;
      }
      periodStart = Math.min(...starts);
      periodEndExclusive = Math.max(...starts) + AUDIT_MS_DAY;
    }
    return buildPnLModel(timesheetRows, resourceRows, projectRevenueRows, periodStart, periodEndExclusive, buildOpts);
  }, [
    timesheetRows,
    resourceRows,
    projectRevenueRows,
    projectRevenueForecastPeriod,
    filters.startDate,
    filters.endDate,
  ]);

  const dataHealthReport = useMemo(
    () =>
      runDataHealthAudit(timesheetRows, resourceRows, {
        projectRevenueRowCount: projectRevenueRows.length,
        utilizationMonthlyRecordCount: utilizationRows.length,
        postedCsbilTimesheetRowCount: timesheetRows.filter(isPostedCsbilTimesheetRow).length,
        uniqueFilteredUsers: new Set(filteredRows.map((r) => r.resourceId)).size,
      }),
    [
      timesheetRows,
      resourceRows,
      projectRevenueRows.length,
      utilizationRows.length,
      filteredRows,
    ],
  );
  const csbilPostedTimesheetCount = useMemo(
    () => timesheetRows.filter(isPostedCsbilTimesheetRow).length,
    [timesheetRows],
  );
  const unmatchedPostedCount = Math.max(0, csbilPostedTimesheetCount - utilizationRows.length);

  const lateSubmissionHeatmapModel = useMemo(
    () =>
      buildLateSubmissionHeatmapModel(timesheetRows, {
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
        maxUsers: 45,
        maxWeekColumns: 52,
      }),
    [timesheetRows, filters.startDate, filters.endDate],
  );

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#090b12] via-[#0b1220] to-[#0f172a] text-slate-100">
      <div className="flex w-full flex-col gap-6 py-8">
        <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/50 p-6 text-slate-100 shadow-[0_8px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl ring-1 ring-white/5">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-cyan-500/5" />
          <div className="relative">
            <DataHealthPanel report={dataHealthReport} />
          </div>
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Data loaded &amp; optional project finance</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-2 text-sm text-slate-200 md:grid-cols-5">
              <p>Timesheet rows loaded: {timesheetUploadCount}</p>
              <p>CSBIL + Posted timesheet rows: {csbilPostedTimesheetCount}</p>
              <p>Resource master rows loaded: {resourceUploadCount}</p>
              <p>Project revenue rows loaded: {projectRevenueUploadCount}</p>
              <p>Monthly utilization records: {utilizationRows.length}</p>
              <p className="md:col-span-2">People in filtered view: {sortedUserRows.length}</p>
              {unmatchedPostedCount > 0 && (
                <p className="md:col-span-5 text-amber-300">
                  {unmatchedPostedCount} CSBIL + Posted rows did not roll into monthly records (many rows share one resource-month). If utilization is
                  empty, check Timesheet Start Date and Resource SAP ID.
                </p>
              )}
            </div>
            <div className="border-t border-slate-700/60 pt-4">
              <FileUpload
                label="Project finance (Milestones + T&amp;M) — optional"
                description="Excel workbook: tabs Project_Milestones_Data and Project_T&amp;M_Data — Column I = project name (joins to timesheet Project Investment), Column AI = revenue. Use quarter codes JFM, AMJ, JAS, OND in tab or header names."
                onUpload={handleProjectRevenueUpload}
                acceptedFileType="excel-or-csv"
                parseExcelBuffer={(buffer) =>
                  parseProjectFinanceWorkbook(buffer, {
                    defaultYear:
                      Number(filters.endDate?.slice(0, 4)) ||
                      Number(filters.startDate?.slice(0, 4)) ||
                      maxTimesheetYearFromRows(timesheetRows) ||
                      new Date().getUTCFullYear(),
                  })
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs text-muted-foreground">Search</label>
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, manager, practice, GEO" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Practice</label>
              <Select value={filters.practice} onValueChange={(value) => setFilters((prev) => ({ ...prev, practice: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Practice" />
                </SelectTrigger>
                <SelectContent>
                  {practiceOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">GEO</label>
              <Select value={filters.geo} onValueChange={(value) => setFilters((prev) => ({ ...prev, geo: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="GEO" />
                </SelectTrigger>
                <SelectContent>
                  {geoOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Manager</label>
              <Select value={filters.manager} onValueChange={(value) => setFilters((prev) => ({ ...prev, manager: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Manager" />
                </SelectTrigger>
                <SelectContent>
                  {managerOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Start Date</label>
              <Input type="date" value={filters.startDate} onChange={(event) => setFilters((prev) => ({ ...prev, startDate: event.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">End Date</label>
              <Input type="date" value={filters.endDate} onChange={(event) => setFilters((prev) => ({ ...prev, endDate: event.target.value }))} />
            </div>
            <p className="text-xs text-muted-foreground lg:col-span-2">
              Capacity standard: India = 45h/week; Americas/Europe/Middle East = 40h/week (5-day equivalent), adjusted for statutory holidays.
            </p>
          </CardContent>
        </Card>

        {!hasData && (
          <DashboardMetrics overallUtilizationPct={overallUtilizationPct} totalHoursPosted={totalHoursPosted} totalHeadcount={totalHeadcount} />
        )}

        {showWorkspaceTabs ? (
          <Tabs
            value={mainTab}
            onValueChange={(value) =>
              setMainTab(value as "dashboard" | "scorecard" | "audit" | "compliance" | "pnl")
            }
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2 gap-1 rounded-xl border border-white/10 bg-slate-950/40 p-1 ring-1 ring-white/5 sm:grid-cols-5">
              <TabsTrigger value="dashboard">Global Dashboard</TabsTrigger>
              <TabsTrigger value="scorecard">Manager Scorecard</TabsTrigger>
              <TabsTrigger value="audit">Data Validation &amp; Audit</TabsTrigger>
              <TabsTrigger value="compliance">Compliance</TabsTrigger>
              <TabsTrigger value="pnl">P&amp;L</TabsTrigger>
            </TabsList>
            <TabsContent value="dashboard" className="mt-6 flex flex-col gap-6">
            {!hasData ? (
              <Card className="border-amber-800/40 bg-slate-950/30">
                <CardContent className="py-6 text-sm text-slate-300">
                  No monthly utilization rows yet (the main dashboard expects <span className="font-medium text-slate-100">Posted</span> timesheets
                  with charge code <span className="font-medium text-slate-100">CSBIL</span>). You can still run the{" "}
                  <span className="font-medium text-amber-200">Data Validation &amp; Audit</span> tab, which sums all{" "}
                  <span className="font-medium text-slate-100">Posted</span> lines for the selected dates.
                </CardContent>
              </Card>
            ) : (
              <>
            <DashboardMetrics overallUtilizationPct={overallUtilizationPct} totalHoursPosted={totalHoursPosted} totalHeadcount={totalHeadcount} />
            <InspirationDashboard
              overallUtilizationPct={overallUtilizationPct}
              totalHoursPosted={totalHoursPosted}
              totalAvailableHours={totalAvailableHours}
              workByType={workByProjectType}
              topResources={topAllocatedResources}
              stackedWorkVsCapacity={stackedWorkVsCapacity}
              stackedPracticeKeys={stackedPracticeKeys}
            />

            <section className="flex flex-wrap gap-2">
              {[
                { key: "organization", label: "Organization View" },
                { key: "geo", label: "GEO View" },
                { key: "practice", label: "Practice View" },
              ].map((view) => (
                <Button
                  key={view.key}
                  variant={activeView === view.key ? "default" : "outline"}
                  onClick={() => setActiveView(view.key as typeof activeView)}
                >
                  {view.label}
                </Button>
              ))}
            </section>

            <ChartsSection byGeo={geoChart} byPractice={practiceChart} trend={trendChart} />

            {activeView === "organization" && (
              <Card>
                <CardHeader>
                  <CardTitle>Organization Monthly Trend</CardTitle>
                </CardHeader>
                <CardContent className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="date" stroke="#cbd5e1" />
                      <YAxis unit="%" stroke="#cbd5e1" />
                      <Tooltip {...chartTooltipDarkProps} />
                      <Line type="monotone" dataKey="averageUtilizationPct" stroke="#34d399" strokeWidth={3} name="Utilization %" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {activeView === "geo" && (
              <Card>
                <CardHeader>
                  <CardTitle>GEO Capacity vs Posted Hours</CardTitle>
                </CardHeader>
                <CardContent className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={geoCapacityChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="geo" stroke="#cbd5e1" />
                      <YAxis stroke="#cbd5e1" />
                      <Tooltip {...chartTooltipDarkProps} />
                      <Bar dataKey="postedHours" fill="#1d4ed8" name="Posted Hours" />
                      <Bar dataKey="availableHours" fill="#64748b" name="Available Hours" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {activeView === "practice" && (
              <Card>
                <CardHeader>
                  <CardTitle>Practice Utilization</CardTitle>
                </CardHeader>
                <CardContent className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={practiceChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="label" stroke="#cbd5e1" />
                      <YAxis unit="%" stroke="#cbd5e1" />
                      <Tooltip {...chartTooltipDarkProps} />
                      <Bar
                        dataKey="averageUtilizationPct"
                        fill="#fde047"
                        stroke="#fef08a"
                        strokeWidth={1}
                        name="Utilization %"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {selectedResourceId && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    Resource Drill-down: {sortedUserRows.find((row) => row.resourceId === selectedResourceId)?.resourceName}
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={resourceTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="date" stroke="#cbd5e1" />
                      <YAxis unit="%" stroke="#cbd5e1" />
                      <Tooltip {...chartTooltipDarkProps} />
                      <Line type="monotone" dataKey="averageUtilizationPct" stroke="#38bdf8" strokeWidth={3} name="Utilization %" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Detailed Utilization View</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <p className="text-muted-foreground">
                    Showing {(currentPage - 1) * rowsPerPage + 1}-{Math.min(currentPage * rowsPerPage, sortedUserRows.length)} of {sortedUserRows.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Rows per page</span>
                    <Select value={String(rowsPerPage)} onValueChange={(value) => setRowsPerPage(Number(value))}>
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[50, 100, 250, 500].map((size) => (
                          <SelectItem key={size} value={String(size)}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {[
                        { key: "resourceName", label: "Resource Name" },
                        { key: "manager", label: "Manager" },
                        { key: "practice", label: "Practice" },
                        { key: "geo", label: "GEO" },
                        { key: "tenureYears", label: "Tenure (Years)" },
                        { key: "postedActuals", label: "Total Hours" },
                        { key: "utilizationPct", label: "Utilization %" },
                        { key: "allocationHealth", label: "Allocation Health" },
                      ].map((column) => (
                        <TableHead key={column.key}>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2"
                            onClick={() => handleSort(column.key as typeof sortBy)}
                          >
                            {column.label}
                            <ArrowUpDown className="h-3 w-3" />
                          </Button>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedRows.map((row, index) => (
                      <TableRow
                        key={`${row.resourceId}-${row.periodStart}-${index}-${currentPage}`}
                        className={row.resourceId === selectedResourceId ? "bg-muted/40" : ""}
                        onClick={() => setSelectedResourceId(row.resourceId)}
                      >
                        <TableCell>{row.resourceName}</TableCell>
                        <TableCell>{row.manager}</TableCell>
                        <TableCell>{row.practice}</TableCell>
                        <TableCell>{row.geo}</TableCell>
                        <TableCell>{row.tenureYears.toFixed(1)}</TableCell>
                        <TableCell>{formatHours(row.postedActuals)}</TableCell>
                        <TableCell>{formatPercent(row.utilizationPct)}</TableCell>
                        <TableCell>{row.allocationHealth}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={currentPage <= 1}>
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage >= totalPages}
                  >
                    Next
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="grid gap-2 pt-6 text-sm text-muted-foreground md:grid-cols-3">
                <p>Total available monthly hours in scope: {formatHours(totalAvailableHours)}</p>
                <p>Average statutory holidays applied per row: {averageHolidayCount.toFixed(2)}</p>
                <p>Click any resource row to drill into monthly trend.</p>
              </CardContent>
            </Card>
            </>
            )}
            </TabsContent>
            <TabsContent value="scorecard" className="mt-6">
              <ManagerScorecard
                filteredRows={filteredRows}
                onManagerDrillDown={(managerName) => {
                  setFilters((prev) => ({ ...prev, manager: managerName }));
                  setMainTab("dashboard");
                  setCurrentPage(1);
                }}
              />
            </TabsContent>
            <TabsContent value="audit" className="mt-6">
              <DataValidationAuditPage
                timesheetRows={timesheetRows}
                resourceRows={resourceRows}
                startDate={filters.startDate}
                endDate={filters.endDate}
              />
            </TabsContent>
            <TabsContent value="compliance" className="mt-6">
              {timesheetUploadCount > 0 && resourceRows.length > 0 ? (
                <ComplianceDashboard
                  timesheetRows={timesheetRows}
                  resourceRows={resourceRows}
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  lateModel={lateSubmissionHeatmapModel}
                  dataAuditReport={dataHealthReport}
                />
              ) : (
                <Card className="border-slate-700 bg-slate-950/40">
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    Upload timesheet and resource master files to open the Compliance module (late/missing map, timeliness heatmap, and
                    verification).
                  </CardContent>
                </Card>
              )}
            </TabsContent>
            <TabsContent value="pnl" className="mt-6">
              {pnlModel ? (
                <PnLDashboard model={pnlModel} />
              ) : (
                <Card className="border-slate-700 bg-slate-950/40">
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    No CSBIL + Posted timesheet rows in scope. Upload timesheet data (with dates) to compute P&amp;L; add the Project finance workbook
                    (Milestones / T&amp;M tabs) or a header-based revenue file, and map **Project Investment** on the timesheet to revenue Column I.
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        ) : (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Add timesheet and resource master files via the page header uploads and refresh, or ensure <code className="text-slate-300">data/utilization</code>{" "}
              contains both extracts so this workspace can hydrate from the server.
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

export default App;
