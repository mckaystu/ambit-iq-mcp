"use client";

import { useMemo, useState, type ReactNode } from "react";
import { RefreshCw, Sparkles } from "lucide-react";

import { bookingDisplayProductForRecord } from "@/lib/booking-display-product";
import { Button } from "@/services-signals/components/ui/button";
import type { NormalizedOpportunity } from "@/types/opportunity";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export type BookingAttainmentRow = {
  product: string;
  actualUsd: number;
  targetUsd: number;
  attainmentPct: number | null;
};

export type StageRollupShape = {
  booked: number;
  commit: number;
  upside: number;
  pipeline: number;
  total: number;
};

export type BookingIntelligenceBriefingProps = {
  filtered: NormalizedOpportunity[];
  totalRevenue: number;
  bookedDealsInScopeCount: number;
  stageRollup: StageRollupShape;
  bookingAttainmentByProduct: BookingAttainmentRow[];
  overallAttainmentPct: number;
  bookingTargetsLoaded: boolean;
  selectedFiscalYear: number | "all";
  selectedQuarter: string;
  sourceFile: string;
};

type Bullet = { title: string; body: string };

function buildBookingBriefing(props: BookingIntelligenceBriefingProps): {
  summary: string;
  bullets: Bullet[];
  footer: string;
} {
  const {
    filtered,
    totalRevenue,
    bookedDealsInScopeCount,
    stageRollup,
    bookingAttainmentByProduct,
    overallAttainmentPct,
    bookingTargetsLoaded,
    selectedFiscalYear,
    selectedQuarter,
    sourceFile,
  } = props;

  const baseFooter = `Data scope: ${sourceFile} · filters above (FY / quarter, GEO, owners, service categories, Unica).`;

  if (filtered.length === 0) {
    return {
      summary:
        "No opportunities match the current Overview filters. Adjust fiscal year, quarter, GEO, or owners to generate booking intelligence.",
      bullets: [
        {
          title: "Next step",
          body: "Widen filters or confirm the latest opportunities extract is loaded in /data.",
        },
      ],
      footer: baseFooter,
    };
  }

  const dealCount = filtered.length;
  const avgDeal = totalRevenue / dealCount;
  const fyLabel = selectedFiscalYear === "all" ? "all fiscal years" : `FY${selectedFiscalYear}`;
  const qLabel = selectedQuarter === "all" ? "all quarters" : selectedQuarter;

  const byGeo = new Map<string, number>();
  for (const row of filtered) {
    byGeo.set(row.geo, (byGeo.get(row.geo) ?? 0) + row.bookingRevenueUS);
  }
  const geoSorted = [...byGeo.entries()].sort((a, b) => b[1] - a[1]);
  const topGeo = geoSorted[0]!;
  const bottomGeo = geoSorted.length > 1 ? geoSorted[geoSorted.length - 1]! : null;
  const topGeoPct = totalRevenue > 0 ? (topGeo[1] / totalRevenue) * 100 : 0;

  const byProduct = new Map<string, number>();
  for (const row of filtered) {
    const p = bookingDisplayProductForRecord(row);
    byProduct.set(p, (byProduct.get(p) ?? 0) + row.bookingRevenueUS);
  }
  const prodSorted = [...byProduct.entries()].sort((a, b) => b[1] - a[1]);
  const topProd = prodSorted[0]!;
  const weakProd = prodSorted.length > 1 ? prodSorted[prodSorted.length - 1]! : null;

  const withTargets = bookingAttainmentByProduct.filter(
    (r) => r.targetUsd > 0 && r.attainmentPct !== null
  );
  let worst: BookingAttainmentRow | undefined;
  let best: BookingAttainmentRow | undefined;
  for (const row of withTargets) {
    const p = row.attainmentPct ?? 0;
    if (!worst || p < (worst.attainmentPct ?? 0)) worst = row;
    if (!best || p > (best.attainmentPct ?? 0)) best = row;
  }

  const nonBookedForecast = stageRollup.commit + stageRollup.upside + stageRollup.pipeline;
  const bookedShare =
    stageRollup.total > 0 ? Math.round((stageRollup.booked / stageRollup.total) * 100) : 0;

  const summary =
    `Booking pipeline in this view totals **${money.format(totalRevenue)}** across **${dealCount}** deals (**${bookedDealsInScopeCount}** with **4 - Booked**). ` +
    `Sales-forecast-weighted dollars: **Booked ${money.format(stageRollup.booked)}**, **Commit ${money.format(stageRollup.commit)}**, **Upside ${money.format(stageRollup.upside)}**, **Pipeline ${money.format(stageRollup.pipeline)}**. ` +
    `Mean booking size is **${money.format(avgDeal)}** per visible deal for **${fyLabel}** / **${qLabel}**.`;

  const bullets: Bullet[] = [];

  if (bookingTargetsLoaded && selectedFiscalYear === 2027 && withTargets.length > 0) {
    const w = worst?.attainmentPct ?? 0;
    bullets.push({
      title: "Booking attainment vs plan",
      body: `Blended **4 - Booked** actual vs FY27 plan is **${overallAttainmentPct.toFixed(1)}%** — focus delivery and pursuit on **${worst?.product ?? "lagging lanes"}** (${w.toFixed(1)}% of plan) while scaling what works in **${best?.product ?? "leading lanes"}** (${(best?.attainmentPct ?? 0).toFixed(1)}% of plan).`,
    });
  } else {
    bullets.push({
      title: "Booking attainment vs plan",
      body: "FY27 Global Targets workbook is not loaded or FY is not FY27 — load plan targets to unlock blended attainment pacing by product.",
    });
  }

  bullets.push({
    title: "Largest GEO concentration",
    body: `**${topGeo[0]}** carries **${money.format(topGeo[1])}** (~${topGeoPct.toFixed(0)}% of pipeline) — align capacity, pursuit cadence, and exec coverage for that theater.${
      bottomGeo && bottomGeo[0] !== topGeo[0]
        ? ` **${bottomGeo[0]}** is lightest at **${money.format(bottomGeo[1])}** — validate coverage and deal quality there.`
        : ""
    }`,
  });

  bullets.push({
    title: "Product lane mix",
    body: `**${topProd[0]}** leads at **${money.format(topProd[1])}** — study staffing and deal mix for replication.${
      weakProd && weakProd[0] !== topProd[0]
        ? ` **${weakProd[0]}** trails at **${money.format(weakProd[1])}** — prioritize demand, pricing, or lane-specific plays.`
        : ""
    }`,
  });

  if (nonBookedForecast > stageRollup.booked * 0.35 && nonBookedForecast > 0) {
    bullets.push({
      title: "Forecast concentration",
      body: `A large share of dollars sit in **Commit / Upside / Pipeline** (${money.format(nonBookedForecast)}) vs **4 - Booked** (${money.format(stageRollup.booked)}) — tighten stage hygiene and weekly commit reviews to protect quarter-end.`,
    });
  } else {
    bullets.push({
      title: "4 - Booked mix",
      body: `About **${bookedShare}%** of pipeline dollars are tagged **4 - Booked** — keep validating booked quality and backlog conversion on the rest.`,
    });
  }

  bullets.push({
    title: "Average deal size",
    body: `**${money.format(avgDeal)}** per visible deal — use Line-by-Line to spot outliers skewing the mean; consider segmenting by service category for account planning.`,
  });

  return {
    summary,
    bullets,
    footer: baseFooter,
  };
}

