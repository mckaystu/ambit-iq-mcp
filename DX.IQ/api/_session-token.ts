import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

type SessionPayload = {
  c: string;
  exp: number;
};

function getKey(): Buffer {
  const secret = process.env.SESSION_TOKEN_SECRET || "dxiq-dev-session-secret-change-me";
  return createHash("sha256").update(secret).digest();
}

export function issueSessionToken(cookieHeader: string, ttlMs = 8 * 60 * 60 * 1000): string {
  const payload: SessionPayload = { c: cookieHeader, exp: Date.now() + ttlMs };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `dxs.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
}

export function readSessionToken(token?: string): string {
  if (!token || !token.startsWith("dxs.")) return "";
  const parts = token.split(".");
  if (parts.length !== 4) return "";
  try {
    const iv = Buffer.from(parts[1]!, "base64url");
    const encrypted = Buffer.from(parts[2]!, "base64url");
    const tag = Buffer.from(parts[3]!, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const payload = JSON.parse(decrypted) as SessionPayload;
    if (!payload?.c || !payload?.exp || Date.now() > payload.exp) return "";
    return payload.c;
  } catch {
    return "";
  }
}
