import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Ensure DATABASE_URL is available in local API/serverless handlers that do not
 * inject .env.local automatically.
 * No-op if DATABASE_URL is already set by the current runtime.
 */
let didTry = false;

function pickDatabaseUrl(): void {
  const d = process.env.DATABASE_URL?.trim();
  if (d) return;
  const fallback =
    process.env.POSTGRES_URL?.trim() ||
    process.env.POSTGRES_PRISMA_URL?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    process.env.NEON_DATABASE_URL?.trim();
  if (fallback) process.env.DATABASE_URL = fallback;
}

export function loadLocalEnv(): void {
  if (didTry) return;
  didTry = true;
  pickDatabaseUrl();
  if (process.env.DATABASE_URL?.trim()) return;

  const here = dirname(fileURLToPath(import.meta.url));
  const fromApiFolder = resolve(here, "..");
  const cwd = process.cwd();
  const roots = [fromApiFolder, cwd, resolve(cwd, "DX.IQ")];
  const seen = new Set<string>();
  for (const root of roots) {
    const norm = resolve(root);
    if (seen.has(norm)) continue;
    seen.add(norm);
    // dotenv ignores missing files; try every root because import.meta.url may not
    // point at DX.IQ after vercel bundles the function.
    config({ path: resolve(norm, ".env") });
    config({ path: resolve(norm, ".env.local"), override: true });
    pickDatabaseUrl();
    if (process.env.DATABASE_URL?.trim()) return;
  }

  // Last resort: dotenv default search from cwd (may find nothing)
  config();
  pickDatabaseUrl();
}

loadLocalEnv();
