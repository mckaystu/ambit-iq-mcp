export type SortDirection = "asc" | "desc";

/** Product lanes for booking attainment / utilization strips (order: Domino+ → DX → MX → Commerce → Unica). */
export type BookingTargetProductKey = "Domino+" | "DX" | "MX" | "Commerce" | "Unica";

export interface NormalizedOpportunity {
  id: string;
  name: string;
  geo: string;
  /** Customer / account name (e.g. End Customer on Lab Services extract). */
  owner: string;
  /** HCL seller / opportunity owner when present on the sheet. */
  hclOpportunityOwner: string;
  serviceCategory: string;
  subServiceCategory: string;
  pipelineStage: string;
  stageOrder: number;
  /** Raw value from the opportunities extract (e.g. All Lab Services Opportunities). */
  salesForecastState: string;
  /** True when Sales Forecast State is **4 - Booked** (booking attainment uses this, not pipeline stage). */
  salesForecastBooked: boolean;
  bookingRevenueUS: number;
  activeStageStarted: string | null;
  estCloseDate: string | null;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  fiscalQuarterLabel: "AMJ" | "JAS" | "OND" | "JFM" | null;
  /** From sheet column **Y Close Quarter** (or alias); used on Line-by-Line quarter filter. */
  closeQuarterLabel: "AMJ" | "JAS" | "OND" | "JFM" | null;
  /** From sheet **Fiscal Year** (e.g. FY27); canonical calendar year (2027). Line-by-Line matches this + close quarter. */
  sheetFiscalYear: number | null;
}

export interface ProcessedDataset {
  sourceFile: string;
  latestDataDate: string | null;
  fiscalYearStartMonth: number;
  records: NormalizedOpportunity[];
  /** FY27 (or configured) booking USD targets by product × fiscal quarter — from Global Targets workbook. */
  bookingTargets: {
    loaded: boolean;
    sourceFile: string | null;
    parseError: string | null;
    targetsUsd: Partial<
      Record<BookingTargetProductKey, Partial<Record<"AMJ" | "JAS" | "OND" | "JFM", number>>>
    >;
  };
  historicalTrend: {
    sourceFile: string;
    snapshotDate: string;
    weekLabel: string;
    dominoPlus: number;
    dx: number;
    mx: number;
    commerce: number;
    unica: number;
    total: number;
  }[];
  utilization: {
    sourceFiles: {
      timesheet: string | null;
      resource: string | null;
    };
    scope: {
      periodStart: string | null;
      periodEnd: string | null;
      postedCsbilRows: number;
      distinctResources: number;
    };
    products: {
      product: "Domino+" | "DX" | "MX" | "Commerce" | "Unica";
      postedHours: number;
      availableHours: number;
      utilizationPct: number;
      headcount: number;
    }[];
    resources: {
      resourceId: string;
      resourceName: string;
      manager: string;
      geo: string;
      practice: string;
      product: "Domino+" | "DX" | "MX" | "Commerce" | "Unica";
      postedHours: number;
      availableHours: number;
      utilizationPct: number;
    }[];
    managers: {
      manager: string;
      postedHours: number;
      availableHours: number;
      utilizationPct: number;
      headcount: number;
    }[];
    byGeo: {
      label: string;
      postedHours: number;
      availableHours: number;
      utilizationPct: number;
    }[];
    byPractice: {
      label: string;
      postedHours: number;
      availableHours: number;
      utilizationPct: number;
    }[];
    trend: {
      month: string;
      postedHours: number;
      availableHours: number;
      utilizationPct: number;
    }[];
    overallUtilizationPct: number;
    totalPostedHours: number;
    totalAvailableHours: number;
    workByProduct: {
      name: string;
      value: number;
    }[];
    topResources: {
      resourceName: string;
      utilizationPct: number;
    }[];
    monthlyWorkVsCapacity: ({
      month: string;
      capacity: number;
    } & Record<string, number | string>)[];
    monthlyProductKeys: string[];
  };
  pipelineVelocity: {
    currentTotal: number;
    previousTotal: number;
    delta: number;
    pctChange: number | null;
  };
  resourceHeatmap: {
    practice: string;
    geo: string;
    headcount: number;
  }[];
}
