import { Pool } from "pg";

const globalForPg = globalThis;

export function getPool() {
  const cs = String(process.env.DATABASE_URL || "").trim();
  if (!cs) {
    throw new Error("DATABASE_URL is not configured for dashboard API");
  }
  if (!globalForPg.__ambitDashboardPool) {
    globalForPg.__ambitDashboardPool = new Pool({ connectionString: cs, max: 5 });
  }
  return globalForPg.__ambitDashboardPool;
}
