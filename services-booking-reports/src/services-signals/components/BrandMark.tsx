import { cn } from "../lib/utils";

/** HCLSoftware wordmark — HCL in product blue; "Software" neutral for contrast on dark UI. */
const HCL_SOFTWARE_BLUE = "#0f62fe";

type BrandMarkProps = {
  className?: string;
  /** Larger hero-style mark (default is compact for nav/header). */
  variant?: "compact" | "hero";
};

export function BrandMark({ className, variant = "compact" }: BrandMarkProps) {
  const isHero = variant === "hero";
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        className={cn("rounded-full", isHero ? "h-11 w-1.5" : "h-8 w-1")}
        style={{ backgroundColor: HCL_SOFTWARE_BLUE }}
        aria-hidden
      />
      <div className="flex flex-col leading-none">
        <span
          className={cn(
            "font-bold tracking-tight text-white",
            isHero ? "text-2xl sm:text-3xl" : "text-base sm:text-lg",
          )}
        >
          <span style={{ color: HCL_SOFTWARE_BLUE }}>HCL</span>
          <span className="text-slate-50">Software</span>
        </span>
        {isHero && (
          <span className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-slate-400">Lab Services</span>
        )}
      </div>
    </div>
  );
}
