import axios, { type AxiosInstance } from "axios";
import pLimit from "p-limit";
import { graphQuery } from "./_redis";
import {
  buildBatchUsesComponent,
  cypherGetDeepestPath,
  cypherGetOrphanedComponents,
  cypherGetTemplateUsage,
  cypherMergeBasedOn,
  cypherMergeComponentIngest,
  cypherMergeContentTemplate,
  cypherMergeHasChildKeys,
  cypherMergeIngestHierarchyNode,
  cypherMergeIngestLibrary,
  ingestComponentKey,
  ingestContentKey,
  ingestLibraryKey,
  ingestSiteAreaKey,
  ingestTemplateKey,
  parseCompactGraphRows
} from "./ingestionCypher";

export type IngestionAuth =
  | { kind: "bearer"; token: string }
  | { kind: "basic"; username: string; password: string };

export type IngestionServiceOptions = {
  baseUrl: string;
  auth: IngestionAuth;
  cookie?: string;
  /** WCM REST library id (UUID) — optional if libraryName is set */
  wcmLibraryId?: string;
  /** Resolved against GET .../libraries when wcmLibraryId is omitted */
  libraryName?: string;
  maxConcurrency?: number;
  maxNodes?: number;
  maxDepth?: number;
  delayMs?: number;
  batchUsesSize?: number;
  maxComponentOps?: number;
};

export type IngestionRunResult = {
  ok: boolean;
  wcmLibraryId: string;
  wcmLibraryName: string;
  nodesWritten: number;
  edgesWritten: number;
  requests: number;
  warnings: string[];
  errors: string[];
};

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
  const href = JSON.stringify(o.links || o.link || "").toLowerCase();
  if (href.includes("site-area") || href.includes("sitearea")) return "SiteArea";
  if (href.includes("/contents/") || href.includes("content")) return "ContentItem";
  return "Unknown";
}

function nodeMeta(raw: Record<string, unknown>): {
  title: string;
  lastModified: string;
  status: string;
} {
  return {
    title: firstString(raw.title, raw.displayName, raw.name),
    lastModified: firstString(
      raw.lastModified,
      raw.modified,
      raw.lastModifiedDate,
      raw.updated,
      typeof raw.lastModifiedDate === "string" ? raw.lastModifiedDate : undefined
    ),
    status: firstString(raw.status, raw.state, raw.publishingStatus, raw.lifecycleStatus)
  };
}

function extractTemplateBinding(payload: unknown): { templateId: string; templateName: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  const id = firstString(
    o.presentationTemplateId,
    o.presentationTemplateID,
    o.authoringTemplateId,
    o.contentTemplateId,
    o.templateId,
    o.defaultPresentationTemplateId
  );
  const name = firstString(
    o.presentationTemplateName,
    o.authoringTemplateName,
    o.templateName,
    o.contentTemplateName
  );
  if (!id && !name) return null;
  return { templateId: id || `noid:${name.slice(0, 80)}`, templateName: name || id };
}

