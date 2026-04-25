import type { VercelRequest, VercelResponse } from "@vercel/node";
import { issueSessionToken } from "../_session-token";

type Body = {
  baseUrl?: string;
  username?: string;
  password?: string;
  sessionCookie?: string;
  verifyPath?: string;
};

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

function parseSetCookies(response: Response): string[] {
  const h = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function mergeCookies(existing: string, setCookies: string[]): string {
  const jar = new Map<string, string>();
  for (const kv of existing.split(";")) {
    const p = kv.trim();
    if (!p || !p.includes("=")) continue;
    const [k, ...rest] = p.split("=");
    jar.set(k.trim(), rest.join("=").trim());
  }
  for (const c of setCookies) {
    const first = c.split(";")[0]?.trim();
    if (!first || !first.includes("=")) continue;
    const [k, ...rest] = first.split("=");
    jar.set(k.trim(), rest.join("=").trim());
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function hasDxSessionCookies(cookie: string): boolean {
  return /(?:^|;\s*)LTPAToken2=/i.test(cookie) || /(?:^|;\s*)LtpaToken2=/i.test(cookie) || /(?:^|;\s*)JSESSIONID=/i.test(cookie);
}

function deriveContextRoots(base: URL): string[] {
  const path = base.pathname.replace(/\/+$/, "");
  if (!path || path === "/") return [""];
  const withoutHome = path.replace(/\/home$/i, "");
  return Array.from(new Set([withoutHome, path, ""]));
}

async function loginWithPeopleApi(base: URL, username: string, password: string) {
  let cookie = "";
  const contextRoots = deriveContextRoots(base);
  const loginUrls = Array.from(
    new Set(
      contextRoots.flatMap((root) => [
        new URL(`${root}/dx/api/people/v1/auth/login`, base.origin).toString(),
        new URL(`${root}/api/people/v1/auth/login`, base.origin).toString()
      ])
    )
  );
  const diagnostics: Array<Record<string, unknown>> = [];

  const preflight = await fetch(base.toString(), { method: "GET", redirect: "manual" });
  cookie = mergeCookies(cookie, parseSetCookies(preflight));
  diagnostics.push({
    strategy: "people-v1-preflight",
    url: base.toString(),
    status: preflight.status,
    location: preflight.headers.get("location") || null,
    contentType: preflight.headers.get("content-type") || null,
    cookieSeeded: Boolean(cookie)
  });

  for (const loginUrl of loginUrls) {
    const response = await fetch(loginUrl, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json,text/plain,*/*",
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: JSON.stringify({
        userId: username,
        password
      })
    });

    cookie = mergeCookies(cookie, parseSetCookies(response));
    diagnostics.push({
      strategy: "people-v1-auth-login",
      url: loginUrl,
      status: response.status,
      location: response.headers.get("location") || null,
      contentType: response.headers.get("content-type") || null,
      cookieHasLtpa: /(?:^|;\s*)LTPAToken2=/i.test(cookie) || /(?:^|;\s*)LtpaToken2=/i.test(cookie),
      cookieHasJSession: /(?:^|;\s*)JSESSIONID=/i.test(cookie)
    });

    if (hasDxSessionCookies(cookie)) {
      break;
    }
  }

  return { cookie, diagnostics };
}

async function loginWithDiagnostics(base: URL, username: string, password: string) {
  const contextRoots = deriveContextRoots(base);
  const loginTargets = Array.from(
    new Set(
      contextRoots.flatMap((root) => [
        new URL(`${root}/j_security_check`, base.origin).toString(),
        new URL(`${root}/ibm_security_check`, base.origin).toString(),
        new URL(`${root}/wps/myportal/j_security_check`, base.origin).toString(),
        new URL(`${root}/wps/myportal/ibm_security_check`, base.origin).toString()
      ])
    )
  );
  const diagnostics: Array<Record<string, unknown>> = [];
  let cookie = "";

  const pre = await fetch(base.toString(), { method: "GET", redirect: "manual" });
  cookie = mergeCookies(cookie, parseSetCookies(pre));
  diagnostics.push({
    step: "preflight",
    url: base.toString(),
    status: pre.status,
    location: pre.headers.get("location") || null,
    contentType: pre.headers.get("content-type") || null,
    cookieSeeded: Boolean(cookie)
  });

  const payloadVariants = [
    new URLSearchParams({ j_username: username, j_password: password }).toString(),
    new URLSearchParams({ username, password }).toString()
  ];

  for (const target of loginTargets) {
    for (const body of payloadVariants) {
      const res = await fetch(target, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(cookie ? { Cookie: cookie } : {})
        },
        body
      });
      cookie = mergeCookies(cookie, parseSetCookies(res));
      diagnostics.push({
        step: "login-attempt",
        url: target,
        payloadKeys: body.includes("j_username=") ? "j_username/j_password" : "username/password",
        status: res.status,
        location: res.headers.get("location") || null,
        contentType: res.headers.get("content-type") || null,
        cookieHasLtpa: /(?:^|;\s*)LTPAToken2=/i.test(cookie) || /(?:^|;\s*)LtpaToken2=/i.test(cookie),
        cookieHasJSession: cookie.includes("JSESSIONID=")
      });
      if (hasDxSessionCookies(cookie)) {
        return { cookie, diagnostics };
      }
    }
  }
  return { cookie, diagnostics };
}

function buildVerifyCandidates(base: URL, verifyPath?: string): string[] {
  const requested = verifyPath?.trim() || "/dx/api/wcm/v2/libraries";
  const roots = deriveContextRoots(base);
  const normalized = requested.startsWith("/") ? requested : `/${requested}`;
  const out = new Set<string>();

  // Explicit request first, with both context and origin-root variants.
  for (const root of roots) out.add(new URL(`${root}${normalized}`, base.origin).toString());
  out.add(new URL(normalized, base.origin).toString());

  // Common WCM probes for tenants that expose only one family.
  const defaults = ["/dx/api/wcm/v2/libraries", "/hcl/mycontenthandler/wcmrest-v2/libraries"];
  for (const p of defaults) {
    for (const root of roots) out.add(new URL(`${root}${p}`, base.origin).toString());
    out.add(new URL(p, base.origin).toString());
  }
  return [...out];
}

function verifyResponseLooksAuthenticated(snapshot: {
  url: string;
  status: number;
  location: string | null;
}): boolean {
  if (snapshot.status >= 200 && snapshot.status < 300) return true;
  if (!(snapshot.status >= 300 && snapshot.status < 400) || !snapshot.location) return false;
  const loc = snapshot.location.toLowerCase();
  if (/\/(?:j_security_check|ibm_security_check)\b/.test(loc)) return false;
  if (loc.includes("/redirect")) return false;
  try {
    const requested = new URL(snapshot.url);
    const redirected = new URL(snapshot.location, snapshot.url);
    const reqPath = requested.pathname.replace(/\/+$/, "").toLowerCase();
    const redPath = redirected.pathname.replace(/\/+$/, "").toLowerCase();
    // DX portals often rewrite authenticated API calls to same path + /!ut/p/... digest route.
    if (redPath.startsWith(reqPath) && redPath.includes("/!ut/p/")) return true;
  } catch {
    // ignore URL parse failures
  }
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  const body = (req.body || {}) as Body;
  const base = toUrl(body.baseUrl);
  if (!base) return res.status(400).json({ ok: false, error: "baseUrl must be valid" });
  const manualSessionCookie = typeof body.sessionCookie === "string" ? body.sessionCookie.trim() : "";
  const hasCredentials = Boolean(body.username && body.password);
  if (!manualSessionCookie && !hasCredentials) {
    return res.status(400).json({
      ok: false,
      error: "Provide either sessionCookie or username/password"
    });
  }

  try {
    let cookie = manualSessionCookie;
    const diagnostics: Array<Record<string, unknown>> = [];

    if (manualSessionCookie) {
      diagnostics.push({
        strategy: "manual-session-cookie",
        provided: true,
        cookieHasLtpa: /(?:^|;\s*)LTPAToken2=/i.test(manualSessionCookie) || /(?:^|;\s*)LtpaToken2=/i.test(manualSessionCookie),
        cookieHasJSession: /(?:^|;\s*)JSESSIONID=/i.test(manualSessionCookie)
      });
    }

    if (!cookie && hasCredentials) {
      try {
        const peopleApi = await loginWithPeopleApi(base, body.username!, body.password!);
        cookie = peopleApi.cookie;
        diagnostics.push(...peopleApi.diagnostics);
      } catch (error) {
        diagnostics.push({
          strategy: "people-v1-auth-login",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (!hasDxSessionCookies(cookie) && hasCredentials) {
      const legacy = await loginWithDiagnostics(base, body.username!, body.password!);
      cookie = legacy.cookie;
      diagnostics.push(...legacy.diagnostics);
    }

    if (!cookie) {
      return res.status(401).json({
        ok: false,
        error: "Failed to establish DX session cookie from credentials",
        diagnostics
      });
    }
    const verifyCandidates = buildVerifyCandidates(base, body.verifyPath);
    let verifySummary:
      | {
          url: string;
          status: number;
          contentType: string;
          location: string | null;
        }
      | null = null;
    let verified = false;
    for (const verifyUrl of verifyCandidates) {
      const verify = await fetch(verifyUrl, {
        method: "GET",
        redirect: "manual",
        headers: {
          Cookie: cookie,
          Accept: "application/json,application/xml,text/xml,*/*;q=0.5"
        }
      });
      const snapshot = {
        url: verifyUrl,
        status: verify.status,
        contentType: verify.headers.get("content-type") || "",
        location: verify.headers.get("location") || null
      };
      if (!verifySummary) verifySummary = snapshot;
      diagnostics.push({ strategy: "verify-probe", ...snapshot });
      const looksAuthenticated = verifyResponseLooksAuthenticated({
        url: verifyUrl,
        status: verify.status,
        location: verify.headers.get("location")
      });
      if (looksAuthenticated) {
        verifySummary = snapshot;
        verified = true;
        break;
      }
    }

    if (!verified || !verifySummary) {
      return res.status(401).json({
        ok: false,
        error: "Session cookie was issued but verification against WCM failed",
        diagnostics,
        verify: verifySummary
      });
    }
    const token = issueSessionToken(cookie);
    return res.status(200).json({
      ok: true,
      message: "Session established",
      sessionToken: token,
      verify: verifySummary
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Session bootstrap failed",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
