import type { LateSubmissionHeatmapModel } from "../lib/late-submission-heatmap-model";
import { cn } from "../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export type LateHeatmapUserRow = LateSubmissionHeatmapModel["userRows"][number];
export type LateSubmissionHeatmapProps = LateSubmissionHeatmapModel;

function cellBackground(daysLate: number | undefined): string {
  if (daysLate === undefined) {
    return "rgba(30, 41, 59, 0.85)";
  }
  if (daysLate <= 0) {
    return "rgba(5, 150, 105, 0.85)";
  }
  if (daysLate === 1) {
    return "rgba(202, 138, 4, 0.9)";
  }
  if (daysLate <= 3) {
    return "rgba(217, 119, 6, 0.92)";
  }
  return "rgba(185, 28, 28, 0.92)";
}

export function LateSubmissionHeatmap({
  weekColumns,
  userRows,
  eligibleRowCount,
  rowsWithFinishInRange,
  rowsWithPostedDate,
}: LateSubmissionHeatmapProps) {
  if (eligibleRowCount === 0) {
    return (
      <Card className="border-slate-700 bg-slate-950/40">
        <CardHeader>
          <CardTitle className="text-slate-200">Late timesheet submission heatmap</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No rows match <span className="font-medium text-slate-300">Timesheet Status = Posted</span> and{" "}
          <span className="font-medium text-slate-300">Timesheet Charge Code = CSBIL</span>.
        </CardContent>
      </Card>
    );
  }

  if (rowsWithPostedDate === 0) {
    return (
      <Card className="border-slate-700 bg-slate-950/40">
        <CardHeader>
          <CardTitle className="text-slate-200">Late timesheet submission heatmap</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Add a <span className="font-medium text-slate-300">Timesheet Posted Date</span> column (or alias Posted Date / Posted On) so posted
          timestamps can be compared to <span className="font-medium text-slate-300">Timesheet Finish Date</span>. Project start/end dates are not
          used.
        </CardContent>
      </Card>
    );
  }

  if (weekColumns.length === 0 || userRows.length === 0) {
    return (
      <Card className="border-slate-700 bg-slate-950/40">
        <CardHeader>
          <CardTitle className="text-slate-200">Late timesheet submission heatmap</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No CSBIL + Posted rows with a valid timesheet end date in the current date filter ({rowsWithFinishInRange} rows in range,{" "}
          {rowsWithPostedDate} with posted date).
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-700 bg-slate-950/40">
      <CardHeader>
        <CardTitle className="text-slate-200">Late timesheet submission heatmap</CardTitle>
        <p className="text-xs text-slate-300">
          Each cell is whole calendar days from <span className="text-slate-200">Timesheet Finish Date</span> to{" "}
          <span className="text-slate-200">Timesheet Posted Date</span> (0 = on time or early). Only{" "}
          <span className="font-medium text-slate-300">CSBIL</span> + <span className="font-medium text-slate-300">Posted</span> rows. Rows are
          ranked by how often they are late. Project start/end columns are ignored.
        </p>
        <p className="text-xs text-slate-300">
          Eligible rows: {eligibleRowCount} · With finish date in filter: {rowsWithFinishInRange} · With posted date: {rowsWithPostedDate}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-3 text-xs text-slate-200">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: "rgba(5, 150, 105, 0.85)" }} /> 0 days late
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: "rgba(202, 138, 4, 0.9)" }} /> 1 day
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: "rgba(217, 119, 6, 0.92)" }} /> 2–3 days
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: "rgba(185, 28, 28, 0.92)" }} /> 4+ days
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: "rgba(30, 41, 59, 0.85)" }} /> No row
          </span>
        </div>
        <div className="max-h-[min(32rem,70vh)] overflow-auto rounded-md border border-slate-800">
          <table className="w-max min-w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/90">
                <th className="sticky left-0 z-20 min-w-[10rem] max-w-[14rem] bg-slate-900 px-2 py-2 font-medium text-slate-200">Resource</th>
                <th className="whitespace-nowrap px-1 py-2 text-center font-medium text-slate-400">Late weeks</th>
                {weekColumns.map((w, idx) => {
                  const ym = w.slice(0, 7);
                  const prevYm = idx > 0 ? weekColumns[idx - 1]!.slice(0, 7) : null;
                  const monthBreak = prevYm !== null && ym !== prevYm;
                  return (
                    <th
                      key={w}
                      className={cn(
                        "min-w-[2.75rem] px-0.5 py-2 text-center font-medium text-slate-400",
                        monthBreak && "border-l-2 border-slate-500",
                      )}
                      title={w}
                    >
                      {w.slice(5)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {userRows.map((u) => (
                <tr key={u.resourceId} className="border-b border-slate-800/80">
                  <td className="sticky left-0 z-10 max-w-[14rem] truncate bg-slate-950/95 px-2 py-1.5 font-medium text-slate-100" title={u.resourceName}>
                    {u.resourceName}
                  </td>
                  <td className="whitespace-nowrap bg-slate-950/40 px-2 py-1.5 text-center text-slate-300">{u.lateWeekCount}</td>
                  {weekColumns.map((w, idx) => {
                    const d = u.byWeekEnd[w];
                    const ym = w.slice(0, 7);
                    const prevYm = idx > 0 ? weekColumns[idx - 1]!.slice(0, 7) : null;
                    const monthBreak = prevYm !== null && ym !== prevYm;
                    return (
                      <td
                        key={w}
                        className={cn(
                          "h-8 min-w-[2.75rem] border-l border-slate-800/60 p-0 text-center align-middle",
                          monthBreak && "border-l-2 border-slate-500/90",
                        )}
                        style={{ backgroundColor: cellBackground(d) }}
                        title={`${u.resourceName} · week ending ${w}: ${
                          d === undefined ? "No row" : d === 0 ? "On time or early (0 days late)" : `${d} day(s) late`
                        }`}
                      >
                        {d === undefined ? null : d === 0 ? (
                          <span className="text-[11px] font-medium text-white/75">0</span>
                        ) : (
                          <span className="font-semibold text-white/90">{d}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
