import Link from "next/link";

export type HclSignalsActiveNav =
  | "dashboard"
  | "details"
  | "bookingCall"
  | "utilization"
  | "utilizationDetails"
  | "utilizationCompliance";

const linkClass =
  "rounded-md px-3 py-1 text-xs font-medium transition text-white/90 hover:bg-white/15 hover:text-white";
const activeClass =
  "rounded-md border border-cyan-300/40 bg-cyan-400/15 px-3 py-1 text-xs font-semibold text-cyan-100 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12)]";

function item(active: HclSignalsActiveNav, key: HclSignalsActiveNav, href: string, label: string) {
  return (
    <Link href={href} className={active === key ? activeClass : linkClass}>
      {label}
    </Link>
  );
}

/**
 * Primary app navigation — HCL blue header; keep labels and routes aligned across all report pages.
 */
export function HclSignalsNav({ active }: { active: HclSignalsActiveNav }) {
  return (
    <nav
      className="inline-flex max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto rounded-lg border border-white/30 bg-white/10 p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Reports"
    >
      {item(active, "dashboard", "/", "Dashboard")}
      {item(active, "details", "/line-by-line", "Details")}
      {item(active, "bookingCall", "/booking-call", "Booking Call")}
      {item(active, "utilization", "/utilization", "Utilization")}
      {item(active, "utilizationDetails", "/utilization-details", "Utilization Details")}
      {item(active, "utilizationCompliance", "/utilization-compliance", "Utilization Compliance")}
    </nav>
  );
}
