import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";

const globalForPg = globalThis;
let envBootstrapped = false;

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] == null || process.env[parsed.key] === "") {
      process.env[parsed.key] = parsed.value;
    }
  }
}

function bootstrapLocalEnv() {
  if (envBootstrapped) return;
  envBootstrapped = true;

  const dashboardRoot = process.cwd();
  const repoRoot = path.resolve(dashboardRoot, "..");
  const candidates = [
    path.join(dashboardRoot, ".env.local"),
    path.join(dashboardRoot, ".env"),
    path.join(repoRoot, ".env"),
  ];
  for (const candidate of candidates) {
    loadEnvFile(candidate);
  }
}

export function getPool() {
  if (!process.env.DATABASE_URL) {
    bootstrapLocalEnv();
  }
  const cs = String(process.env.DATABASE_URL || "").trim();
  if (!cs) {
    throw new Error("DATABASE_URL is not configured for dashboard API");
  }
  if (!globalForPg.__ambitDashboardPool) {
    globalForPg.__ambitDashboardPool = new Pool({ connectionString: cs, max: 5 });
  }
  return globalForPg.__ambitDashboardPool;
}
