import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { maskSensitivePayload } from "./masking.js";
import {
  CHAIN_GENESIS_PREVIOUS_HASH,
  advisoryLockSql,
  generateRowHash,
  loadSigningPrivateKeyPem,
  loadVerifyingPublicKeyPem,
  signLogHashRsaSha256,
  verifyLogHashSignatureRsaSha256,
} from "./integrity.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrisma(): PrismaClient | null {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) return null;
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({
      log: process.env.PRISMA_LOG === "1" ? ["query", "error", "warn"] : ["error"],
    });
  }
  return globalForPrisma.prisma;
}

/**
 * When DATABASE_URL is set, tamper-evident DB rows require a PEM private key.
 * Returns an error message to surface to the client, or null if OK / no DB.
 */
export function assertTamperPersistenceConfigured(): string | null {
  if (!getPrisma()) return null;
  if (!loadSigningPrivateKeyPem()) {
    return (
      "Fail-secure: DATABASE_URL is set but AMBIT_SIGNING_KEY (RSA PEM private key) is missing. " +
      "log_vibe_transaction will not persist to PostgreSQL without signing. " +
      "Set AMBIT_SIGNING_KEY or unset DATABASE_URL to use local fallback only."
    );
  }
  return null;
}

/** Writable fallback dir: Vercel/AWS only allow /tmp, not the deployment root. */
function grcFallbackDirectory(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join("/tmp", "ambit-iq-grc-fallback");
  }
  return path.join(process.cwd(), ".ambit", "grc-fallback");
}

