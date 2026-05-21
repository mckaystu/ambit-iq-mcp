/** Base URL for dashboard serverless APIs (empty = same origin / Vite proxy). */
export function apiPath(path: string): string {
  const base = String(import.meta.env.VITE_DASHBOARD_API_BASE || "").replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}
