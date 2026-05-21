/**
 * HCL Software–style product chrome (Enchanted-inspired gradient strip).
 * @see advisor-next `hcl-brand-strip`
 */
export default function HclBrandStrip() {
  return (
    <div className="hcl-brand-strip flex items-center justify-between px-4 py-2.5 shadow-md">
      <span className="font-semibold tracking-tight">HCLSoftware</span>
      <img
        src="/project-vail-logo.png"
        alt="Project Vail logo"
        className="h-10 w-10 rounded-md border border-white/30 bg-white/15 object-cover shadow-sm"
      />
    </div>
  );
}
