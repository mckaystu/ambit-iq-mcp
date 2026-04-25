import type { VercelRequest, VercelResponse } from "@vercel/node";
import { XMLParser } from "fast-xml-parser";
import { readSessionToken } from "../_session-token";

type Body = {
  baseUrl?: string;
  username?: string;
  password?: string;
  sessionCookie?: string;
  sessionToken?: string;
  contenthandlerPath?: string;
};

/**
 * DX 9.5+ WCM REST entry points, roughly ordered by HCL Core Hierarchy:
 * DocumentLibrary first (`libraries`), then explorer and Content/Component probes for tenants
 * that expose listings only under alternate paths.
 */
const FALLBACK_DISCOVERY_PATHS = [
  "/wps/mycontenthandler/wcmrest-v2/libraries",
  "/dx/api/wcm/v2/libraries",
  "/hcl/mycontenthandler/wcmrest-v2/libraries",
  "/dx/api/wcm/v2/explorer/",
  "/dx/api/contents/analysis",
  "/dx/api/wcm/contents/analysis",
  "/wcm/v2/contents/analysis",
  "/dx/api/wcm/v2/contents",
  "/dx/api/wcm/v2/component/short-texts"
] as const;

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

  const basePath = base.pathname.replace(/\/+$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;

  // Keep host-root DX API paths at origin level (many environments expose /dx/api/* only there).
  if (/^\/dx\/api\//i.test(normalized)) {
    return new URL(normalized, base.origin).toString();
  }

  // WCM REST v2 under portal content handler (e.g. /hcl/mycontenthandler/wcmrest-v2/...) — not under /hcl/dx/<tenant>.
  if (/^\/hcl\/mycontenthandler\//i.test(normalized)) {
    return new URL(normalized, base.origin).toString();
  }

  // Preserve tenant/context root (e.g. /hcl/dx/nexHaven) for non-API context-bound routes.
  if (basePath && basePath !== "/" && /^\/(?:dx|wps|hcl)\//i.test(normalized)) {
    return new URL(`${basePath}${normalized}`, base.origin).toString();
  }

  return new URL(normalized, base).toString();
}

function expandDiscoveryPathCandidates(inputPaths: string[]): string[] {
  const out = new Set<string>();
  for (const raw of inputPaths) {
    const p = raw.trim();
    if (!p) continue;
    out.add(p);
    const normalized = p.startsWith("/") ? p : `/${p}`;
    const clean = normalized.replace(/\/+$/, "");
    if (/\/wcmrest-v2$/i.test(clean)) {
      out.add(`${clean}/libraries`);
      out.add(`${clean}/contents`);
    }
  }
  return [...out];
}

function toContenthandlerPath(rawPath: string, endpoint: string): string {
  const input = rawPath.trim();
  if (input.startsWith("/")) return input;
  try {
    const u = new URL(endpoint);
    const resolved = `${u.pathname}${u.search}`;
    return resolved || input;
  } catch {
    return input;
  }
}

function parseSetCookieHeader(raw: string): string[] {
  if (!raw) return [];
  // Split cookies safely for typical header format: "a=1; Path=/, b=2; Path=/"
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
  // final fallback
  return fetch(currentUrl, { method: "GET", headers, redirect: "follow" });
}

function collectObjects(node: unknown, out: Array<Record<string, unknown>>) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectObjects(item, out);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  out.push(obj);
  for (const v of Object.values(obj)) collectObjects(v, out);
}

/** HCL DX WCM REST JSON: { "library-entries": [ { type, name, title|displayTitle, ... } ] } */
function parseLibraryEntriesWcmRest(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const entries = root["library-entries"];
  if (!Array.isArray(entries)) return [];
  const labels: string[] = [];
  for (const item of entries) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (String(o.type || "") !== "Library") continue;
    let title = "";
    if (typeof o.displayTitle === "string") title = o.displayTitle.trim();
    else if (typeof o.title === "string") title = o.title.trim();
    else if (o.title && typeof o.title === "object") {
      const t = o.title as Record<string, unknown>;
      if (typeof t.value === "string") title = t.value.trim();
    }
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const label = title || name;
    if (label) labels.push(label);
  }
  return [...new Set(labels)].slice(0, 200);
}

