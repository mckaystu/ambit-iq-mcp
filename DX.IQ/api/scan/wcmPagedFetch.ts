import { clampBodyText, fetchDx, resolveOriginFromBaseUrl } from "./wcmFetch";

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

/** Default page size for WCM v2 list endpoints (reduces round-trips vs server default ~50). */
export const WCM_DEFAULT_PAGE_SIZE = envInt("SCAN_WCM_PAGE_SIZE", 100);
const WCM_MAX_PAGES = envInt("SCAN_WCM_MAX_PAGES", 400);

export function urlLooksWcmCollection(url: string): boolean {
  return /\/dx\/api\/wcm\/v2\//i.test(url) || /wcmrest-v2/i.test(url) || /mycontenthandler\/wcmrest/i.test(url);
}

export function withPageSizeParam(url: string, pageSize: number): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has("pageSize")) u.searchParams.set("pageSize", String(pageSize));
    if (!u.searchParams.has("limit")) u.searchParams.set("limit", String(pageSize));
    return u.toString();
  } catch {
    const join = url.includes("?") ? "&" : "?";
    return `${url}${join}pageSize=${encodeURIComponent(String(pageSize))}&limit=${encodeURIComponent(String(pageSize))}`;
  }
}

/** Scope collection GETs to a WCM library when the server expects `libraryId`. */
export function withLibraryIdParam(url: string, wcmLibraryId: string | undefined): string {
  const id = wcmLibraryId?.trim();
  if (!id) return url;
  try {
    const u = new URL(url);
    if (/\/(folders|libraries|component|contents|site-areas|content-templates|presentationtemplate|presentation-templates)\b/i.test(u.pathname)) {
      if (!u.searchParams.has("libraryId")) u.searchParams.set("libraryId", id);
      if (!u.searchParams.has("library_id")) u.searchParams.set("library_id", id);
      if (!u.searchParams.has("libraryID")) u.searchParams.set("libraryID", id);
    }
    return u.toString();
  } catch {
    return url;
  }
}

function toAbsoluteHref(currentUrl: string, href: string): string {
  const h = href.trim();
  if (!h) return "";
  if (/^https?:\/\//i.test(h)) return h;
  const origin = resolveOriginFromBaseUrl(currentUrl);
  try {
    return new URL(h.startsWith("/") ? h : `/${h}`, `${origin}/`).toString();
  } catch {
    return new URL(h, currentUrl).toString();
  }
}

/** Server-reported total, when present (metadata.totalItems, opensearch:totalResults, etc.). */
export function extractTotalItemsMetadata(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  const meta = o.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const m = meta as Record<string, unknown>;
    for (const k of ["totalItems", "total", "totalCount", "itemCount", "size"]) {
      const v = m[k];
      if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
      if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
    }
  }
  for (const k of ["totalItems", "total", "totalSize", "totalCount", "count"]) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
    if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
  }
  const feed = o.feed;
  if (feed && typeof feed === "object") {
    const f = feed as Record<string, unknown>;
    const te =
      f.opensearch$totalResults ??
      f["opensearch:totalResults"] ??
      f.totalResults ??
      f["opensearch$totalResults"];
    if (typeof te === "number" && Number.isFinite(te)) return Math.floor(te);
    if (typeof te === "string" && /^\d+$/.test(te)) return parseInt(te, 10);
  }
  return null;
}

