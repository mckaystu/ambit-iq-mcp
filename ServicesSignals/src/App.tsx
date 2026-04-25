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

import { ChartsSection } from "./components/ChartsSection";
import { DashboardMetrics } from "./components/DashboardMetrics";
import { FileUpload } from "./components/FileUpload";
import { InspirationDashboard } from "./components/InspirationDashboard";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { chartTooltipDarkProps } from "./lib/chart-tooltip";
import {
  aggregateByDimension,
  aggregateUtilizationTrend,
  extractCountryFromGeoObs,
  formatHours,
  formatPercent,
  getAllocationHealth,
  getMonthBucket,
  getMonthStart,
  getMonthlyAvailableHours,
  getTenureYears,
  normalizeDateValue,
  normalizeKey,
  normalizeNumber,
  normalizeString,
  type ResourceMasterRow,
  type TimesheetRow,
  type UtilizationRecord,
} from "./lib/utils";

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

function getColumnValueByIndex(row: GenericRow, index: number) {
  const values = Object.values(row);
  return values[index] ?? null;
}

function toDateInputValue(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

function App() {
  const [timesheetRows, setTimesheetRows] = useState<TimesheetRow[]>([]);
  const [resourceRows, setResourceRows] = useState<ResourceMasterRow[]>([]);
  const [timesheetUploadCount, setTimesheetUploadCount] = useState(0);
  const [resourceUploadCount, setResourceUploadCount] = useState(0);
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

  const handleTimesheetUpload = (rows: GenericRow[]) => {
    setTimesheetUploadCount(rows.length);
    const normalized = rows.map((row) => ({
      timesheetStartDate: normalizeDateValue(
        getRowValue(row, ["Timesheet Start Date", "Start Date", "Week Start", "TimesheetStartDate"]),
      ),
      timesheetFinishDate: normalizeDateValue(
        getRowValue(row, ["Timesheet Finish Date", "Finish Date", "Week End", "TimesheetFinishDate"]),
      ),
      timesheetStatus: normalizeString(getColumnValueByIndex(row, 6) ?? getRowValue(row, ["Timesheet Status", "Status"])),
      hclPractice: normalizeString(getRowValue(row, ["HCL Practice", "Practice", "HCL SW Practice"])),
      resourceName: normalizeString(getRowValue(row, ["Resource Name", "Full Name", "Employee Name"])),
      resourceSapId: normalizeString(getRowValue(row, ["Resource SAP ID", "Resource ID", "SAP ID", "Employee ID"])),
      resourceManager: normalizeString(getRowValue(row, ["Resource Manager", "Manager"])),
      postedActuals: normalizeNumber(getRowValue(row, ["Posted Actuals", "Actuals", "Hours", "Posted Hours"])),
    }));
    setTimesheetRows(normalized);
  };

  const handleResourceUpload = (rows: GenericRow[]) => {
    setResourceUploadCount(rows.length);
    const normalized = rows.map((row) => ({
      fullName: normalizeString(getRowValue(row, ["Full Name", "Resource Name", "Employee Name"])),
      resourceId: normalizeString(getRowValue(row, ["Resource ID", "Resource SAP ID", "SAP ID", "Employee ID"])),
      hclSwPractice: normalizeString(getRowValue(row, ["HCL SW Practice", "HCL Practice", "Practice"])),
      hclGeoObs: normalizeString(getRowValue(row, ["HCL GEO OBS", "GEO", "Geo", "Location"])),
      manager: normalizeString(getRowValue(row, ["Manager", "Resource Manager"])),
      hclDateOfHire: normalizeDateValue(getRowValue(row, ["HCL Date of Hire", "Date of Hire", "Hire Date"])),
    }));
    const usableRows = normalized.filter((row) => row.resourceId || row.fullName);
    setResourceRows(usableRows);
  };

  const utilizationRows = useMemo<UtilizationRecord[]>(() => {
    const resourceById = new Map<string, ResourceMasterRow>();
    for (const resource of resourceRows) {
      if (resource.resourceId) {
        resourceById.set(resource.resourceId, resource);
      }
    }

    const monthlyPostedHours = new Map<
      string,
      {
        postedActuals: number;
        resourceName: string;
        resourceId: string;
        manager: string;
        practice: string;
        geo: string;
        geoCountry: string;
        tenureYears: number;
        monthBucket: string;
        periodStart: string;
      }
    >();

    const sourceRows = timesheetRows.filter((item) => normalizeKey(item.timesheetStatus) === "posted");

    for (const row of sourceRows) {
      const resource = resourceById.get(row.resourceSapId);
      const practice = resource?.hclSwPractice || row.hclPractice || "Unassigned";
      const rawGeo = resource?.hclGeoObs || "Unassigned";
      const geoCountry = extractCountryFromGeoObs(rawGeo);
      const geo = geoCountry;
      const manager = resource?.manager || row.resourceManager || "Unassigned";
      const monthBucket = getMonthBucket(row.timesheetStartDate);
      const periodStart = getMonthStart(row.timesheetStartDate);
      const resourceId = row.resourceSapId || "Unassigned";
      if (!monthBucket || !periodStart) {
        continue;
      }
      const mapKey = `${resourceId}-${monthBucket}`;
      const current = monthlyPostedHours.get(mapKey);
      if (current) {
        current.postedActuals += row.postedActuals;
      } else {
        monthlyPostedHours.set(mapKey, {
          postedActuals: row.postedActuals,
          resourceName: row.resourceName || resource?.fullName || "Unknown",
          resourceId,
          manager,
          practice,
          geo,
          geoCountry,
          tenureYears: getTenureYears(resource?.hclDateOfHire ?? "", periodStart),
          monthBucket,
          periodStart,
        });
      }
    }

    return Array.from(monthlyPostedHours.values()).map((row) => {
      const capacity = getMonthlyAvailableHours(row.monthBucket, row.geo);
      const utilizationPct = capacity.availableHours > 0 ? (row.postedActuals / capacity.availableHours) * 100 : 0;
      return {
        periodStart: row.periodStart,
        monthBucket: row.monthBucket,
        resourceName: row.resourceName,
        resourceId: row.resourceId,
        manager: row.manager,
        practice: row.practice,
        geo: row.geo,
        geoCountry: row.geoCountry,
        tenureYears: row.tenureYears,
        postedActuals: row.postedActuals,
        availableHours: capacity.availableHours,
        holidayCount: capacity.holidayCount,
        allocationHealth: getAllocationHealth(row.postedActuals),
        utilizationPct,
      };
    });
  }, [resourceRows, timesheetRows]);

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
        existing.allocationHealth = getAllocationHealth(existing.postedActuals);
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
          allocationHealth: getAllocationHealth(row.postedActuals),
          utilizationPct: row.availableHours > 0 ? (row.postedActuals / row.availableHours) * 100 : 0,
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
  const postedTimesheetCount = useMemo(
    () => timesheetRows.filter((row) => normalizeKey(row.timesheetStatus) === "posted").length,
    [timesheetRows],
  );
  const unmatchedPostedCount = Math.max(0, postedTimesheetCount - utilizationRows.length);

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#090b12] via-[#0b1220] to-[#0f172a] text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <header className="rounded-2xl border border-slate-700/70 bg-slate-900/70 p-6 text-slate-100 shadow-lg backdrop-blur">
          <h1 className="text-3xl font-semibold tracking-tight text-amber-300">Professional Services Utilization Dashboard</h1>
          <p className="mt-2 text-sm text-slate-300">
            Organization, GEO, and practice utilization views with monthly capacity based on workdays minus statutory holidays.
          </p>
        </header>

        <section className="grid gap-4 lg:grid-cols-2">
          <FileUpload
            label="Timesheet Data"
            description="Drop Excel or CSV with Timesheet Start Date, Status, Resource SAP ID, and Posted Actuals."
            onUpload={handleTimesheetUpload}
            acceptedFileType="excel-or-csv"
          />
          <FileUpload
            label="Resource Master"
            description="Drop CSV with Resource ID, HCL SW Practice, HCL GEO OBS, and Manager."
            onUpload={handleResourceUpload}
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Upload Processing Summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-slate-200 md:grid-cols-4">
            <p>Timesheet rows loaded: {timesheetUploadCount}</p>
            <p>Posted rows (Column G only): {postedTimesheetCount}</p>
            <p>Resource master rows loaded: {resourceUploadCount}</p>
            <p>Monthly utilization records: {utilizationRows.length}</p>
            <p>Unique users after filters/search: {sortedUserRows.length}</p>
            {unmatchedPostedCount > 0 && (
              <p className="md:col-span-4 text-amber-300">
                {unmatchedPostedCount} posted rows did not form monthly records. Check `Timesheet Start Date` and `Resource SAP ID` values.
              </p>
            )}
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

        <DashboardMetrics overallUtilizationPct={overallUtilizationPct} totalHoursPosted={totalHoursPosted} totalHeadcount={totalHeadcount} />

        {hasData ? (
          <>
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
        ) : (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Upload both files to calculate utilization analytics.
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

export default App;