function renderWithBold(text: string): ReactNode {
  const parts = text.split(/(\*\*.+?\*\*)/g);
  return parts.map((part, i) => {
    const m = part.match(/^\*\*(.+)\*\*$/);
    if (m) return <strong key={i} className="font-semibold text-slate-100">{m[1]}</strong>;
    return <span key={i}>{part}</span>;
  });
}

export function BookingIntelligenceBriefing(props: BookingIntelligenceBriefingProps) {
  const [refreshToken, setRefreshToken] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps list tracks briefing inputs; refreshToken forces re-run
  const narrative = useMemo(() => buildBookingBriefing(props), [
    props.filtered,
    props.totalRevenue,
    props.bookedDealsInScopeCount,
    props.stageRollup.booked,
    props.stageRollup.commit,
    props.stageRollup.upside,
    props.stageRollup.pipeline,
    props.stageRollup.total,
    props.bookingAttainmentByProduct,
    props.overallAttainmentPct,
    props.bookingTargetsLoaded,
    props.selectedFiscalYear,
    props.selectedQuarter,
    props.sourceFile,
    refreshToken,
  ]);

  const hasData = props.filtered.length > 0;

  return (
    <section
      className="relative overflow-hidden border-t border-cyan-300/20 bg-gradient-to-br from-[#0f2f58]/85 via-[#101f45]/80 to-[#1a1d3a]/78 px-4 py-5 shadow-inner ring-1 ring-white/10 sm:px-6"
      aria-label="Booking intelligence briefing"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_280px_at_0%_-10%,rgba(34,211,238,0.20),transparent_60%),radial-gradient(620px_260px_at_100%_-15%,rgba(192,132,252,0.22),transparent_62%)]" />
      <div className="relative flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-fuchsia-500/15 ring-1 ring-fuchsia-300/40">
              <Sparkles className="h-5 w-5 text-fuchsia-200" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-slate-50">
                Booking intelligence briefing
              </h2>
              <p className="text-xs text-slate-400">
                Bookings, attainment (4 - Booked vs FY27 plan when loaded), GEO and product-lane mix, and
                average deal size from the current Overview filters. Click Refresh to recompute after changing
                filters or uploads.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 border-white/15 bg-white/5 text-slate-100 hover:bg-white/10"
            onClick={() => setRefreshToken((n) => n + 1)}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh insights
          </Button>
        </div>

        <div className="space-y-3 text-sm leading-relaxed text-slate-200">
          <p className="text-[15px] text-slate-100">{renderWithBold(narrative.summary)}</p>
          <ul className="list-inside list-disc space-y-1.5 text-slate-200 marker:text-cyan-300/90">
            {narrative.bullets.map((item) => (
              <li key={item.title}>
                <span className="font-semibold text-slate-200">{item.title}:</span>{" "}
                {renderWithBold(item.body)}
              </li>
            ))}
          </ul>
        </div>

        <p className="border-t border-white/10 pt-3 text-xs leading-relaxed text-slate-400">
          <span className="font-medium text-slate-300">Data note:</span> {narrative.footer}
          {hasData ? (
            <>
              {" "}
              Intelligence is derived on-device from filtered opportunities (not an external LLM).
            </>
          ) : null}
        </p>
      </div>
    </section>
  );
}
