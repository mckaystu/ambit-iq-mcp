/**
 * Redact secrets from payloads before persisting raw_opa_payload (non-repudiation with PII/secret hygiene).
 */

const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi;
const GENERIC_API_KEY =
  /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{16,}\b|\bAIza[0-9A-Za-z_-]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi;
const PG_URL = /\bpostgresql:\/\/[^"'\s]+/gi;
const JDBC = /\bjdbc:postgresql:\/\/[^"'\s]+/gi;

function maskString(s: string): string {
  return s
    .replaceAll(BEARER, "Bearer [REDACTED]")
    .replaceAll(GENERIC_API_KEY, "[REDACTED_API_KEY]")
    .replaceAll(PG_URL, "postgresql://[REDACTED]")
    .replaceAll(JDBC, "jdbc:postgresql://[REDACTED]");
}

export function maskSensitivePayload(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return maskString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => maskSensitivePayload(v));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = maskSensitivePayload(v);
    }
    return out;
  }
  return value;
}