function parseElementsForComponentRefs(payload: unknown): Array<{ elementName: string; componentName: string }> {
  const out: Array<{ elementName: string; componentName: string }> = [];
  const seen = new Set<string>();

  const consider = (o: Record<string, unknown>, elementNameFallback: string) => {
    const t = firstString(o.type, o.elementType, o.kind, o.category).toLowerCase();
    const compName = firstString(
      o.componentName,
      o.component,
      o.referenceName,
      o.portletName,
      o.name,
      o.title
    );
    const elementName = firstString(o.elementName, o.fieldName, o.slotName, o.id, o.name) || elementNameFallback;
    const looksComponent =
      t.includes("component") ||
      t.includes("portlet") ||
      t.includes("reference") ||
      o.referenceType === "component" ||
      typeof o.componentName === "string";
    if (compName && compName.length < 200 && looksComponent) {
      const k = `${elementName}::${compName}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push({ elementName, componentName: compName });
      }
    }
  };

  const walk = (node: unknown, depth: number) => {
    if (depth <= 0) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth - 1);
      return;
    }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    consider(o, "element");
    for (const k of ["elements", "presentationElements", "fields", "children"]) {
      const v = o[k];
      if (Array.isArray(v)) walk(v, depth - 1);
    }
  };

  walk(payload, 20);
  return out;
}

const MARKUP_PATTERNS = [
  /\[Component[^\]]*name="([^"]+)"/gi,
  /\[Component[^\]]*componentName="([^"]+)"/gi,
  /\[Property[^\]]*context="component"[^\]]*name="([^"]+)"/gi
];

function componentNamesFromMarkup(text: string): string[] {
  const s = new Set<string>();
  for (const p of MARKUP_PATTERNS) {
    const re = new RegExp(p.source, p.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const v = (m[1] || "").trim();
      if (v) s.add(v);
    }
  }
  return [...s];
}

class UsesComponentBatcher {
  private rows: Array<{ contentKey: string; componentKey: string; elementName: string }> = [];

  constructor(
    private readonly batchSize: number,
    private readonly wcmLibraryId: string,
    private readonly onFlush: (edgeCount: number) => void
  ) {}

  add(contentKey: string, componentName: string, elementName: string) {
    const componentKey = ingestComponentKey(this.wcmLibraryId, componentName);
    const en = elementName.trim() || componentName;
    this.rows.push({ contentKey, componentKey, elementName: en });
    if (this.rows.length >= this.batchSize) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.rows.length === 0) return;
    const n = this.rows.length;
    const q = buildBatchUsesComponent(this.rows);
    this.rows = [];
    if (q) {
      await graphQuery(q);
      this.onFlush(n);
    }
  }
}

function mergeCookieHeader(current: string, setCookie: string | string[] | undefined): string {
  if (!setCookie) return current;
  const parts = Array.isArray(setCookie) ? setCookie : [setCookie];
  const jar = new Map<string, string>();
  for (const c of current.split(";")) {
    const kv = c.trim();
    const i = kv.indexOf("=");
    if (i > 0) jar.set(kv.slice(0, i), kv.slice(i + 1));
  }
  for (const raw of parts) {
    const kv = raw.split(";")[0]?.trim();
    if (!kv || !kv.includes("=")) continue;
    const i = kv.indexOf("=");
    jar.set(kv.slice(0, i), kv.slice(i + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * Orchestrates HCL DX WCM v2 hierarchy crawl + Falkor graph writes (MERGE, batched USES_COMPONENT).
 * HTTP: axios. Graph: Redis GRAPH.QUERY via {@link graphQuery} (FalkorDB-compatible).
 */
export class IngestionService {
  private readonly origin: string;
  private readonly roots: string[];
  private readonly http: AxiosInstance;
  private cookie = "";
  private requests = 0;

  constructor(private readonly opts: IngestionServiceOptions) {
    this.origin = resolveOrigin(opts.baseUrl);
    this.roots = wcmApiRoots(this.origin);
    this.cookie = opts.cookie?.trim() || "";
    this.http = axios.create({
      timeout: 60_000,
      maxRedirects: 5,
      validateStatus: () => true,
      responseType: "json",
      transformResponse: [
        (data, headers) => {
          const ct = String(headers["content-type"] || "").toLowerCase();
          if (typeof data === "string" && (ct.includes("json") || data.trim().startsWith("{"))) {
            try {
              return JSON.parse(data);
            } catch {
              return data;
            }
          }
          return data;
        }
      ]
    });

    this.http.interceptors.request.use((config) => {
      if (this.cookie) {
        config.headers = config.headers || {};
        config.headers.Cookie = this.cookie;
      }
      return config;
    });

    this.http.interceptors.response.use((res) => {
      const sc = res.headers["set-cookie"];
      if (sc) this.cookie = mergeCookieHeader(this.cookie, sc);
      return res;
    });
  }

  private authHeaders(): Record<string, string> {
    const a = this.opts.auth;
    if (a.kind === "bearer") {
      return { Authorization: `Bearer ${a.token.trim()}` };
    }
    const raw = `${a.username}:${a.password}`;
    return { Authorization: `Basic ${Buffer.from(raw).toString("base64")}` };
  }

  private wcmHeaders(): Record<string, string> {
    return {
      Accept: "application/json, application/xml;q=0.9, */*;q=0.8",
      ...this.authHeaders()
    };
  }

  private async getFirstJson(paths: string[]): Promise<{ url: string; data: unknown } | null> {
    for (const url of paths) {
      this.requests += 1;
      if (this.opts.delayMs && this.requests > 1) {
        await new Promise((r) => setTimeout(r, this.opts.delayMs));
      }
      const res = await this.http.get(url, { headers: this.wcmHeaders() });
      if (res.status >= 200 && res.status < 300 && res.data != null) {
        return { url, data: res.data };
      }
    }
    return null;
  }

  /**
   * Resolve WCM library id + display name from GET .../libraries.
   */
  async resolveWcmLibrary(): Promise<{ id: string; name: string; raw: Record<string, unknown> }> {
    const wantId = this.opts.wcmLibraryId?.trim();
    const wantName = this.opts.libraryName?.trim().toLowerCase();

    for (const base of this.roots) {
      const hit = await this.getFirstJson([`${base}/libraries`]);
      if (!hit) continue;
      const items = extractItems(hit.data);
      if (wantId) {
        const row = items.find((i) => extractItemId(i) === wantId);
        if (row) {
          return {
            id: wantId,
            name: firstString(row.name, row.title, row.displayName, row.libraryTitle) || wantId,
            raw: row
          };
        }
      }
      if (wantName) {
        const row = items.find((i) => {
          const n = firstString(i.name, i.title, i.displayName, i.libraryTitle).toLowerCase();
          return n === wantName || n.includes(wantName) || wantName.includes(n);
        });
        if (row) {
          const id = extractItemId(row);
          if (id) return { id, name: firstString(row.name, row.title, row.displayName) || id, raw: row };
        }
      }
    }

    throw new Error(
      wantId
        ? `WCM library id not found: ${wantId}`
        : wantName
          ? `WCM library name not found: ${this.opts.libraryName}`
          : "Provide wcmLibraryId or libraryName"
    );
  }

  /**
   * Full ingest: root library node, root-items, recursive site areas, content expand + templates.
   */
  async ingest(): Promise<IngestionRunResult> {
    const result: IngestionRunResult = {
      ok: true,
      wcmLibraryId: "",
      wcmLibraryName: "",
      nodesWritten: 0,
      edgesWritten: 0,
      requests: 0,
      warnings: [],
      errors: []
    };

    if (!process.env.FALKOR_REDIS_URL?.trim()) {
      result.ok = false;
      result.errors.push("FALKOR_REDIS_URL is not configured");
      return result;
    }

    if (!this.opts.wcmLibraryId?.trim() && !this.opts.libraryName?.trim()) {
      result.ok = false;
      result.errors.push("Provide wcmLibraryId or libraryName");
      return result;
    }

    const maxNodes = Math.min(Math.max(this.opts.maxNodes ?? 12_000, 10), 80_000);
    const maxDepth = Math.min(Math.max(this.opts.maxDepth ?? 48, 1), 250);
    const maxComponentOps = Math.min(Math.max(this.opts.maxComponentOps ?? 8000, 0), 200_000);
    const batchUsesSize = Math.min(Math.max(this.opts.batchUsesSize ?? 30, 5), 80);
    const concurrency = Math.min(Math.max(this.opts.maxConcurrency ?? 6, 1), 16);
    const httpLimit = pLimit(concurrency);
    const graphLimit = pLimit(1);
    const runGraph = (q: string) => graphLimit(() => graphQuery(q));

    let lib: { id: string; name: string; raw: Record<string, unknown> };
    try {
      lib = await this.resolveWcmLibrary();
    } catch (e) {
      result.ok = false;
      result.errors.push(e instanceof Error ? e.message : String(e));
      return result;
    }

    result.wcmLibraryId = lib.id;
    result.wcmLibraryName = lib.name;
    const wcmLibraryId = lib.id;
    const libKey = ingestLibraryKey(wcmLibraryId);
    const meta = nodeMeta(lib.raw);

    await graphQuery(
      cypherMergeIngestLibrary({
        key: libKey,
        wcmLibraryId,
        name: lib.name,
        title: meta.title || lib.name,
        lastModified: meta.lastModified,
        status: meta.status
      })
    );
    result.nodesWritten += 1;

    const usesBatcher = new UsesComponentBatcher(batchUsesSize, wcmLibraryId, (edgeCount) => {
      result.edgesWritten += edgeCount;
    });
    let componentOps = 0;
    let nodes = 0;
    const visitedSa = new Set<string>();

    const mergeChild = async (params: {
      parentKey: string;
      kind: "SiteArea" | "ContentItem";
      externalId: string;
      raw: Record<string, unknown>;
    }) => {
      if (nodes >= maxNodes) return undefined;
      const m = nodeMeta(params.raw);
      const childKey =
        params.kind === "SiteArea"
          ? ingestSiteAreaKey(wcmLibraryId, params.externalId)
          : ingestContentKey(wcmLibraryId, params.externalId);
      await runGraph(
        cypherMergeIngestHierarchyNode({
          key: childKey,
          label: params.kind,
          externalId: params.externalId,
          name: firstString(params.raw.name, params.raw.title, params.raw.displayName) || params.externalId,
          title: m.title,
          lastModified: m.lastModified,
          status: m.status,
          wcmType: firstString(params.raw.type, params.raw.elementType, params.raw.category)
        })
      );
      await runGraph(cypherMergeHasChildKeys(params.parentKey, childKey));
      result.nodesWritten += 1;
      result.edgesWritten += 1;
      nodes += 1;
      return childKey;
    };

    const ingestContentDetail = async (contentId: string, contentKey: string, detail: unknown) => {
      if (!(detail && typeof detail === "object")) return;
      const tpl = extractTemplateBinding(detail);
      if (tpl) {
        const tplKey = ingestTemplateKey(wcmLibraryId, tpl.templateId);
        await runGraph(
          cypherMergeContentTemplate({
            key: tplKey,
            templateId: tpl.templateId,
            name: tpl.templateName,
            title: tpl.templateName
          })
        );
        await runGraph(cypherMergeBasedOn({ contentKey, templateKey: tplKey }));
        result.nodesWritten += 1;
        result.edgesWritten += 1;
      }

      const refs = parseElementsForComponentRefs(detail);
      const blob = JSON.stringify(detail).slice(0, 56_000);
      for (const cn of componentNamesFromMarkup(blob)) {
        refs.push({ elementName: cn, componentName: cn });
      }

      for (const { elementName, componentName } of refs) {
        if (componentOps >= maxComponentOps) {
          result.warnings.push(`Stopped component ingest at maxComponentOps=${maxComponentOps}`);
          break;
        }
        await runGraph(
          cypherMergeComponentIngest({
            key: ingestComponentKey(wcmLibraryId, componentName),
            name: componentName.trim(),
            title: componentName.trim()
          })
        );
        result.nodesWritten += 1;
        usesBatcher.add(contentKey, componentName, elementName);
        componentOps += 2;
      }
      await usesBatcher.flush();
    };

    const fetchContentExpanded = (contentId: string) => {
      const idEnc = encodeURIComponent(contentId);
      return this.roots.flatMap((r) => [
        `${r}/contents/${idEnc}?expand=elements`,
        `${r}/contents/${idEnc}?include=elements`,
        `${r}/contents/${idEnc}`
      ]);
    };

    const fetchContentJson = (contentId: string) =>
      httpLimit(async () => {
        const hit = await this.getFirstJson(fetchContentExpanded(contentId));
        return hit;
      });

    const processContent = async (contentId: string, contentKey: string) => {
      const hit = await fetchContentJson(contentId);
      if (!hit) {
        result.warnings.push(`No content detail for ${contentId}`);
        return;
      }
      await ingestContentDetail(contentId, contentKey, hit.data);
    };

    const drillSiteArea = async (siteAreaId: string, parentKey: string, depth: number): Promise<void> => {
      if (depth > maxDepth || nodes >= maxNodes) return;
      if (visitedSa.has(siteAreaId)) return;
      visitedSa.add(siteAreaId);
      const idEnc = encodeURIComponent(siteAreaId);
      const paths = this.roots.flatMap((r) => [
        `${r}/siteareas/${idEnc}/children`,
        `${r}/site-areas/${idEnc}/children`,
        `${r}/site-areas/${idEnc}/child`
      ]);
      const hit = await this.getFirstJson(paths);
      if (!hit) {
        result.warnings.push(`No children for site area ${siteAreaId}`);
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
          const childKey = await mergeChild({
            parentKey,
            kind: "SiteArea",
            externalId: extId,
            raw
          });
          if (childKey) await drillSiteArea(extId, childKey, depth + 1);
        } else if (cls === "ContentItem") {
          const childKey = await mergeChild({
            parentKey,
            kind: "ContentItem",
            externalId: extId,
            raw: { ...raw, name, type: wcmType }
          });
          if (childKey) await processContent(extId, childKey);
        } else {
          result.warnings.push(`Unclassified child under site area ${siteAreaId}: ${extId}`);
        }
      }
      await usesBatcher.flush();
    };

    const rootPaths = this.roots.map((r) => `${r}/libraries/${encodeURIComponent(wcmLibraryId)}/root-items`);
    const rootHit = await this.getFirstJson(rootPaths);
    if (!rootHit) {
      result.ok = false;
      result.errors.push("Could not load library root-items from WCM v2 paths");
      result.requests = this.requests;
      return result;
    }

    for (const raw of extractItems(rootHit.data)) {
      if (nodes >= maxNodes) break;
      const extId = extractItemId(raw);
      if (!extId) continue;
      const cls = classifyItem(raw);
      const name = firstString(raw.name, raw.title, raw.displayName, raw.label) || extId;
      const wcmType = firstString(raw.type, raw.elementType, raw.category) || cls;

      if (cls === "SiteArea") {
        const childKey = await mergeChild({ parentKey: libKey, kind: "SiteArea", externalId: extId, raw });
        if (childKey) await drillSiteArea(extId, childKey, 1);
      } else if (cls === "ContentItem") {
        const childKey = await mergeChild({
          parentKey: libKey,
          kind: "ContentItem",
          externalId: extId,
          raw: { ...raw, name, type: wcmType }
        });
        if (childKey) await processContent(extId, childKey);
      }
    }
    await usesBatcher.flush();

    result.requests = this.requests;
    return result;
  }
}

/** Components under this WCM library ingest scope with no incoming USES_COMPONENT. */
export async function getOrphanedComponents(wcmLibraryId: string): Promise<Array<Record<string, string>>> {
  const raw = await graphQuery(cypherGetOrphanedComponents(wcmLibraryId));
  return parseCompactGraphRows(raw);
}

/** Longest HAS_CHILD chain depth under the ingest library root. */
export async function getDeepestPath(wcmLibraryId: string): Promise<{ depth: number } | null> {
  const libKey = ingestLibraryKey(wcmLibraryId);
  const raw = await graphQuery(cypherGetDeepestPath(libKey));
  const rows = parseCompactGraphRows(raw);
  const d = Number(rows[0]?.depth ?? rows[0]?.column0);
  if (!Number.isFinite(d)) return null;
  return { depth: d };
}

/** Count ContentItems per ContentTemplate (BASED_ON). */
export async function getTemplateUsage(wcmLibraryId: string): Promise<Array<Record<string, string>>> {
  const raw = await graphQuery(cypherGetTemplateUsage(wcmLibraryId));
  return parseCompactGraphRows(raw);
}
