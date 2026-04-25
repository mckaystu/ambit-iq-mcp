import { graphQuery } from "./_redis";
import {
  cypherMergeComponentNode,
  cypherMergeHasChild,
  cypherMergeHierarchyNode,
  cypherMergeLibrary,
  cypherMergeUsesComponent,
  WCM_HIERARCHY_CYPHER_TEMPLATES
} from "./wcmHierarchyCypher";

export { WCM_HIERARCHY_CYPHER_TEMPLATES };

export type WcmHierarchySyncStats = {
  ok: boolean;
  nodesWritten: number;
  edgesWritten: number;
  requests: number;
  warnings: string[];
  errors: string[];
};

type SyncOptions = {
  libraryDbId: number;
  libraryName: string;
  baseUrl: string;
  username: string;
  password: string;
  cookie?: string;
  /** WCM document library id as used in REST paths (often a UUID). */
  wcmLibraryId: string;
  maxNodes?: number;
  maxDepth?: number;
  delayMs?: number;
  /** Cap MERGE operations for Component + USES_COMPONENT per run (default 4000). */
  maxComponentOps?: number;
};

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

async function fetchWcm(url: string, baseHeaders: Record<string, string>): Promise<Response> {
  let currentUrl = url;
  const headers = { ...baseHeaders };
  for (let hop = 0; hop < 5; hop += 1) {
    const r = await fetch(currentUrl, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(45_000)
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
    signal: AbortSignal.timeout(45_000)
  });
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithRetry(
  url: string,
  headers: Record<string, string>,
  delayMs: number,
  stats: WcmHierarchySyncStats
): Promise<{ ok: boolean; status: number; data: unknown }> {
  let attempt = 0;
  const maxAttempts = 6;
  while (attempt < maxAttempts) {
    stats.requests += 1;
    if (delayMs > 0 && stats.requests > 1) await sleep(delayMs);
    try {
      const res = await fetchWcm(url, headers);
      const status = res.status;
      if (status === 429) {
        stats.warnings.push(`429 from ${url} (attempt ${attempt + 1})`);
        await sleep(Math.min(16_000, 500 * 2 ** attempt));
        attempt += 1;
        continue;
      }
      if (status >= 500 && status < 600) {
        stats.warnings.push(`${status} from ${url} (attempt ${attempt + 1})`);
        await sleep(Math.min(8_000, 400 * 2 ** attempt));
        attempt += 1;
        continue;
      }
      const text = await res.text();
      let data: unknown = null;
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      return { ok: res.ok, status, data };
    } catch (e) {
      stats.warnings.push(`fetch failed ${url}: ${e instanceof Error ? e.message : String(e)}`);
      await sleep(Math.min(8_000, 400 * 2 ** attempt));
      attempt += 1;
    }
  }
  return { ok: false, status: 0, data: null };
}

function resolveOrigin(baseUrl: string): string {
  const b = baseUrl.replace(/\/+$/, "");
  try {
    return new URL(b).origin;
  } catch {
    return b;
  }
}

function wcmApiRoots(origin: string): string[] {
  return [`${origin}/dx/api/wcm/v2`, `${origin}/hcl/mycontenthandler/wcmrest-v2`];
}

function graphLibraryKey(dbId: number, wcmLibraryId: string): string {
  return `library:${dbId}:wcm-lib:${wcmLibraryId}`;
}

function graphSiteAreaKey(dbId: number, externalId: string): string {
  return `library:${dbId}:sitearea:${externalId}`;
}

function graphContentKey(dbId: number, externalId: string): string {
  return `library:${dbId}:content:${externalId}`;
}

function graphComponentKey(dbId: number, componentName: string): string {
  const slug = componentName.trim().slice(0, 200);
  return `library:${dbId}:component:${slug}`;
}

function firstString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function extractItemId(o: Record<string, unknown>): string {
  return firstString(
    o.id,
    o.uuid,
    o.wcmId,
    o.resourceId,
    o.documentId,
    typeof o.identifier === "string" ? o.identifier : undefined
  );
}

function classifyItem(o: Record<string, unknown>): "SiteArea" | "ContentItem" | "Unknown" {
  const raw =
    firstString(o.type, o.elementType, o.category, o.kind, o.resourceType).toLowerCase() ||
    (typeof o.siteArea === "object" ? "sitearea" : "") ||
    "";
  if (raw.includes("site") && raw.includes("area")) return "SiteArea";
  if (raw.includes("sitearea")) return "SiteArea";
  if (raw.includes("content") && !raw.includes("library")) return "ContentItem";
  if (raw.includes("component")) return "ContentItem";
  if (Array.isArray(o.elements) || Array.isArray(o.presentation)) return "ContentItem";
  const href = JSON.stringify(o.links || o.link || {}).toLowerCase();
  if (href.includes("site-area") || href.includes("sitearea")) return "SiteArea";
  if (href.includes("/contents/") || href.includes("content")) return "ContentItem";
  return "Unknown";
}

function extractItems(payload: unknown): Record<string, unknown>[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  if (typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  const candidates: unknown[] = [];
  for (const k of ["items", "entries", "entry", "children", "child", "resources", "resource", "elements"]) {
    const v = o[k];
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

function extractComponentNames(node: unknown, out: Set<string>, depth: number) {
  if (depth <= 0 || out.size >= 200) return;
  if (!node) return;
  if (typeof node === "string") return;
  if (Array.isArray(node)) {
    for (const x of node) extractComponentNames(x, out, depth - 1);
    return;
  }
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  for (const key of [
    "components",
    "componentReferences",
    "referencedComponents",
    "referencedComponentNames",
    "childComponents",
    "presentationElements",
    "wcmComponents",
    "componentList",
    "elements"
  ]) {
    const v = o[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string") {
          const t = item.trim();
          if (t && t.length < 200) out.add(t);
        } else if (item && typeof item === "object" && !Array.isArray(item)) {
          const r = item as Record<string, unknown>;
          const name = firstString(r.name, r.componentName, r.title, r.displayName);
          if (name) out.add(name);
        }
      }
    }
  }
  for (const v of Object.values(o)) extractComponentNames(v, out, depth - 1);
}

function componentNamesFromPayload(payload: unknown): string[] {
  const s = new Set<string>();
  extractComponentNames(payload, s, 14);
  return [...s];
}

const COMPONENT_MARKUP_PATTERNS = [
  /\[Component[^\]]*name="([^"]+)"/gi,
  /\[Component[^\]]*componentName="([^"]+)"/gi,
  /\[Property[^\]]*context="component"[^\]]*name="([^"]+)"/gi
];