function parseLibraries(payload: unknown): string[] {
  const out = new Set<string>();
  const objs: Array<Record<string, unknown>> = [];
  collectObjects(payload, objs);
  for (const o of objs) {
    const typeVal =
      (typeof o.type === "string" && o.type) ||
      (typeof o.kind === "string" && o.kind) ||
      (typeof o.category === "string" && o.category) ||
      "";
    const nameVal =
      (typeof o.name === "string" && o.name) ||
      (typeof o.title === "string" && o.title) ||
      (typeof o.displayName === "string" && o.displayName) ||
      "";

    if (nameVal && /library/i.test(typeVal)) out.add(nameVal.trim());
    if (nameVal && /library/i.test(nameVal)) out.add(nameVal.trim());
  }
  return [...out].slice(0, 200);
}

function parseLibrariesFromText(text: string): string[] {
  const out = new Set<string>();
  const quoted = text.match(/"name"\s*:\s*"([^"]+)"/gi) || [];
  for (const m of quoted) {
    const name = m.replace(/.*"name"\s*:\s*"/i, "").replace(/"$/, "");
    if (name && /library/i.test(name)) out.add(name);
  }
  const xmlish = text.match(/<name>([^<]+)<\/name>/gi) || [];
  for (const m of xmlish) {
    const name = m.replace(/<\/?name>/gi, "");
    if (name && /library/i.test(name)) out.add(name.trim());
  }
  return [...out].slice(0, 200);
}

