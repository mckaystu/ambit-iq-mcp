import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readSessionToken } from "../_session-token";

type Body = {
  baseUrl?: string;
  username?: string;
  password?: string;
  sessionCookie?: string;
  sessionToken?: string;
  contenthandlerPath?: string;
};

const DEFAULT_PATHS = [
  "/hcl/mycontenthandler/wcmrest-v2/libraries",
  "/wps/mycontenthandler",
  "/wps/contenthandler",
  "/hcl/dx/api/core/v1"
];

function toUrl(raw?: string): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

function resolveDxUrl(base: URL, rawPath: string): string {
  const path = rawPath.trim();
  if (!path) return base.toString();
  if (/^https?:\/\//i.test(path)) return path;

  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (/^\/dx\/api\//i.test(normalized)) {
    return new URL(normalized, base.origin).toString();
  }
  if (/^\/hcl\/mycontenthandler\//i.test(normalized)) {
    return new URL(normalized, base.origin).toString();
  }
  const basePath = base.pathname.replace(/\/+$/, "");
  if (basePath && basePath !== "/" && /^\/(?:dx|wps|hcl)\//i.test(normalized)) {
    return new URL(`${basePath}${normalized}`, base.origin).toString();
  }
  return new URL(normalized, base).toString();
}

function xmlLike(s: string): boolean {
  const t = s.trimStart();
  return t.startsWith("<?xml") || t.startsWith("<");
}

function jsonLike(s: string): boolean {
  const t = s.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

function looksLikePortalHtml(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("<!doctype html") &&
    (t.includes("rel=\"dynamic-content\"") ||
      t.includes("/hcl/contenthandler/") ||
      t.includes("wp_dynamiccontentspots") ||
      t.includes("portal theme"))
  );
}

function parseSetCookieHeader(raw: string): string[] {
  if (!raw) return [];
  const parts = raw.split(/,(?=\s*[A-Za-z0-9!#$%&'*+.^_`|~-]+=)/g);
  return parts
    .map((p) => p.trim().split(";")[0])
    .filter((p) => p.includes("="));
}

function mergeCookieHeader(currentCookie: string | undefined, response: Response): string | undefined {
  const direct = (response.headers as any).getSetCookie?.() as string[] | undefined;
  const raw = response.headers.get("set-cookie") || "";
  const setCookies = [...(direct || []), ...parseSetCookieHeader(raw)];
  if (setCookies.length === 0) return currentCookie;

  const jar = new Map<string, string>();
  for (const c of (currentCookie || "").split(";")) {
    const kv = c.trim();
    if (!kv) continue;
    const idx = kv.indexOf("=");
    if (idx <= 0) continue;
    jar.set(kv.slice(0, idx), kv.slice(idx + 1));
  }
  for (const c of setCookies) {
    const idx = c.indexOf("=");
    if (idx <= 0) continue;
    jar.set(c.slice(0, idx), c.slice(idx + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function fetchDx(url: string, baseHeaders: Record<string, string>) {
  let currentUrl = url;
  const headers = { ...baseHeaders };
  for (let hop = 0; hop < 4; hop += 1) {
    const r = await fetch(currentUrl, { method: "GET", headers, redirect: "manual" });
    const nextCookie = mergeCookieHeader(headers.Cookie, r);
    if (nextCookie) headers.Cookie = nextCookie;
    const loc = r.headers.get("location");
    const isRedirect = r.status >= 300 && r.status < 400 && !!loc;
    if (!isRedirect) return r;
    currentUrl = new URL(loc!, currentUrl).toString();
  }
  return fetch(currentUrl, { method: "GET", headers, redirect: "follow" });
}

async function probe(url: string, authHeader?: string, sessionCookie?: string) {
  const started = Date.now();
  const headers: Record<string, string> = {
    Accept: "application/json,application/xml,text/xml,text/html;q=0.8,*/*;q=0.6",
    "User-Agent": "DX.IQ-ContentHandler-Test/1.0"
  };
  if (authHeader) headers.Authorization = authHeader;
  if (sessionCookie) headers.Cookie = sessionCookie;

  const response = await fetchDx(url, headers);
  const text = await response.text();
  const elapsedMs = Date.now() - started;
  const contentType = response.headers.get("content-type") || "";

  let format: "json" | "xml" | "html" | "unknown" = "unknown";
  if (contentType.includes("json") || jsonLike(text)) format = "json";
  else if (contentType.includes("xml") || xmlLike(text)) format = "xml";
  else if (contentType.includes("html")) format = "html";

  return {
    status: response.status,
    ok: response.ok,
    finalUrl: response.url,
    contentType,
    format,
    elapsedMs,
    preview: text.replace(/\s+/g, " ").slice(0, 320),
    authRejected: response.status === 401 || response.status === 403,
    portalHtmlFallback: looksLikePortalHtml(text)
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = (req.body || {}) as Body;
  const base = toUrl(body.baseUrl);
  if (!base) {
    return res.status(400).json({ ok: false, error: "baseUrl must be a valid URL" });
  }

  const authHeader =
    body.username && body.password
      ? `Basic ${Buffer.from(`${body.username}:${body.password}`).toString("base64")}`
      : undefined;
  const sessionCookie = body.sessionCookie?.trim() || undefined;
  const sessionFromToken = body.sessionToken ? readSessionToken(body.sessionToken) : "";
  const effectiveCookie = sessionCookie || sessionFromToken || undefined;

  const paths =
    body.contenthandlerPath && body.contenthandlerPath.trim()
      ? [body.contenthandlerPath.trim()]
      : DEFAULT_PATHS;

  try {
    const attempts = [];
    for (const p of paths) {
      const target = resolveDxUrl(base, p);
      const result = await probe(target, authHeader, effectiveCookie);
      attempts.push({ path: p, ...result });
      if (result.ok && (result.format === "json" || result.format === "xml")) {
        return res.status(200).json({
          ok: true,
          message: "Contenthandler endpoint appears reachable and parseable.",
          bestMatch: attempts[attempts.length - 1],
          attempts
        });
      }
    }

    return res.status(200).json({
      ok: false,
      message: "No probed endpoint returned parseable JSON/XML.",
      hint:
        attempts.some((a: any) => a.portalHtmlFallback)
          ? "Endpoint returned portal HTML shell, not API data. Check auth/session requirements and exact API route."
          : "Confirm the exact Contenthandler route and credentials. You can pass contenthandlerPath explicitly.",
      authLikelyInteractive: attempts.some((a: any) => a.portalHtmlFallback),
      attempts
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: "Failed during Contenthandler probe",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