async function writeFallbackLocal(payload: Record<string, unknown>): Promise<string> {
  const dir = grcFallbackDirectory();
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${Date.now()}-decision-log.json`);
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

function promiseTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(label)), ms)),
  ]);
}

async function persistChainedRowToPostgres(
  client: PrismaClient,
  data: {
    traceId: string;
    actorId: string;
    intentPrompt: string;
    proposedCode: string;
    decision: boolean;
    violations: Prisma.InputJsonValue;
    rawOpaPayload: Prisma.InputJsonValue;
    metadata: Prisma.InputJsonValue;
  },
): Promise<void> {
  const privateKey = loadSigningPrivateKeyPem();
  if (!privateKey) {
    throw new Error("AMBIT_SIGNING_KEY missing");
  }

  const ts = new Date();
  const timestampISO = ts.toISOString();
  const { ADVISORY_LOCK_KEY1, ADVISORY_LOCK_KEY2 } = advisoryLockSql();

  await promiseTimeout(
    client.$transaction(async (tx) => {
      // Two-arg lock expects PostgreSQL integer keys; Prisma may otherwise send bigint and PG has no matching overload.
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
        ADVISORY_LOCK_KEY1,
        ADVISORY_LOCK_KEY2,
      );

      const headRows = await tx.$queryRaw<Array<{ log_hash: string | null }>>(
        Prisma.sql`
          SELECT log_hash
          FROM ambit_decision_logs
          ORDER BY timestamp DESC, id DESC
          LIMIT 1
          FOR UPDATE
        `,
      );

      const head = headRows[0];
      if (head && (head.log_hash == null || head.log_hash === "")) {
        throw new Error(
          "integrity_chain_head_corrupt: latest row has no log_hash (legacy data). Repair or truncate before appending.",
        );
      }

      const previousHashForNew =
        head?.log_hash && head.log_hash.length > 0 ? head.log_hash : CHAIN_GENESIS_PREVIOUS_HASH;

      const logHash = generateRowHash(
        {
          traceId: data.traceId,
          timestamp: timestampISO,
          intentPrompt: data.intentPrompt,
          proposedCode: data.proposedCode,
          decision: data.decision,
        },
        previousHashForNew,
      );

      const signature = signLogHashRsaSha256(logHash, privateKey);

      await tx.ambitDecisionLog.create({
        data: {
          traceId: data.traceId,
          timestamp: ts,
          actorId: data.actorId,
          intentPrompt: data.intentPrompt,
          proposedCode: data.proposedCode,
          decision: data.decision,
          violations: data.violations,
          rawOpaPayload: data.rawOpaPayload,
          metadata: data.metadata,
          previousHash: previousHashForNew,
          logHash,
          signature,
        },
      });
    }),
    12_000,
    "database_transaction_timeout",
  );
}

export interface VibeTransactionInput {
  traceId?: string;
  actorId: string;
  intentPrompt: string;
  proposedCode: string;
  decision: boolean;
  violations: unknown;
  rawOpaPayload: unknown;
  metadata: Record<string, unknown>;
}

export type PersistVibeDecisionResult =
  | { status: "inserted_postgres" }
  | { status: "wrote_fallback"; reason: "no_database_url"; path: string }
  | { status: "wrote_fallback"; reason: "signing_key_missing_after_schedule"; path: string }
  | {
      status: "wrote_fallback";
      reason: "db_integrity_persist_failed";
      path: string;
      error: string;
    };

/**
 * Persists the decision log (Postgres chain + signature, or JSON fallback).
 * Returns a Promise so serverless hosts (e.g. Vercel) keep the invocation alive until the write finishes;
 * fire-and-forget work is often frozen before Prisma completes.
 */
export async function persistVibeDecision(input: VibeTransactionInput): Promise<PersistVibeDecisionResult> {
  const traceId = input.traceId?.trim() || randomUUID();
  const maskedRaw = maskSensitivePayload(input.rawOpaPayload) as object;
  const maskedViolations = maskSensitivePayload(input.violations);
  const meta = maskSensitivePayload(input.metadata) as Record<string, unknown>;

  const client = getPrisma();
  const row = {
    traceId,
    actorId: input.actorId,
    intentPrompt: input.intentPrompt,
    proposedCode: input.proposedCode,
    decision: input.decision,
    violations: maskedViolations as Prisma.InputJsonValue,
    rawOpaPayload: maskedRaw as Prisma.InputJsonValue,
    metadata: meta as Prisma.InputJsonValue,
  };

  if (!client) {
    const pathOut = await writeFallbackLocal({
      reason: "no_database_url",
      ...row,
      timestamp: new Date().toISOString(),
    });
    return { status: "wrote_fallback", reason: "no_database_url", path: pathOut };
  }

  if (!loadSigningPrivateKeyPem()) {
    const pathOut = await writeFallbackLocal({
      reason: "signing_key_missing_after_schedule",
      ...row,
      timestamp: new Date().toISOString(),
    });
    return { status: "wrote_fallback", reason: "signing_key_missing_after_schedule", path: pathOut };
  }

  try {
    await persistChainedRowToPostgres(client, row);
    return { status: "inserted_postgres" };
  } catch (e) {
    const err = String(e);
    const fp = await writeFallbackLocal({
      reason: "db_integrity_persist_failed",
      error: err,
      ...row,
      timestamp: new Date().toISOString(),
    });
    console.error(
      `[ambit-iq-mcp] log_vibe_transaction: Postgres persist failed (${err}). Wrote fallback: ${fp}`,
    );
    return { status: "wrote_fallback", reason: "db_integrity_persist_failed", path: fp, error: err };
  }
}

export async function getComplianceHistory(params: {
  actorId?: string;
  violationType?: string;
  limit?: number;
}): Promise<{ ok: boolean; rows: unknown[]; source: string; error?: string }> {
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
  const client = getPrisma();
  if (!client) {
    return { ok: false, rows: [], source: "none", error: "DATABASE_URL not configured" };
  }

  try {
    const actorId = params.actorId?.trim() || null;
    const violationType = params.violationType?.trim() || null;

    const rows = await client.$queryRaw<
      Array<{
        id: string;
        trace_id: string;
        timestamp: Date;
        actor_id: string;
        decision: boolean;
        violations: unknown;
        metadata: unknown;
      }>
    >(
      Prisma.sql`
        SELECT id, trace_id, timestamp, actor_id, decision, violations, metadata
        FROM ambit_decision_logs
        WHERE decision = false
          AND (${actorId}::text IS NULL OR actor_id = ${actorId})
          AND (
            ${violationType}::text IS NULL
            OR violations::text ILIKE ${"%" + (violationType ?? "") + "%"}
          )
        ORDER BY timestamp DESC
        LIMIT ${limit}
      `,
    );

    return { ok: true, rows, source: "postgresql" };
  } catch (e) {
    return { ok: false, rows: [], source: "postgresql", error: String(e) };
  }
}

export async function generateAuditReportMarkdown(params: {
  projectId: string;
  hours?: number;
}): Promise<{ ok: boolean; markdown: string; error?: string }> {
  const hours = Math.min(Math.max(params.hours ?? 24, 1), 168);
  const projectId = params.projectId.trim();
  const client = getPrisma();
  if (!client) {
    return { ok: false, markdown: "", error: "DATABASE_URL not configured" };
  }
  if (!projectId) {
    return { ok: false, markdown: "", error: "project_id is required" };
  }

  try {
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const rows = await client.ambitDecisionLog.findMany({
      where: {
        timestamp: { gte: since },
        metadata: {
          path: ["project_id"],
          equals: projectId,
        },
      },
      orderBy: { timestamp: "desc" },
      take: 500,
    });

    const allowed = rows.filter((r) => r.decision).length;
    const denied = rows.length - allowed;
    const lines: string[] = [];
    lines.push(`# Software Bill of Intent — ${projectId}`);
    lines.push("");
    lines.push(`- **Window:** last ${hours} hour(s)`);
    lines.push(`- **Total logged decisions:** ${rows.length}`);
    lines.push(`- **Allow:** ${allowed}`);
    lines.push(`- **Deny:** ${denied}`);
    lines.push("");
    lines.push("## Recent entries");
    lines.push("");
    lines.push("| Time (UTC) | Actor | Decision | Trace |");
    lines.push("|------------|-------|----------|-------|");
    for (const r of rows.slice(0, 50)) {
      const t = r.timestamp.toISOString();
      const d = r.decision ? "ALLOW" : "DENY";
      lines.push(`| ${t} | ${r.actorId} | ${d} | ${r.traceId} |`);
    }
    lines.push("");
    lines.push("_Generated by Ambit.IQ MCP `generate_audit_report`. Not a legal attestation._");
    return { ok: true, markdown: lines.join("\n") };
  } catch (e) {
    return { ok: false, markdown: "", error: String(e) };
  }
}