function looksLikeSwaggerUi(html: string): boolean {
  const t = html.toLowerCase();
  return t.includes("swagger-ui") || t.includes("openapi");
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

function extractSpecPathFromSwaggerHtml(html: string): string | null {
  const m = html.match(/handleDXAspects\(\s*"([^"]+)"/i);
  return m?.[1] || null;
}

async function fetchOpenApiCandidates(base: URL, path: string, headers: Record<string, string>) {
  const candidates = [
    resolveDxUrl(base, path).replace(/\/+$/, "") + "/openapi.json",
    resolveDxUrl(base, path).replace(/\/+$/, "") + "/swagger.json",
    new URL("/dx/api/wcm/v2/openapi.json", base).toString(),
    new URL("/dx/api/wcm/v2/swagger.json", base).toString(),
    new URL("/dx/api/specs/wcm/v2/openapi.json", base).toString()
  ];

  for (const candidate of candidates) {
    try {
      const r = await fetch(candidate, { method: "GET", headers, redirect: "follow" });
      if (!r.ok) continue;
      const text = await r.text();
      const json = JSON.parse(text) as { paths?: Record<string, unknown> };
      if (json?.paths && typeof json.paths === "object") {
        const pathKeys = Object.keys(json.paths);
        return { specUrl: candidate, pathKeys };
      }
    } catch {
      // continue
    }
  }
  return null;
}

async function tryDiscoverLibrariesFromSpec(
  base: URL,
  pathKeys: string[],
  headers: Record<string, string>
): Promise<string[]> {
  const likelyLibraryPaths = pathKeys
    .filter((p) => /(^|\/)libraries(\/|$)|library-id|libraryid|library/i.test(p))
    .map((p) => (p.startsWith("/") ? p : `/${p}`))
    .slice(0, 20);

  const names = new Set<string>();
  for (const p of likelyLibraryPaths) {
    // Skip templated paths for direct calls.
    if (p.includes("{") || p.includes("}")) continue;
    const url = new URL(`/dx/api/wcm/v2${p}`, base.origin).toString();
    try {
      const r = await fetch(url, { method: "GET", headers, redirect: "follow" });
      if (!r.ok) continue;
      const text = await r.text();
      let payload: unknown = null;
      try {
        payload = JSON.parse(text);
      } catch {
        try {
          payload = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            textNodeName: "#text",
            trimValues: true
          }).parse(text);
        } catch {
          payload = null;
        }
      }
      if (!payload) continue;
      const objs: Array<Record<string, unknown>> = [];
      collectObjects(payload, objs);
      for (const o of objs) {
        const n =
          (typeof o.name === "string" && o.name.trim()) ||
          (typeof o.title === "string" && o.title.trim()) ||
          "";
        if (!n) continue;
        if (n.length < 2 || n.length > 160) continue;
        // Avoid pulling obvious non-library token-like values.
        if (/^[a-f0-9-]{24,}$/i.test(n)) continue;
        names.add(n);
      }
      if (names.size > 0) break;
    } catch {
      // continue
    }
  }
  return [...names].slice(0, 200);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const body = (req.body || {}) as Body;
  const base = toUrl(body.baseUrl);
  if (!base) return res.status(400).json({ ok: false, error: "baseUrl must be a valid URL" });

  const primaryPath = (body.contenthandlerPath || "/hcl/mycontenthandler/wcmrest-v2/libraries").trim();
  const candidatePaths = expandDiscoveryPathCandidates([
    "/hcl/mycontenthandler/wcmrest-v2/libraries",
    primaryPath.startsWith("/") ? primaryPath : `/${primaryPath}`,
    ...FALLBACK_DISCOVERY_PATHS
  ]);
  const headers: Record<string, string> = {
    Accept: "application/json,application/xml,text/xml,text/html;q=0.8,*/*;q=0.6",
    "User-Agent": "DX.IQ-Library-Discover/1.0"
  };
  if (body.username && body.password) {
    headers.Authorization = `Basic ${Buffer.from(`${body.username}:${body.password}`).toString("base64")}`;
  }
  if (body.sessionCookie && body.sessionCookie.trim()) {
    headers.Cookie = body.sessionCookie.trim();
  }
  if (!headers.Cookie && body.sessionToken) {
    const fromToken = readSessionToken(body.sessionToken);
    if (fromToken) headers.Cookie = fromToken;
  }

  try {
    const attempts: Array<{
      path: string;
      endpoint: string;
      status: number;
      contentType: string;
      count: number;
      libraries: string[];
      preview: string;
      portalHtmlFallback?: boolean;
      swaggerHint?: { detected: true; specUrl: string | null; endpointHints: string[] };
      hint?: string;
    }> = [];

    for (const path of candidatePaths) {
      const target = resolveDxUrl(base, path);
      const response = await fetchDx(target, headers);
      const text = await response.text();
      const contentType = (response.headers.get("content-type") || "").toLowerCase();

      let payload: unknown = null;
      if (contentType.includes("json")) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      } else if (contentType.includes("xml") || text.trimStart().startsWith("<")) {
        try {
          payload = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            textNodeName: "#text",
            trimValues: true
          }).parse(text);
        } catch {
          payload = null;
        }
      } else {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }

      const wcmRestLibs = payload ? parseLibraryEntriesWcmRest(payload) : [];
      const discovered =
        wcmRestLibs.length > 0 ? wcmRestLibs : payload ? parseLibraries(payload) : [];
      const fallback = discovered.length === 0 ? parseLibrariesFromText(text) : discovered;
      let swaggerHint:
        | {
            detected: true;
            specUrl: string | null;
            endpointHints: string[];
          }
        | undefined;

      if (fallback.length === 0 && looksLikeSwaggerUi(text)) {
        const specPathFromHtml = extractSpecPathFromSwaggerHtml(text);
        const spec = specPathFromHtml
          ? await (async () => {
              const direct = new URL(specPathFromHtml, new URL(target)).toString();
              try {
                const r = await fetch(direct, { method: "GET", headers, redirect: "follow" });
                if (r.ok) {
                  const j = (await r.json()) as { paths?: Record<string, unknown> };
                  if (j?.paths && typeof j.paths === "object") {
                    return { specUrl: direct, pathKeys: Object.keys(j.paths) };
                  }
                }
              } catch {
                // fall through
              }
              return fetchOpenApiCandidates(base, path, headers);
            })()
          : await fetchOpenApiCandidates(base, path, headers);
        const endpointHints = (spec?.pathKeys || [])
          .filter((p) => /library|libraries|sitearea|content|authoring|presentation|template|component/i.test(p))
          .slice(0, 30);
        const specDiscoveredLibraries = spec?.pathKeys
          ? await tryDiscoverLibrariesFromSpec(base, spec.pathKeys, headers)
          : [];
        swaggerHint = {
          detected: true,
          specUrl: spec?.specUrl || null,
          endpointHints
        };
        if (specDiscoveredLibraries.length > 0) {
          attempts.push({
            path: `${path}::spec-library-discovery`,
            endpoint: spec?.specUrl || target,
            status: 200,
            contentType: "application/json",
            count: specDiscoveredLibraries.length,
            libraries: specDiscoveredLibraries,
            preview: `Discovered from OpenAPI library endpoints: ${specDiscoveredLibraries.slice(0, 5).join(", ")}`,
            portalHtmlFallback: false,
            swaggerHint
          });
          return res.status(200).json({
            ok: true,
            endpoint: spec?.specUrl || target,
            status: 200,
            contentType: "application/json",
            count: specDiscoveredLibraries.length,
            libraries: specDiscoveredLibraries,
            preview: `Discovered from OpenAPI library endpoints: ${specDiscoveredLibraries.slice(0, 5).join(", ")}`,
            swaggerHint,
            attempts
          });
        }
      }

      const attempt = {
        path,
        endpoint: target,
        status: response.status,
        contentType,
        count: fallback.length,
        libraries: fallback,
        preview: text.replace(/\s+/g, " ").slice(0, 500),
        portalHtmlFallback: looksLikePortalHtml(text),
        swaggerHint,
        hint:
          swaggerHint && fallback.length === 0
            ? "Explorer endpoint returned Swagger UI. Use one of swaggerHint.endpointHints as contenthandlerPath for data calls."
            : undefined
      };
      attempts.push(attempt);

      if (response.ok && fallback.length > 0) {
        return res.status(200).json({
          ok: true,
          endpoint: target,
          status: response.status,
          contentType,
          count: fallback.length,
          libraries: fallback,
          preview: attempt.preview,
          swaggerHint,
          attempts
        });
      }
    }

    const bestReusableAttempt = attempts.find(
      (a) =>
        a.status >= 200 &&
        a.status < 300 &&
        !a.portalHtmlFallback &&
        !a.contentType.includes("text/html")
    );
    const suggestedContenthandlerPath = bestReusableAttempt
      ? toContenthandlerPath(bestReusableAttempt.path, bestReusableAttempt.endpoint)
      : undefined;

    // Nothing discovered, return best successful parse or last attempt with full diagnostics
    const best =
      attempts.find((a) => a.status >= 200 && a.status < 300) ||
      attempts[attempts.length - 1];
    if (!best) {
      return res.status(502).json({
        ok: false,
        error: "No discovery attempts were executed"
      });
    }

    return res.status(200).json({
      ok: best.status >= 200 && best.status < 300,
      endpoint: best.endpoint,
      status: best.status,
      contentType: best.contentType,
      count: best.count,
      libraries: best.libraries,
      preview: best.preview,
      swaggerHint: best.swaggerHint,
      hint:
        best.count === 0
          ? best.portalHtmlFallback
            ? "Portal HTML returned instead of API payload. This usually means interactive auth/session is required for these routes."
            : suggestedContenthandlerPath
              ? `No libraries discovered yet. Reusing successful data endpoint as contenthandlerPath is recommended: ${suggestedContenthandlerPath}`
              : "No libraries discovered yet. Review attempts and reuse a successful data endpoint as contenthandlerPath."
          : undefined,
      suggestedContenthandlerPath,
      authLikelyInteractive: attempts.some((a) => !!a.portalHtmlFallback),
      attempts
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: "Failed to discover libraries",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
