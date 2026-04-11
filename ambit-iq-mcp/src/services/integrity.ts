/**
 * Tamper-evident hash chain + RSA-SHA256 signatures for ambit_decision_logs.
 * Uses Node.js crypto only (no third-party crypto libs).
 */
import { createHash, createSign, createVerify } from "node:crypto";

/** First row uses this synthetic previous hash (64 hex chars = 256-bit zero block). */
export const CHAIN_GENESIS_PREVIOUS_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

const ADVISORY_LOCK_KEY1 = 748_219_033;
const ADVISORY_LOCK_KEY2 = 1;

function stableCanonicalPayload(input: {
  traceId: string;
  timestamp: string;
  intentPrompt: string;
  proposedCode: string;
  decision: boolean;
  previousHash: string;
}): string {
  const o: Record<string, unknown> = {
    trace_id: input.traceId,
    timestamp: input.timestamp,
    intent_prompt: input.intentPrompt,
    proposed_code: input.proposedCode,
    decision: input.decision,
    previous_hash: input.previousHash,
  };
  const keys = Object.keys(o).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = o[k];
  return JSON.stringify(sorted);
}

/**
 * SHA-256 fingerprint of canonicalized row fields + previous hash (chain input).
 */
export function generateRowHash(
  currentData: {
    traceId: string;
    timestamp: string;
    intentPrompt: string;
    proposedCode: string;
    decision: boolean;
  },
  previousHash: string,
): string {
  const canonical = stableCanonicalPayload({
    ...currentData,
    previousHash,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function loadSigningPrivateKeyPem(): string | null {
  const raw = String(process.env.AMBIT_SIGNING_KEY || "").trim();
  if (!raw) return null;
  // Hex-encoded PEM (0-9a-f only): avoids +/ mangling in some serverless env layers.
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length >= 128) {
    try {
      const pem = Buffer.from(raw, "hex").toString("utf8");
      if (pem.includes("BEGIN") && pem.includes("PRIVATE KEY")) {
        return pem.trim();
      }
    } catch {
      /* fall through */
    }
  }
  return raw.replace(/\\n/g, "\n");
}

export function loadVerifyingPublicKeyPem(): string | null {
  const raw = String(process.env.AMBIT_VERIFYING_KEY || "").trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length >= 64) {
    try {
      const pem = Buffer.from(raw, "hex").toString("utf8");
      if (pem.includes("BEGIN") && pem.includes("PUBLIC KEY")) {
        return pem.trim();
      }
    } catch {
      /* fall through */
    }
  }
  return raw.replace(/\\n/g, "\n");
}

export function signLogHashRsaSha256(logHashHex: string, privateKeyPem: string): string {
  const sign = createSign("RSA-SHA256");
  sign.update(logHashHex, "utf8");
  sign.end();
  const sig = sign.sign(privateKeyPem);
  return sig.toString("base64");
}

export function verifyLogHashSignatureRsaSha256(
  logHashHex: string,
  signatureBase64: string,
  publicKeyPem: string,
): boolean {
  try {
    const verify = createVerify("RSA-SHA256");
    verify.update(logHashHex, "utf8");
    verify.end();
    return verify.verify(publicKeyPem, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

/** Advisory transaction lock to serialize chain appends across concurrent writers. */
export function advisoryLockSql() {
  return { ADVISORY_LOCK_KEY1, ADVISORY_LOCK_KEY2 } as const;
}