function extractNextPageUrl(payload: unknown, currentAbsoluteUrl: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  const links = o.links;
  if (links && typeof links === "object" && !Array.isArray(links)) {
    const next = (links as Record<string, unknown>).next;
    if (next && typeof next === "object" && !Array.isArray(next)) {
      const href = (next as Record<string, unknown>).href;
      if (typeof href === "string" && href.trim()) return toAbsoluteHref(currentAbsoluteUrl, href);
    }
  }
  const arr: unknown[] = [
    ...(Array.isArray(o.links) ? o.links : []),
    ...(Array.isArray(o.link) ? o.link : [])
  ];
  if (o.link && typeof o.link === "object" && !Array.isArray(o.link)) arr.push(o.link);
  for (const L of arr) {
    if (!L || typeof L !== "object" || Array.isArray(L)) continue;
    const rel = String((L as Record<string, unknown>).rel || "").toLowerCase();
    const href = (L as Record<string, unknown>).href;
    if (typeof href !== "string" || !href.trim()) continue;
    if (rel === "next" || rel.endsWith("/next") || rel.includes("next")) {
      return toAbsoluteHref(currentAbsoluteUrl, href);
    }
  }
  const feed = o.feed;
  if (feed && typeof feed === "object") {
    const f = feed as Record<string, unknown>;
    const lk = f.link;
    const list = Array.isArray(lk) ? lk : lk ? [lk] : [];
    for (const L of list) {
      if (!L || typeof L !== "object") continue;
      const rel = String((L as Record<string, unknown>).rel || "").toLowerCase();
      const href = (L as Record<string, unknown>).href;
      if (typeof href === "string" && href.trim() && (rel === "next" || rel.includes("next"))) {
        return toAbsoluteHref(currentAbsoluteUrl, href);
      }
    }
  }
  return null;
}

