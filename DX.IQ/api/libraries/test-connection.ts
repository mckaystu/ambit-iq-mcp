import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readSessionToken } from "../_session-token";

type TestBody = {
  name?: string;
  baseUrl?: string;
  username?: string;
  password?: string;
  sessionCookie?: string;
  sessionToken?: string;
  contenthandlerPath?: string;
};

function readBody(req: VercelRequest): TestBody {
  if (!req.body || typeof req.body !== "object") return {};
  return req.body as TestBody;
}

function cleanUrl(input?: string): string | null {
  if (!input) return null;
  try {
    const u = new URL(input.trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m?.[1]) return null;
  return m[1].replace(/\s+/g, " ").trim();
}

function extractPreview(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function resolveDxUrl(base: URL, rawPath: string): string {
  const path = rawPath.trim();
  if (!path) return base.toString();
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (/^\/dx\/api\//i.test(normalized) || /^\/hcl\/mycontenthandler\//i.test(normalized)) {
    return new URL(normalized, base.origin).toString();
  }
  const basePath = base.pathname.replace(/\/+$/, "");
  if (basePath && basePath !== "/" && /^\/(?:dx|wps|hcl)\//i.test(normalized)) {
    return new URL(`${basePath}${normalized}`, base.origin).toString();
  }
  return new URL(normalized, base).toString();
}

function responseLooksApi(contentType: string, text: string): boolean {
  if (/json|xml/i.test(contentType)) return true;
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("<?xml");
}

function expandProbeUrls(base: URL, targetUrl: string, contenthandlerPath?: string): string[] {
  const urls = [targetUrl];
  const raw = (contenthandlerPath || "").trim();
  if (!raw) return urls;

  const resolved = resolveDxUrl(base, raw);
  urls.push(resolved);

  const normalizedPath = raw.startsWith("/") ? raw : `/${raw}`;
  const cleanPath = normalizedPath.replace(/\/+$/, "");

  // Common WCM contenthandler base paths (ending in /wcmrest-v2) require a collection resource.
  if (/\/wcmrest-v2$/i.test(cleanPath)) {
    urls.push(resolveDxUrl(base, `${cleanPath}/libraries`));
    urls.push(resolveDxUrl(base, `${cleanPath}/contents`));
  }
  return [...new Set(urls)];
}

/** Actionable copy when the TCP/TLS connection works but HTTP reports a gateway or portal error. */
function connectivityHintForHttpError(status: number, finalUrl: string): string | undefined {
  let path = "";
  try {
    path = new URL(finalUrl).pathname.toLowerCase();
  } catch {
    /* ignore */
  }
  if (status === 503 || status === 502) {
    return (
      `HTTP ${status} ("No server is available" / bad gateway) almost always means the load balancer could not reach a healthy DX/app backend—not a DX.IQ bug. ` +
      `Check with your team: environment running, pods up, maintenance, VPN. ` +
      `URL experiments: open the same URL in a browser; try the host root https://…/ ; try tenant root without /home (e.g. …/hcl/dx/<tenant>); ` +
      `for WCM REST discovery DX.IQ also uses host-level paths like https://…/dx/api/wcm/v2/explorer/ (see Contenthandler path in the UI).`
    );
  }
  if (status === 504) {
    return "Gateway timeout: the upstream did not respond in time. Retry later or check server load and timeouts.";
  }
  if (status === 401 || status === 403) {
    return "Auth failed for this URL. Try Session mode, a different user, or confirm Basic auth is allowed on this route.";
  }
  if (status === 404 && path.endsWith("/home")) {
    return "404 on …/home: try the tenant path without /home, or the portal landing URL your team documents.";
  }
  return undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, baseUrl, username, password, sessionCookie, sessionToken, contenthandlerPath } = readBody(req);
  const targetUrl = cleanUrl(baseUrl);
  if (!targetUrl) {
    return res.status(400).json({ ok: false, error: "baseUrl must be a valid http(s) URL" });
  }

  const headers: Record<string, string> = {
    Accept: "text/html,application/json,application/xml,text/xml;q=0.9,*/*;q=0.8",
    "User-Agent": "DX.IQ-Connectivity-Test/1.0"
  };
  if (username && password) {
    const basic = Buffer.from(`${username}:${password}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  }
  if (sessionCookie && sessionCookie.trim()) {
    headers.Cookie = sessionCookie.trim();
  }
  if (!headers.Cookie && sessionToken) {
    const fromToken = readSessionToken(sessionToken);
    if (fromToken) headers.Cookie = fromToken;
  }

  try {
    const base = new URL(targetUrl);
    const uniqueProbeUrls = expandProbeUrls(base, targetUrl, contenthandlerPath);
    const attempts: Array<{
      url: string;
      status: number;
      statusText: string;
      finalUrl: string;
      contentType: string;
      contentLength: number;
      elapsedMs: number;
      title: string | null;
      preview: string;
      looksApi: boolean;
    }> = [];

    for (const url of uniqueProbeUrls) {
      const started = Date.now();
      const response = await fetch(url, {
        method: "GET",
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(45_000)
      });
      const elapsedMs = Date.now() - started;
      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();
      const title = contentType.includes("html") ? extractTitle(text) : null;
      const preview = extractPreview(text);
      attempts.push({
        url,
        status: response.status,
        statusText: response.statusText,
        finalUrl: response.url,
        contentType,
        contentLength: text.length,
        elapsedMs,
        title,
        preview,
        looksApi: responseLooksApi(contentType, text)
      });
    }
    const best =
      attempts.find((a) => a.status >= 200 && a.status < 300 && a.looksApi) ||
      attempts.find((a) => a.status >= 200 && a.status < 300) ||
      attempts[0];
    const httpHint = best && best.status >= 400 ? connectivityHintForHttpError(best.status, best.finalUrl) : undefined;

    return res.status(200).json({
      ok: Boolean(best && best.status >= 200 && best.status < 300 && (best.looksApi || attempts.length === 1)),
      libraryName: name || null,
      request: {
        baseUrl: targetUrl,
        authMode: headers.Cookie ? "session-cookie" : username && password ? "basic" : "none",
        contenthandlerPath: contenthandlerPath || null
      },
      response: best,
      attempts,
      ...(httpHint ? { hint: httpHint } : {})
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause.message
        : error instanceof Error && typeof (error as { cause?: unknown }).cause === "string"
          ? String((error as { cause: string }).cause)
          : "";
    const combined = `${msg} ${cause}`.toLowerCase();
    let hint = "";
    if (combined.includes("certificate") || combined.includes("cert_") || combined.includes("self signed")) {
      hint =
        "TLS verification failed. For internal CAs, set NODE_EXTRA_CA_CERTS to a PEM bundle when running the DX.IQ API, or install the CA in your OS trust store.";
    } else if (combined.includes("timed out") || combined.includes("timeout") || combined.includes("abort")) {
      hint = "Request timed out. Confirm VPN/firewall and that the host accepts HTTPS on this URL.";
    } else if (combined.includes("getaddrinfo") || combined.includes("enotfound")) {
      hint = "DNS lookup failed. Check the hostname in the base URL.";
    } else if (combined.includes("econnrefused")) {
      hint = "Connection refused—wrong port, service down, or HTTP vs HTTPS mismatch.";
    }

    return res.status(502).json({
      ok: false,
      error: "Failed to reach endpoint",
      details: cause ? `${msg} (${cause})` : msg,
      ...(hint ? { hint } : {})
    });
  }
}
