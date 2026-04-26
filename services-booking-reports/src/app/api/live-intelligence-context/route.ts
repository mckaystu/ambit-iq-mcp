import { NextResponse } from "next/server";

import { loadServicesSignalsWorkspaceSeed } from "@/lib/dataProcessor";
import { buildMonthlyUtilizationRecords } from "@/services-signals/lib/build-monthly-utilization-records";
import { runDataHealthAudit } from "@/services-signals/lib/data-health-engine";
import { isPostedCsbilTimesheetRow, type UtilizationRecord } from "@/services-signals/lib/utils";
import type { DataAuditReport } from "@/services-signals/lib/data-audit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const seed = await loadServicesSignalsWorkspaceSeed();
    const utilizationRows = buildMonthlyUtilizationRecords(seed.timesheetRows, seed.resourceRows);
    const postedCsbil = seed.timesheetRows.filter(isPostedCsbilTimesheetRow).length;
    const dataAudit = runDataHealthAudit(seed.timesheetRows, seed.resourceRows, {
      projectRevenueRowCount: 0,
      utilizationMonthlyRecordCount: utilizationRows.length,
      postedCsbilTimesheetRowCount: postedCsbil,
      uniqueFilteredUsers: new Set(utilizationRows.map((r) => r.resourceId)).size,
    });
    return NextResponse.json({ utilizationRows, dataAudit });
  } catch {
    return NextResponse.json({
      utilizationRows: [] as UtilizationRecord[],
      dataAudit: null as DataAuditReport | null,
    });
  }
}