/** Same item-extraction heuristics as folder crawl / ingestion lists. */
export function extractListItemsFromPayload(payload: unknown): Record<string, unknown>[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  if (typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  const candidates: unknown[] = [];
  const directKeys = ["items", "entries", "entry", "children", "resources", "resource", "folders", "elements"];
  for (const k of directKeys) {
    const v = o[k];
    if (Array.isArray(v)) candidates.push(...v);
    else if (v && typeof v === "object" && !Array.isArray(v)) candidates.push(v);
  }
  // WCM often uses hyphenated/pluralized buckets like "library-entries", "component-entries", etc.
  for (const [k, v] of Object.entries(o)) {
    const key = k.toLowerCase();
    if (
      !/(entries|items|results|contents|components|libraries|folders|siteareas|site-areas|documents)/.test(key) &&
      !key.endsWith("-entries")
    ) {
      continue;
    }
    if (Array.isArray(v)) candidates.push(...v);
    else if (v && typeof v === "object" && !Array.isArray(v)) candidates.push(v);
  }
  if (candidates.length === 0 && o.feed && typeof o.feed === "object") {
    const f = o.feed as Record<string, unknown>;
    if (Array.isArray(f.entry)) candidates.push(...f.entry);
    else if (f.entry && typeof f.entry === "object") candidates.push(f.entry);
  }
  const out: Record<string, unknown>[] = [];
  for (const c of candidates) {
    if (!c || typeof c !== "object" || Array.isArray(c)) continue;
    out.push(c as Record<string, unknown>);
  }
  return out;
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export type PagedCollectionResult = {
  mergedPayload: { items: Record<string, unknown>[] };
  pagesFetched: number;
  totalItemsHint: number | null;
  rowsMerged: number;
  firstUrl: string;
  lastUrl: string;
};

/**
 * GET a WCM collection URL, follow `links.next` until exhausted, merge rows into `items`.
 * Logs metadata total vs rows merged for debugging the “~51 cap”.
 */
export async function fetchWcmJsonCollectionAllPages(params: {
  seedUrl: string;
  headers: Record<string, string>;
  pageSize?: number;
  wcmLibraryId?: string;
  logLabel: string;
}): Promise<PagedCollectionResult | null> {
  const pageSize = params.pageSize ?? WCM_DEFAULT_PAGE_SIZE;
  let url = withLibraryIdParam(withPageSizeParam(params.seedUrl.trim(), pageSize), params.wcmLibraryId);
  const merged: Record<string, unknown>[] = [];
  let pagesFetched = 0;
  let totalItemsHint: number | null = null;
  let firstUrl = url;
  let lastUrl = url;
  const seenUrls = new Set<string>();

  while (pagesFetched < WCM_MAX_PAGES) {
    if (seenUrls.has(url)) break;
    seenUrls.add(url);

    const res = await fetchDx(url, params.headers);
    const raw = clampBodyText(await res.text());
    lastUrl = url;
    if (!res.ok || !raw.trim()) {
      if (pagesFetched === 0) return null;
      break;
    }
    const parsed = tryParseJson(raw);
    if (!parsed || typeof parsed !== "object") {
      if (pagesFetched === 0) return null;
      break;
    }
    pagesFetched += 1;
    const hint = extractTotalItemsMetadata(parsed);
    if (hint !== null && (totalItemsHint === null || hint > totalItemsHint)) totalItemsHint = hint;
    const pageItems = extractListItemsFromPayload(parsed);
    merged.push(...pageItems);

    const next = extractNextPageUrl(parsed, url);
    if (next && next !== url) {
      url = next;
      if (!url.includes("pageSize=") && !url.includes("pageSize%3D")) {
        url = withPageSizeParam(url, pageSize);
      }
      continue;
    }

    // Spec-compatible fallback pagination: many DX routes use limit/offset without links.next.
    if (totalItemsHint !== null && merged.length < totalItemsHint && pageItems.length > 0) {
      try {
        const u = new URL(url);
        if (!u.searchParams.has("limit")) u.searchParams.set("limit", String(pageSize));
        u.searchParams.set("offset", String(merged.length));
        url = u.toString();
        continue;
      } catch {
        // stop when URL cannot be adjusted
      }
    }
    break;
  }

  if (pagesFetched === 0) return null;

  console.log(
    `[DX.IQ crawl] ${params.logLabel}: totalItems(metadata)=${totalItemsHint ?? "n/a"} fetchedRows=${merged.length} pages=${pagesFetched} first=${firstUrl.slice(0, 120)}${firstUrl.length > 120 ? "…" : ""}`
  );

  return {
    mergedPayload: { items: merged },
    pagesFetched,
    totalItemsHint,
    rowsMerged: merged.length,
    firstUrl,
    lastUrl
  };
}

/**
 * Try several seed URLs (e.g. dx vs contenthandler); first successful wins, then paginate on that chain.
 */
export async function fetchWcmJsonCollectionAllPagesFirstSeed(params: {
  seedUrls: string[];
  headers: Record<string, string>;
  pageSize?: number;
  wcmLibraryId?: string;
  logLabel: string;
}): Promise<PagedCollectionResult | null> {
  for (const seed of params.seedUrls) {
    const hit = await fetchWcmJsonCollectionAllPages({
      seedUrl: seed,
      headers: params.headers,
      pageSize: params.pageSize,
      wcmLibraryId: params.wcmLibraryId,
      logLabel: params.logLabel
    });
    if (hit && hit.rowsMerged > 0) return hit;
    if (hit && hit.pagesFetched > 0) return hit;
  }
  return null;
}

/**
 * POST /items/query with explicit library filter (when GET lists are capped or unavailable).
 * Body shape follows common WCM v2 patterns; extend if your tenant differs.
 */
export async function postWcmItemsQuery(params: {
  queryUrl: string;
  headers: Record<string, string>;
  wcmLibraryId: string;
  pageSize?: number;
  logLabel: string;
}): Promise<PagedCollectionResult | null> {
  const pageSize = params.pageSize ?? WCM_DEFAULT_PAGE_SIZE;
  const body = {
    libraryId: params.wcmLibraryId,
    library_id: params.wcmLibraryId,
    pageSize,
    limit: pageSize
  };
  const h = {
    ...params.headers,
    Accept: "application/json",
    "Content-Type": "application/json"
  };
  const res = await fetch(params.queryUrl, {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000)
  });
  const raw = clampBodyText(await res.text());
  if (!res.ok || !raw.trim()) return null;
  const parsed = tryParseJson(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const hint = extractTotalItemsMetadata(parsed);
  const pageItems = extractListItemsFromPayload(parsed);
  console.log(
    `[DX.IQ crawl] ${params.logLabel} (POST items/query): totalItems(metadata)=${hint ?? "n/a"} fetchedRows=${pageItems.length}`
  );
  return {
    mergedPayload: { items: pageItems },
    pagesFetched: 1,
    totalItemsHint: hint,
    rowsMerged: pageItems.length,
    firstUrl: params.queryUrl,
    lastUrl: params.queryUrl
  };
}
