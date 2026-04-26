"use client";

import { useMemo, useState } from "react";

import { LateSubmissionHeatmap } from "@/services-signals/components/LateSubmissionHeatmap";
import { buildLateSubmissionHeatmapModel } from "@/services-signals/lib/late-submission-heatmap-model";
import type { TimesheetRow } from "@/services-signals/lib/utils";

type Props = {
  timesheetRows: TimesheetRow[];
  defaultStart: string;
  defaultEnd: string;
};

export function UtilizationComplianceClient({ timesheetRows, defaultStart, defaultEnd }: Props) {
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);

  const model = useMemo(
    () =>
      buildLateSubmissionHeatmapModel(timesheetRows, {
        startDate: start.trim() || undefined,
        endDate: end.trim() || undefined,
        maxUsers: 80,
        maxWeekColumns: 52,
      }),
    [timesheetRows, start, end],
  );

  if (timesheetRows.length === 0) {
    return (
      <section className="rounded-xl border border-amber-500/40 bg-amber-950/35 px-4 py-4 text-sm text-amber-100 shadow-sm ring-1 ring-amber-500/20">
        No timesheet rows are available. Upload a timesheet extract via the page header and refresh so this view can load CSBIL + Posted lines.
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">Finish date range</h2>
        <p className="mt-1 text-xs text-slate-500">
          Filters rows by <span className="font-medium text-slate-700">Timesheet Finish Date</span> (week columns use the same week-ending dates).
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="compliance-start" className="mb-1 block text-xs font-medium text-slate-600">
              Start
            </label>
            <input
              id="compliance-start"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm"
            />
          </div>
          <div>
            <label htmlFor="compliance-end" className="mb-1 block text-xs font-medium text-slate-600">
              End
            </label>
            <input
              id="compliance-end"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setStart(defaultStart);
              setEnd(defaultEnd);
            }}
            className="rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
          >
            Reset to dataset scope
          </button>
        </div>
      </section>

      <LateSubmissionHeatmap {...model} />
    </div>
  );
}
