import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";

import {
  auditResourceRowsToCsv,
  auditTraceToCsv,
  AUDIT_UNIFORM_WEEKLY_HOURS,
  buildAuditModel,
  buildTimesheetTrace,
  getAuditPeriodBounds,
} from "../lib/audit-compute";
import { formatHours, formatPercent, type ResourceMasterRow, type TimesheetRow } from "../lib/utils";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

type DataValidationAuditPageProps = {
  timesheetRows: TimesheetRow[];
  resourceRows: ResourceMasterRow[];
  startDate: string;
  endDate: string;
};

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function DataValidationAuditPage({ timesheetRows, resourceRows, startDate, endDate }: DataValidationAuditPageProps) {
  const [sapSearch, setSapSearch] = useState("");

  const auditModel = useMemo(
    () => buildAuditModel(timesheetRows, resourceRows, startDate, endDate),
    [timesheetRows, resourceRows, startDate, endDate],
  );

  const normalizedSearch = sapSearch.trim().toLowerCase();
  const traceRows = useMemo(() => {
    if (!auditModel || !normalizedSearch) {
      return [];
    }
    const bounds = getAuditPeriodBounds(startDate, endDate);
    if (!bounds) {
      return [];
    }
    return buildTimesheetTrace(timesheetRows, sapSearch.trim(), bounds.periodStart, bounds.periodEndExclusive);
  }, [auditModel, normalizedSearch, timesheetRows, sapSearch, startDate, endDate]);

  const traceSum = useMemo(() => traceRows.reduce((s, r) => s + r.postedActuals, 0), [traceRows]);

  if (!startDate || !endDate) {
    return (
      <Card className="border-amber-700/50 bg-slate-950/40">
        <CardHeader>
          <CardTitle className="text-amber-200">Data Validation &amp; Audit</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-300">
          Set <span className="font-medium text-slate-100">Start Date</span> and <span className="font-medium text-slate-100">End Date</span> in the
          filters above. The audit uses that inclusive calendar range (UTC day boundaries) for Posted timesheet lines and capacity math.
        </CardContent>
      </Card>
    );
  }

  if (!auditModel) {
    return (
      <Card className="border-red-800/50 bg-slate-950/40">
        <CardHeader>
          <CardTitle className="text-red-200">Data Validation &amp; Audit</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-300">Invalid date range (ensure start is on or before end).</CardContent>
      </Card>
    );
  }

  const {
    globalTotals,
    resourceRows: auditResourceRows,
    fullPeriodWeeksMath,
    periodStartDisplay,
    periodEndDisplay,
    fullPeriodWeeks,
  } = auditModel;

  const handleDownloadAuditCsv = () => {
    const csv = auditResourceRowsToCsv(auditResourceRows);
    downloadTextFile(`utilization-audit-${periodStartDisplay}_to_${periodEndDisplay}.csv`, csv);
  };

  const handleDownloadTraceCsv = () => {
    if (!sapSearch.trim()) {
      return;
    }
    const csv = auditTraceToCsv(traceRows, sapSearch.trim());
    downloadTextFile(`timesheet-trace-${sapSearch.trim().replace(/\s+/g, "_")}-${periodStartDisplay}.csv`, csv);
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-slate-700 bg-slate-950/40">
        <CardHeader>
          <CardTitle className="text-slate-100">Data Validation &amp; Audit</CardTitle>
          <p className="text-xs text-muted-foreground">
            Available hours follow the same rules as the main dashboard: each calendar month uses{" "}
            <span className="font-medium text-slate-300">getMonthlyAvailableHours</span> with GEO-derived weekly hours (e.g. India 45h, Americas/EMEA
            40h) and regional public holidays; months are prorated by overlap with the filter window and with{" "}
            <span className="text-slate-300">HCL Date of Hire</span> when hire lands mid-period. Utilization % = Posted Actuals ÷ Available Hours × 100.
            Only <span className="font-medium text-slate-300">Timesheet Status = Posted</span> rows are summed (charge code not filtered here).
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 text-sm text-slate-300 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-700/80 bg-slate-900/50 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Period</p>
              <p className="mt-1 font-medium text-slate-100">
                {periodStartDisplay} → {periodEndDisplay}
              </p>
              <p className="mt-1 text-xs text-slate-400">Window: {fullPeriodWeeksMath}</p>
            </div>
            <div className="rounded-lg border border-slate-700/80 bg-slate-900/50 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total headcount (active)</p>
              <p className="mt-1 text-2xl font-semibold text-cyan-300">{globalTotals.activeHeadcount}</p>
              <p className="mt-1 text-xs text-slate-400">Master Active ≠ false, Available Hours &gt; 0 (timesheet-only rows default to active).</p>
            </div>
            <div className="rounded-lg border border-slate-700/80 bg-slate-900/50 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total potential capacity (GEO model)</p>
              <p className="mt-1 text-2xl font-semibold text-slate-100">{formatHours(globalTotals.totalPotentialCapacityGeo)} h</p>
              <p className="mt-1 text-xs text-slate-400">Sum of monthly GEO capacity for active resources (hire + window prorated).</p>
            </div>
            <div className="rounded-lg border border-slate-700/80 bg-slate-900/50 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total recorded actuals</p>
              <p className="mt-1 text-2xl font-semibold text-amber-300">{formatHours(globalTotals.totalRecordedActuals)} h</p>
              <p className="mt-1 text-xs text-slate-400">Sum of Posted rows in the period (all resources).</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-slate-700/80 bg-slate-900/50 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Delta (GEO potential − recorded)</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-300">{formatHours(globalTotals.deltaGeo)} h</p>
            </div>
            <div className="rounded-lg border border-slate-700/80 bg-slate-900/50 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Uniform check (H × 40 × weeks)</p>
              <p className="mt-1 text-lg font-semibold text-slate-200">{formatHours(globalTotals.totalPotentialCapacityUniform)} h</p>
              <p className="text-xs text-slate-400">
                {globalTotals.activeHeadcount} × {AUDIT_UNIFORM_WEEKLY_HOURS}h × {fullPeriodWeeks.toFixed(2)} wk · Δ{" "}
                {formatHours(globalTotals.deltaUniform)} h
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-950/40">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-slate-200">Spot-check: Resource SAP ID</CardTitle>
            <p className="text-xs text-muted-foreground">
              Enter a Resource SAP ID to list every Posted timesheet line in the period (manual sum should match Total Posted Actuals for that ID).
            </p>
          </div>
          <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={sapSearch}
                onChange={(e) => setSapSearch(e.target.value)}
                placeholder="Resource SAP ID"
              />
            </div>
            <Button type="button" variant="outline" size="sm" disabled={!sapSearch.trim() || traceRows.length === 0} onClick={handleDownloadTraceCsv}>
              <Download className="mr-1 h-4 w-4" />
              Trace CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!normalizedSearch ? (
            <p className="text-sm text-muted-foreground">Type a Resource SAP ID to load the calculation trace.</p>
          ) : traceRows.length === 0 ? (
            <p className="text-sm text-amber-200">No Posted timesheet lines in the selected period for this ID.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-slate-300">
                <span className="font-medium text-slate-100">{traceRows.length}</span> line(s) · Sum of Posted Actuals:{" "}
                <span className="font-mono text-cyan-300">{formatHours(traceSum)}</span> h
              </p>
              <div className="overflow-x-auto rounded-md border border-slate-700">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Start</TableHead>
                      <TableHead>Finish</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Charge code</TableHead>
                      <TableHead className="text-right">Posted actuals</TableHead>
                      <TableHead>Name (line)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {traceRows.map((row, i) => (
                      <TableRow key={`${row.timesheetStartDate}-${i}`}>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{row.timesheetStartDate}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{row.timesheetFinishDate}</TableCell>
                        <TableCell>{row.timesheetStatus}</TableCell>
                        <TableCell>{row.timesheetChargeCode}</TableCell>
                        <TableCell className="text-right font-mono">{formatHours(row.postedActuals)}</TableCell>
                        <TableCell>{row.resourceName}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-950/40">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-slate-200">Audit table (per resource)</CardTitle>
          <Button type="button" onClick={handleDownloadAuditCsv} disabled={auditResourceRows.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Download Audit CSV
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {auditResourceRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No resource master or Posted timesheet rows to audit.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resource name</TableHead>
                  <TableHead>GEO (capacity)</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Hire date</TableHead>
                  <TableHead>Period start</TableHead>
                  <TableHead>Period end</TableHead>
                  <TableHead>Calculated available hours</TableHead>
                  <TableHead className="text-right">Total posted actuals</TableHead>
                  <TableHead className="text-right">Utilization %</TableHead>
                  <TableHead>Discrepancy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditResourceRows.map((row) => (
                  <TableRow key={row.resourceSapId}>
                    <TableCell className="max-w-[12rem]">
                      <div className="font-medium text-slate-100">{row.resourceName}</div>
                      <div className="font-mono text-xs text-muted-foreground">{row.resourceSapId}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{row.geoCapacityLabel}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{row.activeDisplay}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.hireDateDisplay}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.periodStartDisplay}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.periodEndDisplay}</TableCell>
                    <TableCell className="max-w-lg min-w-[14rem] whitespace-pre-wrap text-xs text-slate-300">
                      <div className="font-mono text-sm text-cyan-200">{formatHours(row.calculatedAvailableHours)} h</div>
                      <div className="mt-1 text-muted-foreground">{row.availableHoursMath}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatHours(row.totalPostedActuals)}</TableCell>
                    <TableCell className="text-right">{formatPercent(row.computedUtilizationPct)}</TableCell>
                    <TableCell>
                      {row.discrepancy === "Warning" ? (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-200 ring-1 ring-amber-500/40">
                          Warning
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
    </div>
  );
}
