function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

const MAX_RESPONSE_BYTES = envInt("SCAN_MAX_RESPONSE_BYTES", 1_500_000);

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

export function clampBodyText(bodyText: string): string {
  if (bodyText.length <= MAX_RESPONSE_BYTES) return bodyText;
  return bodyText.slice(0, MAX_RESPONSE_BYTES);
}

export function resolveOriginFromBaseUrl(baseUrl: string): string {
  const b = baseUrl.replace(/\/+$/, "");
  try {
    return new URL(b).origin;
  } catch {
    return b;
  }
}

export async function fetchDx(url: string, baseHeaders: Record<string, string>) {
  let currentUrl = url;
  const headers = { ...baseHeaders };
  for (let hop = 0; hop < 5; hop += 1) {
    const r = await fetch(currentUrl, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000)
    });
    const nextCookie = mergeCookieHeader(headers.Cookie, r);
    if (nextCookie) headers.Cookie = nextCookie;
    const loc = r.headers.get("location");
    if (!(r.status >= 300 && r.status < 400 && loc)) return r;
    currentUrl = new URL(loc, currentUrl).toString();
  }
  return fetch(currentUrl, {
    method: "GET",
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(30_000)
  });
}