export interface VerifyIntegrityResult {
  status: "Clean" | "Tamper Alert" | "Skipped";
  scanned: number;
  alerts: Array<{ id: string; reasons: string[] }>;
  signatureVerification: "enabled" | "skipped_no_public_key";
  note?: string;
}

/**
 * Verifies the last N rows (chronological slice): hash recomputation, chain links, optional RSA signatures.
 */
export async function verifyAuditIntegrity(limit: number): Promise<VerifyIntegrityResult> {
  const client = getPrisma();
  const cap = Math.min(Math.max(limit, 1), 500);

  if (!client) {
    return {
      status: "Skipped",
      scanned: 0,
      alerts: [],
      signatureVerification: "skipped_no_public_key",
      note: "DATABASE_URL not configured; integrity verification applies only to PostgreSQL-backed logs.",
    };
  }

  const rowsDesc = await client.ambitDecisionLog.findMany({
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take: cap,
  });
  const rows = [...rowsDesc].reverse();

  const pub = loadVerifyingPublicKeyPem();
  if (rows.length === 0) {
    return {
      status: "Clean",
      scanned: 0,
      alerts: [],
      signatureVerification: pub ? "enabled" : "skipped_no_public_key",
    };
  }

  const sigMode: VerifyIntegrityResult["signatureVerification"] = pub
    ? "enabled"
    : "skipped_no_public_key";

  const alerts: Array<{ id: string; reasons: string[] }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const reasons: string[] = [];

    if (!r.previousHash || !r.logHash || !r.signature) {
      reasons.push("incomplete_integrity_columns");
    }

    if (i === 0) {
      if (r.previousHash && r.previousHash !== CHAIN_GENESIS_PREVIOUS_HASH) {
        const parent = await client.ambitDecisionLog.findFirst({
          where: { logHash: r.previousHash },
          select: { id: true },
        });
        if (!parent) {
          reasons.push("window_start_previous_hash_not_genesis_and_no_parent_row");
        }
      }
    } else {
      const prev = rows[i - 1];
      const expectedPriorFingerprint = prev.logHash ?? null;
      if (r.previousHash !== expectedPriorFingerprint) {
        reasons.push("chain_break_previous_hash_does_not_match_prior_log_hash");
      }
    }

    if (r.previousHash && r.logHash) {
      const ts = r.timestamp.toISOString();
      const computed = generateRowHash(
        {
          traceId: r.traceId,
          timestamp: ts,
          intentPrompt: r.intentPrompt,
          proposedCode: r.proposedCode,
          decision: r.decision,
        },
        r.previousHash,
      );
      if (computed !== r.logHash) {
        reasons.push("stored_log_hash_does_not_match_recomputed_fingerprint");
      }
    }

    if (pub && r.logHash && r.signature) {
      if (!verifyLogHashSignatureRsaSha256(r.logHash, r.signature, pub)) {
        reasons.push("rsa_signature_invalid");
      }
    }

    if (reasons.length > 0) {
      alerts.push({ id: r.id, reasons });
    }
  }

  return {
    status: alerts.length === 0 ? "Clean" : "Tamper Alert",
    scanned: rows.length,
    alerts,
    signatureVerification: sigMode,
  };
}
