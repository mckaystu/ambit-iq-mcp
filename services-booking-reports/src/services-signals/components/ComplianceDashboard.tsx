import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download } from "lucide-react";

import type { LateSubmissionHeatmapProps } from "./LateSubmissionHeatmap";
import { LateSubmissionHeatmap } from "./LateSubmissionHeatmap";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import {
  buildComplianceAuditExportCsv,
  buildComplianceLateFrequencyModel,
  buildComplianceVerificationRows,
  complianceLateCellColor,
  complianceWeekCellMissing,
  type ComplianceFrequencyModel,
  type ComplianceVerificationRow,
  type DataAuditReport,
} from "../lib/data-audit";
import { DEFAULT_WEEKLY_HOURS, formatHours, formatPercent, type ResourceMasterRow, type TimesheetRow } from "../lib/utils";

type ComplianceDashboardProps = {
  timesheetRows: TimesheetRow[];
  resourceRows: ResourceMasterRow[];
  startDate: string;
  endDate: string;
  lateModel: LateSubmissionHeatmapProps;
  dataAuditReport: DataAuditReport;
};

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ComplianceHeatmapTable({ model }: { model: ComplianceFrequencyModel }) {
  if (model.emptyReason) {
    return <p className="text-sm text-muted-foreground">{model.emptyReason}</p>;
  }
  if (model.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No active resources in the master to score.</p>;
  }

  return (
    <div className="max-h-[min(28rem,60vh)] overflow-auto rounded-md border border-slate-800">
      <table className="w-max min-w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-slate-800 bg-slate-900/90">
            <th className="sticky left-0 z-20 min-w-[10rem] max-w-[14rem] bg-slate-900 px-2 py-2 font-medium text-slate-200">Resource</th>
            <th className="whitespace-nowrap px-2 py-2 text-center font-medium text-slate-400">Late / Missing</th>
            <th className="min-w-[4rem] px-1 py-2 text-center font-medium text-slate-400">Rollup</th>
            {model.weekColumns.map((w) => (
              <th key={w} className="min-w-[2.5rem] px-0.5 py-2 text-center font-medium text-slate-500" title={`Week of ${w}`}>
                {w.slice(5)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((u) => (
            <tr key={u.resourceId} className="border-b border-slate-800/80">
              <td className="sticky left-0 z-10 max-w-[14rem] truncate bg-slate-950/95 px-2 py-1.5 font-medium text-slate-100" title={u.resourceName}>
                {u.resourceName}
              </td>
              <td className="whitespace-nowrap bg-slate-950/40 px-2 py-1.5 text-center text-slate-200">{u.lateMissingCount}</td>
              <td
                className="h-8 min-w-[4rem] px-1 py-1 text-center align-middle text-[10px] font-medium text-white/90"
                style={{ backgroundColor: complianceLateCellColor(u.lateMissingCount) }}
                title={`${u.lateMissingCount} week(s) without Posted time (after hire)`}
              >
                {u.lateMissingCount <= 1 ? "OK" : u.lateMissingCount === 2 ? "Warn" : u.lateMissingCount <= 4 ? "Risk" : "Crit"}
              </td>
              {model.weekColumns.map((w) => {
                const missing = u.byWeekMissing[w];
                return (
                  <td
                    key={w}
                    className="h-8 min-w-[2.5rem] border-l border-slate-800/60 p-0"
                    style={{ backgroundColor: complianceWeekCellMissing(missing) }}
                    title={missing ? "No Posted row for this week" : "Posted week present"}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VerificationTable({ rows }: { rows: ComplianceVerificationRow[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Set valid filter dates to build verification rows.</p>;
  }

  const toggle = (id: string) => setOpen((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="overflow-x-auto rounded-md border border-slate-800">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Resource</TableHead>
            <TableHead>Hire date</TableHead>
            <TableHead>Period</TableHead>
            <TableHead className="text-right">Available h</TableHead>
            <TableHead className="text-right">Posted h</TableHead>
            <TableHead className="text-right">Util %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const key = r.resourceSapId;
            const expanded = open[key];
            return (
              <Fragment key={key}>
                <TableRow className="hover:bg-muted/10">
                  <TableCell className="w-8 p-1">
                    <Button type="button" variant="outline" size="sm" className="h-7 w-7 border-slate-600 p-0" onClick={() => toggle(key)}>
                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-slate-100">{r.resourceName}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{r.resourceSapId}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{r.hireDateDisplay}</TableCell>
                  <TableCell className="max-w-[10rem] text-xs text-slate-400">{r.periodLabel}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatHours(r.availableHours)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatHours(r.totalPostedActuals)}</TableCell>
                  <TableCell className="text-right text-xs">{formatPercent(r.utilizationPct)}</TableCell>
                </TableRow>
                {expanded ? (
                  <TableRow className="bg-slate-950/80">
                    <TableCell colSpan={7} className="p-0">
                      <div className="border-t border-slate-800 p-3">
                        <p className="mb-2 text-xs font-medium text-slate-400">Math trace — Posted lines in period ({r.traceRows.length})</p>
                        <p className="mb-2 text-[11px] text-slate-500">{r.availableHoursMath}</p>
                        <div className="max-h-48 overflow-auto rounded border border-slate-800">
                          <table className="w-full text-left text-[11px]">
                            <thead className="bg-slate-900/80 text-slate-400">
                              <tr>
                                <th className="px-2 py-1">Start</th>
                                <th className="px-2 py-1">Finish</th>
                                <th className="px-2 py-1">Status</th>
                                <th className="px-2 py-1">Charge</th>
                                <th className="px-2 py-1 text-right">Posted</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.traceRows.map((t, i) => (
                                <tr key={`${key}-t-${i}`} className="border-t border-slate-800/80">
                                  <td className="px-2 py-1 font-mono">{t.timesheetStartDate}</td>
                                  <td className="px-2 py-1 font-mono">{t.timesheetFinishDate}</td>
                                  <td className="px-2 py-1">{t.timesheetStatus}</td>
                                  <td className="px-2 py-1">{t.timesheetChargeCode}</td>
                                  <td className="px-2 py-1 text-right font-mono">{formatHours(t.postedActuals)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function ComplianceDashboard({
  timesheetRows,
  resourceRows,
  startDate,
  endDate,
  lateModel,
  dataAuditReport,
}: ComplianceDashboardProps) {
  const [section, setSection] = useState<"compliance" | "timeliness" | "verification">("compliance");

  const freqModel: ComplianceFrequencyModel = useMemo(
    () => buildComplianceLateFrequencyModel(timesheetRows, resourceRows, startDate, endDate),
    [timesheetRows, resourceRows, startDate, endDate],
  );

  const verificationRows = useMemo(
    () => buildComplianceVerificationRows(timesheetRows, resourceRows, startDate, endDate),
    [timesheetRows, resourceRows, startDate, endDate],
  );

  const onExport = () => {
    const csv = buildComplianceAuditExportCsv(resourceRows, verificationRows, dataAuditReport);
    downloadCsv(`compliance-audit-export-${startDate || "na"}_to_${endDate || "na"}.csv`, csv);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: "compliance" as const, label: "Late / Missing map" },
              { id: "timeliness" as const, label: "Posted timeliness" },
              { id: "verification" as const, label: "Verification" },
            ] as const
          ).map((t) => (
            <Button key={t.id} type="button" size="sm" variant={section === t.id ? "default" : "outline"} onClick={() => setSection(t.id)}>
              {t.label}
            </Button>
          ))}
        </div>
        <Button type="button" variant="default" size="sm" onClick={onExport} disabled={resourceRows.length === 0}>
          <Download className="mr-2 h-4 w-4" />
          Download audit export
        </Button>
      </div>

      {section === "compliance" && (
        <Card className="border-slate-700 bg-slate-950/40">
          <CardHeader>
            <CardTitle className="text-slate-100">Compliance heatmap</CardTitle>
            <p className="text-xs text-muted-foreground">
              For each <span className="text-slate-300">Active</span> master resource and each Monday week in the filter range (after hire), a week is{" "}
              <span className="text-red-300/90">non-compliant</span> if no <span className="text-slate-300">Posted</span> timesheet exists with start
              date in that week. Row color by total late/missing weeks: 0–1 green, 2 yellow, 3–4 orange, 5+ red.
            </p>
            <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> 0–1 issues
              </span>
              <span className="inline-flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> 2 warnings
              </span>
              <span className="inline-flex items-center gap-1 text-orange-300">3–4 at risk</span>
              <span className="inline-flex items-center gap-1 text-red-300">5+ critical</span>
            </div>
          </CardHeader>
          <CardContent>
            <ComplianceHeatmapTable model={freqModel} />
          </CardContent>
        </Card>
      )}

      {section === "timeliness" && (
        <LateSubmissionHeatmap
          weekColumns={lateModel.weekColumns}
          userRows={lateModel.userRows}
          eligibleRowCount={lateModel.eligibleRowCount}
          rowsWithFinishInRange={lateModel.rowsWithFinishInRange}
          rowsWithPostedDate={lateModel.rowsWithPostedDate}
        />
      )}

      {section === "verification" && (
        <Card className="border-slate-700 bg-slate-950/40">
          <CardHeader>
            <CardTitle className="text-slate-100">Confidence — verification</CardTitle>
            <p className="text-xs text-muted-foreground">
              Available hours = calendar weeks in the selected period × {DEFAULT_WEEKLY_HOURS}h, pro-rated from hire. Posted = sum of{" "}
              <span className="text-slate-300">Posted</span> rows in period. Expand a row to see every timesheet line in the sum.
            </p>
          </CardHeader>
          <CardContent>
            <VerificationTable rows={verificationRows} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