function componentNamesFromMarkup(text: string): string[] {
  const out = new Set<string>();
  for (const p of COMPONENT_MARKUP_PATTERNS) {
    let m: RegExpExecArray | null;
    const re = new RegExp(p.source, p.flags);
    while ((m = re.exec(text))) {
      const v = (m[1] || "").trim();
      if (v) out.add(v);
    }
  }
  return [...out];
}

async function tryFirstSuccessfulPath(
  paths: string[],
  headers: Record<string, string>,
  delayMs: number,
  stats: WcmHierarchySyncStats
): Promise<{ url: string; data: unknown } | null> {
  for (const url of paths) {
    const r = await fetchJsonWithRetry(url, headers, delayMs, stats);
    if (r.ok && r.data) return { url, data: r.data };
  }
  return null;
}

/**
 * Recursively sync WCM library hierarchy into FalkorDB using MERGE (idempotent).
 */
export async function syncWcmHierarchyToFalkor(opts: SyncOptions): Promise<WcmHierarchySyncStats> {
  const stats: WcmHierarchySyncStats = {
    ok: true,
    nodesWritten: 0,
    edgesWritten: 0,
    requests: 0,
    warnings: [],
    errors: []
  };

  const maxNodes = Math.min(Math.max(opts.maxNodes ?? 8000, 10), 50_000);
  const maxDepth = Math.min(Math.max(opts.maxDepth ?? 40, 1), 200);
  const delayMs = Math.min(Math.max(opts.delayMs ?? 80, 0), 5000);
  const maxComponentOps = Math.min(Math.max(opts.maxComponentOps ?? 4000, 0), 100_000);
  let componentOps = 0;

  const auth =
    opts.username && opts.password
      ? `Basic ${Buffer.from(`${opts.username}:${opts.password}`).toString("base64")}`
      : "";

  const headers: Record<string, string> = {
    Accept: "application/json, application/xml;q=0.9, */*;q=0.8",
    ...(auth ? { Authorization: auth } : {}),
    ...(opts.cookie ? { Cookie: opts.cookie } : {})
  };

  if (!process.env.FALKOR_REDIS_URL?.trim()) {
    stats.ok = false;
    stats.errors.push("FALKOR_REDIS_URL is not configured");
    return stats;
  }

  const origin = resolveOrigin(opts.baseUrl);
  const roots = wcmApiRoots(origin);
  const wcmLib = encodeURIComponent(opts.wcmLibraryId);

  const libKey = graphLibraryKey(opts.libraryDbId, opts.wcmLibraryId);
  await graphQuery(
    cypherMergeLibrary({
      key: libKey,
      name: opts.libraryName,
      wcmLibraryId: opts.wcmLibraryId,
      dbLibraryId: opts.libraryDbId
    })
  );
  stats.nodesWritten += 1;

  let nodes = 0;
  const visitedSiteAreaChildren = new Set<string>();

  async function mergeNodeAndEdge(params: {
    parentKey: string;
    kind: "SiteArea" | "ContentItem";
    externalId: string;
    name: string;
    wcmType: string;
  }) {
    if (nodes >= maxNodes) return;
    const childKey =
      params.kind === "SiteArea"
        ? graphSiteAreaKey(opts.libraryDbId, params.externalId)
        : graphContentKey(opts.libraryDbId, params.externalId);
    await graphQuery(
      cypherMergeHierarchyNode({
        key: childKey,
        label: params.kind,
        name: params.name || params.externalId,
        wcmType: params.wcmType,
        externalId: params.externalId
      })
    );
    stats.nodesWritten += 1;
    nodes += 1;
    try {
      await graphQuery(cypherMergeHasChild({ parentKey: params.parentKey, childKey }));
      stats.edgesWritten += 1;
    } catch {
      stats.warnings.push(`HAS_CHILD skipped (parent or child missing in graph): ${params.parentKey} -> ${childKey}`);
    }
    return childKey;
  }

  async function ingestContentComponents(contentKey: string, detailPayload: unknown) {
    const names = new Set<string>();
    for (const n of componentNamesFromPayload(detailPayload)) names.add(n);
    const blob = JSON.stringify(detailPayload).slice(0, 48_000);
    for (const n of componentNamesFromMarkup(blob)) names.add(n);
    for (const name of names) {
      if (componentOps >= maxComponentOps) {
        stats.warnings.push(`Stopped component ingest at maxComponentOps=${maxComponentOps}`);
        break;
      }
      if (!name.trim()) continue;
      const compKey = graphComponentKey(opts.libraryDbId, name);
      await graphQuery(cypherMergeComponentNode({ key: compKey, name: name.trim() }));
      stats.nodesWritten += 1;
      componentOps += 1;
      await graphQuery(cypherMergeUsesComponent({ contentKey, componentKey: compKey }));
      stats.edgesWritten += 1;
      componentOps += 1;
    }
  }

  async function drillSiteArea(siteAreaId: string, parentKey: string, depth: number) {
    if (depth > maxDepth || nodes >= maxNodes) return;
    if (visitedSiteAreaChildren.has(siteAreaId)) return;
    visitedSiteAreaChildren.add(siteAreaId);

    const idEnc = encodeURIComponent(siteAreaId);
    const childPaths = roots.flatMap((r) => [
      `${r}/siteareas/${idEnc}/children`,
      `${r}/site-areas/${idEnc}/children`,
      `${r}/site-areas/${idEnc}/child`
    ]);

    const hit = await tryFirstSuccessfulPath(childPaths, headers, delayMs, stats);
    if (!hit) {
      stats.warnings.push(`No children response for site area ${siteAreaId}`);
      return;
    }

    for (const raw of extractItems(hit.data)) {
      if (nodes >= maxNodes) break;
      const extId = extractItemId(raw);
      if (!extId) continue;
      const cls = classifyItem(raw);
      const name = firstString(raw.name, raw.title, raw.displayName, raw.label) || extId;
      const wcmType = firstString(raw.type, raw.elementType, raw.category) || cls;

      if (cls === "SiteArea") {
        const childKey = await mergeNodeAndEdge({
          parentKey,
          kind: "SiteArea",
          externalId: extId,
          name,
          wcmType
        });
        if (childKey) await drillSiteArea(extId, childKey, depth + 1);
      } else if (cls === "ContentItem") {
        const childKey = await mergeNodeAndEdge({
          parentKey,
          kind: "ContentItem",
          externalId: extId,
          name,
          wcmType
        });
        if (childKey) await fetchAndExpandContent(extId, childKey);
      } else {
        stats.warnings.push(`Unclassified child under site area ${siteAreaId}: ${extId}`);
      }
    }
  }

  async function fetchAndExpandContent(contentId: string, contentKey: string) {
    if (nodes >= maxNodes) return;
    const idEnc = encodeURIComponent(contentId);
    const expandPaths = roots.flatMap((r) => [
      `${r}/contents/${idEnc}?expand=elements`,
      `${r}/contents/${idEnc}?include=elements`,
      `${r}/contents/${idEnc}`
    ]);
    const hit = await tryFirstSuccessfulPath(expandPaths, headers, delayMs, stats);
    if (!hit) {
      stats.warnings.push(`No content detail for ${contentId}`);
      return;
    }
    try {
      await ingestContentComponents(contentKey, hit.data);
    } catch (e) {
      stats.warnings.push(`Component extract failed for content ${contentId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function processRootItem(raw: Record<string, unknown>) {
    if (nodes >= maxNodes) return;
    const extId = extractItemId(raw);
    if (!extId) return;
    const cls = classifyItem(raw);
    const name = firstString(raw.name, raw.title, raw.displayName, raw.label) || extId;
    const wcmType = firstString(raw.type, raw.elementType, raw.category) || cls;

    if (cls === "SiteArea") {
      const childKey = await mergeNodeAndEdge({
        parentKey: libKey,
        kind: "SiteArea",
        externalId: extId,
        name,
        wcmType
      });
      if (childKey) await drillSiteArea(extId, childKey, 1);
    } else if (cls === "ContentItem") {
      const childKey = await mergeNodeAndEdge({
        parentKey: libKey,
        kind: "ContentItem",
        externalId: extId,
        name,
        wcmType
      });
      if (childKey) await fetchAndExpandContent(extId, childKey);
    }
  }

  const rootPaths = roots.map((r) => `${r}/libraries/${wcmLib}/root-items`);
  const rootHit = await tryFirstSuccessfulPath(rootPaths, headers, delayMs, stats);

  if (!rootHit) {
    stats.ok = false;
    stats.errors.push("Could not load library root-items from any known WCM v2 base path");
    return stats;
  }

  const items = extractItems(rootHit.data);
  if (items.length === 0) {
    stats.warnings.push("root-items returned no parseable items; check response shape or permissions");
  }

  for (const item of items) {
    await processRootItem(item);
    if (nodes >= maxNodes) {
      stats.warnings.push(`Stopped at maxNodes=${maxNodes}`);
      break;
    }
  }

  return stats;
}

/**
 * Optional: list WCM libraries and return ids (first page) to help pick wcmLibraryId.
 */
export async function listWcmLibraries(opts: {
  baseUrl: string;
  username: string;
  password: string;
  cookie?: string;
}): Promise<{ ok: boolean; libraries: Array<{ id: string; name: string }>; warnings: string[] }> {
  const mini: WcmHierarchySyncStats = {
    ok: true,
    nodesWritten: 0,
    edgesWritten: 0,
    requests: 0,
    warnings: [],
    errors: []
  };
  const origin = resolveOrigin(opts.baseUrl);
  const roots = wcmApiRoots(origin);
  const auth =
    opts.username && opts.password
      ? `Basic ${Buffer.from(`${opts.username}:${opts.password}`).toString("base64")}`
      : "";
  const headers: Record<string, string> = {
    Accept: "application/json, */*",
    ...(auth ? { Authorization: auth } : {}),
    ...(opts.cookie ? { Cookie: opts.cookie } : {})
  };
  const paths = roots.map((r) => `${r}/libraries`);
  const hit = await tryFirstSuccessfulPath(paths, headers, 0, mini);
  if (!hit) return { ok: false, libraries: [], warnings: mini.warnings };

  const items = extractItems(hit.data);
  const libraries = items
    .map((o) => ({
      id: extractItemId(o),
      name: firstString(o.name, o.title, o.displayName, o.libraryTitle) || extractItemId(o)
    }))
    .filter((x) => x.id);
  return { ok: true, libraries, warnings: mini.warnings };
}
