import "../_load-env";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { XMLParser } from "fast-xml-parser";
import { createGraphSidecar } from "../graph/sidecar";
import { initFolderCrawlCursor, runFolderCrawlStep } from "./folderCrawl";
import type { FolderCrawlCursor } from "./folderCrawl";
import { clampBodyText, fetchDx, resolveOriginFromBaseUrl } from "./wcmFetch";
import { extractListItemsFromPayload, fetchWcmJsonCollectionAllPages, urlLooksWcmCollection } from "./wcmPagedFetch";
import { resolveScanWcmLibraryId, type ScanLibraryRow } from "./folderCrawl";

type Library = {
  id: number;
  name: string;
  base_url: string;
  username: string;
  password_secret_ref: string;
};

type ScanJob = {
  id: number;
  library_id: number;
  state: string;
  cursor: Record<string, unknown>;
};

/** Per–presentation-template enrich: template UUID and/or WCM item id for GET …/items/{id}. */
type PtEnrichTarget = { uuid?: string; itemId?: string };

/** Per–content-item enrich: stable `wcm_id` row plus API item id for GET …/items/{id}. */
type ContentEnrichTarget = { wcmId: string; itemId: string };

type ScanCursor = {
  phase: "crawl" | "folder_crawl" | "enrich_pt" | "enrich_content" | "done";
  targets: string[];
  index: number;
  fetched: number;
  adapters: {
    contentTypeJson: number;
    contentTypeXml: number;
    fallbackHtml: number;
  };
  scannedAt?: string;
  /** PT enrich queue: template UUID and/or WCM item id (GET …/items/{id}). */
  enrichPtTargets?: PtEnrichTarget[];
  /** @deprecated derived from enrichPtTargets for older cursors */
  enrichPtUuids?: string[];
  enrichIndex?: number;
  /** WCM folder hierarchy crawl (after REST crawl, before PT enrich). */
  folder?: FolderCrawlCursor;
  /** Folders processed in folder_crawl (for progress). */
  folderStepsDone?: number;
  /** Cumulative list rows merged from paginated WCM GETs (for progress vs ~50/page caps). */
  crawlPagedRowsTotal?: number;
  /** Latest server metadata totalItems-style hint seen during crawl. */
  crawlTotalItemsHint?: number;
  /** Resolved WCM REST library id cached across chunked scan calls. */
  wcmLibraryIdScope?: string;
  /** Aggregated rows merged per collection path (e.g. /contents, /component/rich-texts). */
  endpointItemCounts?: Record<string, number>;
  /** Hint for progress bar: capped count of Content rows to enrich (loaded during PT handoff). */
  contentEnrichTotalHint?: number;
  /** Queue of folder-crawl Content elements: WCM item id is parsed from `content-{id}`. */
  enrichContentTargets?: ContentEnrichTarget[];
  enrichContentIndex?: number;
  /** Enrich pipeline diagnostics to explain missing PT->component links. */
  enrichDiagnostics?: {
    ptTargetsTotal: number;
    ptTargetsWithLocator: number;
    itemFetchAttempts: number;
    itemFetchSuccess: number;
    itemPayloadsWithElements: number;
    refsExtracted: number;
    linkWrites: number;
    contentTargetsTotal?: number;
    contentRefsExtracted?: number;
    contentLinkWrites?: number;
  };
};

/**
 * WCM artifact kinds we persist. Naming aligns with HCL Core Hierarchy Components where applicable:
 * - Workspace: authenticated session / portal context (not a REST collection; see wcmFetch.fetchDx + credentials).
 * - DocumentLibrary: REST `libraries` — our type `Library` in DB and element type here.
 * - SiteArea, Content, Component: same as HCL terminology.
 * - AT / PT: authoring and presentation templates (structure around hierarchical content).
 */
type WcmElementType = "Component" | "AT" | "PT" | "SiteArea" | "Content" | "Library" | "Folder";

type ParsedElement = {
  wcmId: string;
  name: string;
  type: WcmElementType;
  rawMarkup?: string;
  /** Component names from WCM JSON arrays/fields (not only [Component] markup). */
  structuralRefs?: string[];
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true
});
const graphSidecar = createGraphSidecar();

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

const MAX_OBJECTS_PER_PAYLOAD = envInt("SCAN_MAX_OBJECTS_PER_PAYLOAD", 4000);
const MAX_ELEMENTS_PER_PAYLOAD = envInt("SCAN_MAX_ELEMENTS_PER_PAYLOAD", 1200);
const MAX_MARKUP_BYTES = envInt("SCAN_MAX_MARKUP_BYTES", 16_000);
/** Escaped component names in large PT JSON (detail + list payloads). */
const PT_JSON_REF_PROBE_BYTES = envInt("SCAN_PT_JSON_REF_PROBE_BYTES", 262_144);
const MAX_CONTENT_ENRICH_TARGETS = envInt("SCAN_MAX_CONTENT_ENRICH_TARGETS", 1500);
/** How many content items to process in one HTTP request once phase is enrich_content (WCM item GET + references each). */
const CONTENT_ENRICH_PER_CHUNK = envInt("SCAN_CONTENT_ENRICH_PER_CHUNK", 20);

function nodeKey(libraryId: number, wcmId: string): string {
  return `library:${libraryId}:${wcmId}`;
}

function getSql() {
  const db = process.env.DATABASE_URL;
  if (!db) throw new Error("DATABASE_URL is not configured");
  return neon(db);
}

function parseSecret(ref: string): { password: string; cookie: string } {
  if (!ref) return { password: "", cookie: "" };
  if (ref.startsWith("inline:")) {
    try {
      return { password: Buffer.from(ref.slice("inline:".length), "base64").toString("utf8"), cookie: "" };
    } catch {
      return { password: "", cookie: "" };
    }
  }
  if (ref.startsWith("cookie:")) {
    try {
      return { password: "", cookie: Buffer.from(ref.slice("cookie:".length), "base64").toString("utf8") };
    } catch {
      return { password: "", cookie: "" };
    }
  }
  return { password: "", cookie: "" };
}

function mkId(seed: string): string {
  return createHash("sha1").update(seed).digest("hex").slice(0, 24);
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return (m?.[1] || "Untitled").replace(/\s+/g, " ").trim().slice(0, 240);
}

function titleCase(v: string): string {
  return v
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeWcmType(input: string): WcmElementType | null {
  const t = input.toLowerCase();
  if (t === "library") return "Library";
  if (t.includes("folder")) return "Folder";
  if (t.includes("presentation")) return "PT";
  if (t.includes("authoring")) return "AT";
  if (t.includes("sitearea") || t.includes("site area")) return "SiteArea";
  if (t.includes("content")) return "Content";
  if (t.includes("component")) return "Component";
  return null;
}

const PT_UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function extractPtRestUuid(wcmId: string): string | null {
  const m = wcmId.match(PT_UUID_RE);
  return m?.[0]?.toLowerCase() || null;
}

/**
 * List responses often omit template markup but include HATEOAS links to
 * .../presentation-templates/{uuid}. Capturing that UUID enables enrich_pt detail GETs.
 */
function extractPtUuidFromWcmLinks(o: Record<string, unknown>): string | null {
  const candidates: unknown[] = [];
  if (Array.isArray(o.links)) candidates.push(...o.links);
  if (Array.isArray(o.link)) candidates.push(...o.link);
  else if (o.link && typeof o.link === "object") candidates.push(o.link);
  for (const L of candidates) {
    if (!L || typeof L !== "object" || Array.isArray(L)) continue;
    const href = (L as Record<string, unknown>).href;
    if (typeof href !== "string" || !href.trim()) continue;
    const h = href.toLowerCase();
    if (
      !h.includes("presentation-template") &&
      !h.includes("presentationtemplates") &&
      !h.includes("presentation_templates") &&
      !(h.includes("presentation") && h.includes("template"))
    ) {
      continue;
    }
    const m = href.match(PT_UUID_RE);
    if (m?.[0]) return m[0].toLowerCase();
  }
  for (const key of ["self", "url", "uri", "href"] as const) {
    const v = o[key];
    if (typeof v !== "string" || !v.includes("presentation")) continue;
    const m = v.match(PT_UUID_RE);
    if (m?.[0]) return m[0].toLowerCase();
  }
  return null;
}

function extractItemIdFromHref(href: string): string | null {
  const m = href.trim().match(/\/items\/([^/?#]+)/i);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function toAbsoluteWcmUrl(baseUrl: string, href: string): string {
  const h = href.trim();
  if (!h) return "";
  if (/^https?:\/\//i.test(h)) return h;
  const origin = resolveOriginFromBaseUrl(baseUrl);
  try {
    return new URL(h.startsWith("/") ? h : `/${h}`, `${origin}/`).toString();
  } catch {
    return `${origin}${h.startsWith("/") ? "" : "/"}${h}`;
  }
}

/** WCM often exposes `links: { edit: { href }, self: { href } }` (not an array). */
function appendLinksObjectEditSelf(out: string[], links: unknown): void {
  if (!links || typeof links !== "object" || Array.isArray(links)) return;
  const L = links as Record<string, unknown>;
  for (const key of ["edit", "self", "alternate"] as const) {
    const entry = L[key];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const h = (entry as Record<string, unknown>).href;
      if (typeof h === "string" && h.trim()) out.push(h.trim());
    }
  }
}

/** Collect hrefs from HATEOAS link objects whose rel hints match (substring). */
function gatherHateoasHrefsFromPayload(payload: unknown, relSubstrings: string[]): string[] {
  const out: string[] = [];
  const wantsNamedRel = relSubstrings.some(
    (s) =>
      s.toLowerCase() === "edit" ||
      s.toLowerCase() === "self" ||
      s.toLowerCase() === "alternate" ||
      s.toLowerCase().includes("edit") ||
      s.toLowerCase().includes("self")
  );
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) visit(x);
      return;
    }
    const o = node as Record<string, unknown>;
    if (wantsNamedRel) appendLinksObjectEditSelf(out, o.links);
    const rel = String(o.rel || "").toLowerCase();
    const href = typeof o.href === "string" ? o.href.trim() : "";
    if (href && relSubstrings.some((s) => rel.includes(s.toLowerCase()))) out.push(href);
    if (Array.isArray(o.links)) for (const x of o.links) visit(x);
    if (Array.isArray(o.link)) for (const x of o.link) visit(x);
    else if (o.link && typeof o.link === "object") visit(o.link);
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(payload);
  return [...new Set(out)];
}

function extractItemIdFromHateoasPayload(payload: unknown): string | null {
  for (const href of gatherHateoasHrefsFromPayload(payload, ["edit", "self", "alternate"])) {
    const id = extractItemIdFromHref(href);
    if (id) return id;
  }
  return null;
}

function extractFirstTemplateUuidFromTree(payload: unknown): string | null {
  const objs: Array<Record<string, unknown>> = [];
  collectObjects(payload, objs);
  for (const o of objs) {
    const u = extractPtUuidFromWcmLinks(o);
    if (u) return u;
    for (const fld of [o.uuid, o.id, o.resourceId, o.documentId]) {
      if (typeof fld === "string") {
        const u2 = extractPtRestUuid(fld);
        if (u2) return u2;
      }
    }
  }
  return null;
}

/** Prefer top-level `elements`; otherwise first nested `elements` property (WCM item JSON). */
function extractElementsSubtree(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.elements !== undefined) return root.elements;
  const seen = new WeakSet<object>();
  const walk = (n: unknown): unknown => {
    if (!n || typeof n !== "object") return null;
    if (seen.has(n as object)) return null;
    seen.add(n as object);
    if (Array.isArray(n)) {
      for (const x of n) {
        const f = walk(x);
        if (f !== undefined && f !== null) return f;
      }
      return null;
    }
    const o = n as Record<string, unknown>;
    if (o.elements !== undefined) return o.elements;
    for (const v of Object.values(o)) {
      const f = walk(v);
      if (f !== undefined && f !== null) return f;
    }
    return null;
  };
  return walk(payload);
}

/** Normalize `elements` to an array (array, object map, or single node). */
function normalizeElementsArray(elements: unknown): unknown[] {
  if (elements === undefined || elements === null) return [];
  if (Array.isArray(elements)) return elements;
  if (typeof elements === "object") {
    const o = elements as Record<string, unknown>;
    const numericKeys = Object.keys(o).filter((k) => /^\d+$/.test(k));
    if (numericKeys.length > 0) {
      return numericKeys
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => o[k])
        .filter((x) => x !== undefined);
    }
    return [elements];
  }
  return [];
}

const ELEMENT_STRING_SCAN_MAX_DEPTH = 28;
const ELEMENT_CANDIDATE_STRING_MAX = 480;

/** Walk one template element (and nested objects): strings from data.value and all plausible fields. */
function collectStringsFromElementNode(node: unknown, out: Set<string>, depth: number): void {
  if (depth > ELEMENT_STRING_SCAN_MAX_DEPTH) return;
  if (typeof node === "string") {
    const t = node.trim();
    if (t.length > 1 && t.length <= ELEMENT_CANDIDATE_STRING_MAX) out.add(t);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) collectStringsFromElementNode(x, out, depth + 1);
    return;
  }
  const o = node as Record<string, unknown>;
  const data = o.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const dv = (data as Record<string, unknown>).value;
    if (typeof dv === "string") collectStringsFromElementNode(dv, out, depth + 1);
    for (const v of Object.values(data as Record<string, unknown>)) {
      if (typeof v === "string") collectStringsFromElementNode(v, out, depth + 1);
    }
  }
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string") {
      if (
        k === "value" ||
        k === "name" ||
        k === "id" ||
        k === "path" ||
        k === "title" ||
        k === "html" ||
        k === "markup" ||
        k === "content" ||
        k === "text" ||
        k.endsWith("Name") ||
        k.endsWith("Id") ||
        k.endsWith("Path")
      ) {
        collectStringsFromElementNode(v, out, depth + 1);
      }
    } else if (v && typeof v === "object") {
      collectStringsFromElementNode(v, out, depth + 1);
    }
  }
}

/** Full pass: every entry in `elements` + stringify + broad attribute regex. */
function collectRefsFromElementsDeep(elements: unknown): string[] {
  const refs = new Set<string>();
  const arr = normalizeElementsArray(elements);
  for (const el of arr) {
    collectStringsFromElementNode(el, refs, 0);
    const json = JSON.stringify(el).slice(0, PT_JSON_REF_PROBE_BYTES);
    for (const r of findComponentRefs(json)) refs.add(r);
    for (const r of findEverythingAttributeRefs(json)) refs.add(r);
  }
  const blob = JSON.stringify(elements).slice(0, PT_JSON_REF_PROBE_BYTES);
  for (const r of findComponentRefs(blob)) refs.add(r);
  for (const r of findEverythingAttributeRefs(blob)) refs.add(r);
  return [...refs];
}

/** Broad pass over markup-like and JSON text: name= / id= / path= quoted values. */
function findEverythingAttributeRefs(text: string): string[] {
  const refs = new Set<string>();
  const re = /(?:name|id|path)\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = (m[1] || "").trim();
    if (v.length > 0 && v.length <= ELEMENT_CANDIDATE_STRING_MAX) refs.add(v);
  }
  return [...refs];
}

function isLikelyNoiseRefToken(s: string): boolean {
  const t = s.trim();
  if (t.length < 2) return true;
  if (/^(true|false|null|undefined|on|off|yes|no|\d{1,3})$/i.test(t)) return true;
  return false;
}

function mergePtEnrichTargets(rows: PtEnrichTarget[]): PtEnrichTarget[] {
  const byKey = new Map<string, PtEnrichTarget>();
  for (const r of rows) {
    const u = (r.uuid || "").trim().toLowerCase();
    const i = (r.itemId || "").trim();
    const key = u ? `u:${u}` : i ? `i:${i}` : "";
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { uuid: r.uuid?.trim() || undefined, itemId: i || undefined });
      continue;
    }
    byKey.set(key, {
      uuid: (prev.uuid || r.uuid || "").trim() || undefined,
      itemId: (prev.itemId || r.itemId || "").trim() || undefined
    });
  }
  return [...byKey.values()];
}

function migrateCursorToEnrichTargets(c: Partial<ScanCursor>): PtEnrichTarget[] {
  const raw = c.enrichPtTargets;
  if (Array.isArray(raw) && raw.length > 0) {
    return mergePtEnrichTargets(
      (raw as unknown[]).map((x) =>
        x && typeof x === "object" && !Array.isArray(x)
          ? {
              uuid: typeof (x as PtEnrichTarget).uuid === "string" ? (x as PtEnrichTarget).uuid : undefined,
              itemId: typeof (x as PtEnrichTarget).itemId === "string" ? (x as PtEnrichTarget).itemId : undefined
            }
          : {}
      ) as PtEnrichTarget[]
    );
  }
  if (Array.isArray(c.enrichPtUuids) && c.enrichPtUuids.length > 0) {
    return mergePtEnrichTargets((c.enrichPtUuids as string[]).map((u) => ({ uuid: u })));
  }
  return [];
}

function collectObjects(node: unknown, out: Array<Record<string, unknown>>) {
  if (out.length >= MAX_OBJECTS_PER_PAYLOAD) return;
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

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function tryParseXml(text: string): unknown | null {
  try {
    if (!text.trim().startsWith("<")) return null;
    return xmlParser.parse(text);
  } catch {
    return null;
  }
}

function extractStructuralComponentRefsFromObject(o: Record<string, unknown>): string[] {
  const names = new Set<string>();
  const addName = (s: string) => {
    const t = s.trim();
    if (t && t.length < 200 && !t.includes("\n") && !t.includes("{") && !t.includes("<")) names.add(t);
  };
  const addFromItem = (item: unknown) => {
    if (typeof item === "string") addName(item);
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const r = item as Record<string, unknown>;
    for (const k of ["name", "componentName", "title", "displayName"]) {
      if (typeof r[k] === "string") addName(r[k] as string);
    }
  };
  for (const key of [
    "components",
    "componentReferences",
    "referencedComponents",
    "referencedComponentNames",
    "childComponents",
    "presentationElements",
    "portletDefinitions",
    "elements",
    "referencedPortlets",
    "portlets",
    "portletList",
    "wcmComponents",
    "componentList",
    "slots",
    "slotContent",
    "slotContents"
  ]) {
    const v = o[key];
    if (Array.isArray(v)) for (const x of v) addFromItem(x);
  }
  for (const key of [
    "referencedComponentName",
    "componentName",
    "defaultComponent",
    "portletName",
    "portletTitle",
    "resourceName",
    "templateComponentName",
    "htmlComponentName",
    "friendlyUrl"
  ]) {
    if (typeof o[key] === "string") addName(o[key] as string);
  }
  return [...names];
}

function extractStructuralRefsFromPayload(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const objs: Array<Record<string, unknown>> = [];
  collectObjects(payload, objs);
  const all = new Set<string>();
  for (const o of objs) for (const r of extractStructuralComponentRefsFromObject(o)) all.add(r);
  return [...all];
}

/** Human label for which component catalog we fetched (menus, navigators, Library HTML, etc.). */
function componentCatalogLabelFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const comp = pathname.match(/\/component\/([^/?#]+)/i);
    if (comp?.[1]) return titleCase(comp[1].replace(/-/g, " "));
    const libComp = pathname.match(/\/(Library[A-Za-z]+Component)/i);
    if (libComp?.[1]) return titleCase(libComp[1].replace(/([a-z])([A-Z])/g, "$1 $2"));
  } catch {
    /* ignore */
  }
  return undefined;
}

function firstNonEmptyString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function extractDisplayNameFromWcmLinks(o: Record<string, unknown>): string {
  const candidates: unknown[] = [];
  if (Array.isArray(o.links)) candidates.push(...o.links);
  if (Array.isArray(o.link)) candidates.push(...o.link);
  else if (o.link && typeof o.link === "object") candidates.push(o.link);
  for (const L of candidates) {
    if (!L || typeof L !== "object" || Array.isArray(L)) continue;
    const href = (L as Record<string, unknown>).href;
    if (typeof href !== "string" || !href.trim()) continue;
    try {
      const u = new URL(href);
      const parts = u.pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      if (last) return decodeURIComponent(last.replace(/\+/g, " ")).slice(0, 200);
    } catch {
      const parts = href.split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      if (last) return decodeURIComponent(last.split("?")[0]!.replace(/\+/g, " ")).slice(0, 200);
    }
  }
  return "";
}

function isGenericComponentLabel(s: string): boolean {
  const x = s.trim().toLowerCase();
  return !x || x === "component" || x === "untitled" || x === "unnamed" || x === "null" || x === "n/a";
}

function resolveStructuredElementName(params: {
  o: Record<string, unknown>;
  t: WcmElementType;
  libraryId: number;
  idPart: string;
  rawType: string;
  catalogHint?: string;
}): string {
  const { o, t, libraryId, idPart, rawType, catalogHint } = params;
  let candidate = firstNonEmptyString(
    o.name,
    o.title,
    o.displayName,
    o.libraryTitle,
    o.resourceName,
    o.label,
    o.navigatorTitle,
    o.summary,
    o.path,
    typeof o.identifier === "string" ? o.identifier : undefined
  );

  const desc = typeof o.description === "string" ? o.description.trim() : "";
  if (t === "Component" && isGenericComponentLabel(candidate) && desc && desc.length <= 140) candidate = desc;

  if (t === "Component" && isGenericComponentLabel(candidate)) {
    const fromLink = extractDisplayNameFromWcmLinks(o);
    if (fromLink) candidate = fromLink;
  }

  if (t === "Component" && isGenericComponentLabel(candidate) && catalogHint) {
    const idShort = idPart.replace(/^component-/i, "").slice(0, 10) || mkId(`${libraryId}:${JSON.stringify(o)}`).slice(0, 8);
    candidate = `${catalogHint} · ${idShort}`;
  }

  if (!candidate)
    candidate = `${t} ${idPart || mkId(`${libraryId}:${rawType}:${JSON.stringify(o)}`).slice(0, 10)}`;

  return titleCase(candidate).slice(0, 240);
}

function parseFromStructuredPayload(payload: unknown, libraryId: number, sourceFetchUrl?: string): ParsedElement[] {
  const objs: Array<Record<string, unknown>> = [];
  collectObjects(payload, objs);
  const out: ParsedElement[] = [];
  const catalogHint =
    sourceFetchUrl && /\/component\/|library[a-z]+component/i.test(sourceFetchUrl)
      ? componentCatalogLabelFromUrl(sourceFetchUrl)
      : undefined;

  for (const o of objs) {
    if (out.length >= MAX_ELEMENTS_PER_PAYLOAD) break;
    const rawType =
      (typeof o.type === "string" && o.type) ||
      (typeof o.elementType === "string" && o.elementType) ||
      (typeof o.category === "string" && o.category) ||
      (typeof o.kind === "string" && o.kind) ||
      "";
    const t = normalizeWcmType(rawType);
    if (!t) continue;

    const idRaw =
      (typeof o.id === "string" && o.id) ||
      (typeof o.wcmId === "string" && o.wcmId) ||
      (typeof o.uuid === "string" && o.uuid) ||
      (typeof o.resourceId === "string" && o.resourceId) ||
      (typeof o.documentId === "string" && o.documentId) ||
      "";

    let idPart = idRaw.trim() || mkId(`${libraryId}:${rawType}:${JSON.stringify(o)}`);
    if (t === "PT") {
      const u =
        extractPtRestUuid(idPart) ||
        extractPtRestUuid(`${t.toLowerCase()}-${idPart}`) ||
        extractPtUuidFromWcmLinks(o);
      if (u) idPart = u;
    }
    const wcmId = `${t.toLowerCase()}-${idPart}`;
    const name = resolveStructuredElementName({
      o,
      t,
      libraryId,
      idPart,
      rawType,
      catalogHint: t === "Component" ? catalogHint : undefined
    });
    const markup =
      (typeof o.markup === "string" && o.markup) ||
      (typeof o.templateMarkup === "string" && o.templateMarkup) ||
      (typeof o.html === "string" && o.html) ||
      "";
    const keepMarkup = t === "PT";
    const structuralRefs = t === "PT" ? collectPtComponentRefStrings(o, markup) : undefined;

    out.push({
      wcmId,
      name,
      type: t,
      rawMarkup: keepMarkup && markup ? markup.slice(0, MAX_MARKUP_BYTES) : undefined,
      structuralRefs: structuralRefs?.length ? structuralRefs : undefined
    });
  }

  const dedup = new Map<string, ParsedElement>();
  for (const e of out) {
    const k = `${e.type}:${e.wcmId}`;
    const prev = dedup.get(k);
    if (!prev) {
      dedup.set(k, e);
      continue;
    }
    const mergedRefs = [...new Set([...(prev.structuralRefs || []), ...(e.structuralRefs || [])])];
    const prevMk = prev.rawMarkup?.length || 0;
    const nextMk = e.rawMarkup?.length || 0;
    const rawMarkup = e.rawMarkup && nextMk > prevMk ? e.rawMarkup : prev.rawMarkup;
    const pickName =
      prev.type === "Component" || e.type === "Component"
        ? isGenericComponentLabel(prev.name) && !isGenericComponentLabel(e.name)
          ? e.name
          : isGenericComponentLabel(e.name) && !isGenericComponentLabel(prev.name)
            ? prev.name
            : e.name.length > prev.name.length
              ? e.name
              : prev.name
        : e.name.length > prev.name.length
          ? e.name
          : prev.name;
    dedup.set(k, {
      ...prev,
      name: pickName,
      rawMarkup,
      structuralRefs: mergedRefs.length ? mergedRefs : prev.structuralRefs
    });
  }
  return [...dedup.values()];
}

/**
 * PT list/detail payloads: structural keys + markup regexes + full JSON string probe
 * (catches escaped componentName / portlet strings the tree walk can miss on deep paths).
 */
function collectPtComponentRefStrings(ptRoot: unknown, markup: string): string[] {
  const fromMarkup = findComponentRefs(markup);
  if (!ptRoot || typeof ptRoot !== "object") return [...new Set(fromMarkup)];
  const probeJson = JSON.stringify(ptRoot).slice(0, PT_JSON_REF_PROBE_BYTES);
  const probe = findComponentRefs(probeJson);
  const probeAttr = findEverythingAttributeRefs(probeJson);
  return [
    ...new Set([
      ...extractStructuralRefsFromPayload(ptRoot),
      ...fromMarkup,
      ...probe,
      ...probeAttr
    ])
  ];
}

function findComponentRefs(markup: string): string[] {
  const refs = new Set<string>();
  const patterns = [
    /\[Component\s+name\s*=\s*"([^"]+)"/gi,
    /\[Component\s+name\s*=\s*'([^']+)'/gi,
    /\[Component[^\]]*name="([^"]+)"/gi,
    /\[Component[^\]]*name='([^']+)'/gi,
    /\[Component[^\]]*componentName="([^"]+)"/gi,
    /\[Component[^\]]*componentName='([^']+)'/gi,
    /\[Property[^\]]*context\s*=\s*"current"[^\]]*type\s*=\s*"content"[^\]]*field\s*=\s*"([^"]+)"/gi,
    /\[Property[^\]]*context\s*=\s*'current'[^\]]*type\s*=\s*'content'[^\]]*field\s*=\s*'([^']+)'/gi,
    /\[Plugin:Link[^\]]*name\s*=\s*"([^"]+)"/gi,
    /\[Plugin:Link[^\]]*name\s*=\s*'([^']+)'/gi,
    /\[Plugin:Link[^\]]*uuid\s*=\s*"([^"]+)"/gi,
    /\[Plugin:Link[^\]]*uuid\s*=\s*'([^']+)'/gi,
    /\[Plugin:Link[^\]]*component\s*=\s*"([^"]+)"/gi,
    /\[Plugin:Link[^\]]*component\s*=\s*'([^']+)'/gi,
    /\[Property[^\]]*context="component"[^\]]*name="([^"]+)"/gi,
    /\[Property[^\]]*context='component'[^\]]*name='([^']+)'/gi,
    /"componentName"\s*:\s*"([^"]+)"/gi,
    /'componentName'\s*:\s*'([^']+)'/gi,
    /"portletName"\s*:\s*"([^"]+)"/gi,
    /"resourceName"\s*:\s*"([^"]+)"/gi,
    /componentName\s*=\s*"([^"]+)"/gi,
    /componentName\s*=\s*'([^']+)'/gi,
    /<[^>]{0,80}component[^>]{0,80}name\s*=\s*"([^"]+)"/gi,
    /<[^>]{0,80}component[^>]{0,80}name\s*=\s*'([^']+)'/gi
  ];
  for (const p of patterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(markup))) {
      const v = (m[1] || "").trim();
      if (v) refs.add(v);
    }
  }
  return [...refs];
}

async function upsertElement(params: {
  sql: any;
  libraryId: number;
  libraryName: string;
  wcmId: string;
  name: string;
  type: WcmElementType;
  rawMarkup?: string;
}) {
  const rows = (await params.sql(
    `insert into wcm_elements (library_id, wcm_id, name, type, raw_markup)
     values ($1, $2, $3, $4, $5)
     on conflict (library_id, wcm_id)
     do update set name = excluded.name, type = excluded.type, raw_markup = excluded.raw_markup
     returning id`,
    [params.libraryId, params.wcmId, params.name, params.type, params.rawMarkup || null]
  )) as Array<{ id: number }>;
  if (graphSidecar.enabled) {
    void graphSidecar.upsertNode({
      key: nodeKey(params.libraryId, params.wcmId),
      label: params.type,
      properties: {
        libraryId: params.libraryId,
        libraryName: params.libraryName,
        wcmId: params.wcmId,
        name: params.name
      }
    });
  }
  return rows[0]?.id;
}

async function upsertLink(params: {
  sql: any;
  parentId: number;
  childId: number | null;
  linkType: string;
}) {
  await params.sql(
    `insert into wcm_links (parent_id, child_id, link_type)
     select $1, $2, $3
     where not exists (
       select 1 from wcm_links w
       where w.parent_id = $1 and w.child_id is not distinct from $2 and w.link_type = $3
     )`,
    [params.parentId, params.childId, params.linkType]
  );
}

async function ensureLibraryRootElementId(params: {
  sql: any;
  library: Library;
}): Promise<number | null> {
  const byName = (await params.sql(
    `select id, wcm_id from wcm_elements
     where library_id = $1 and type = 'Library' and lower(trim(name)) = lower(trim($2))
     order by id asc
     limit 1`,
    [params.library.id, params.library.name]
  )) as Array<{ id: number; wcm_id: string }>;
  if (byName[0]?.id) return byName[0].id;

  const anyLib = (await params.sql(
    `select id from wcm_elements
     where library_id = $1 and type = 'Library'
     order by id asc
     limit 1`,
    [params.library.id]
  )) as Array<{ id: number }>;
  if (anyLib[0]?.id) return anyLib[0].id;

  const created = await upsertElement({
    sql: params.sql,
    libraryId: params.library.id,
    libraryName: params.library.name,
    wcmId: `library-${mkId(`${params.library.id}:${params.library.name}`)}`,
    name: params.library.name,
    type: "Library"
  });
  return created ?? null;
}

/**
 * Prefer an existing Component row from REST inventory (name match) so REFERENCES edges attach to
 * the same nodes as the component catalog instead of orphan synthetic cmp-* rows.
 */
async function resolveOrCreateComponentForRef(params: {
  sql: any;
  library: Library;
  ref: string;
}): Promise<{ id: number; wcmId: string; elementCreated: boolean } | null> {
  const refTrim = params.ref.trim().replace(/\s+/g, " ");
  if (!refTrim) return null;

  const uuidHit = refTrim.match(PT_UUID_RE);
  if (uuidHit?.[0]) {
    const u = uuidHit[0].toLowerCase();
    const byUuid = (await params.sql(
      `select id, wcm_id from wcm_elements
       where library_id = $1 and type = 'Component'
         and (
           lower(trim(wcm_id)) = lower($2)
           or lower(trim(wcm_id)) = lower('component-' || $2)
           or strpos(lower(wcm_id), lower($2)) > 0
         )
       order by length(wcm_id) asc, id asc
       limit 1`,
      [params.library.id, u]
    )) as Array<{ id: number; wcm_id: string }>;
    if (byUuid.length > 0) {
      const row = byUuid[0]!;
      return { id: row.id, wcmId: row.wcm_id, elementCreated: false };
    }
  }

  const existing = (await params.sql(
    `select id, wcm_id from wcm_elements
     where library_id = $1 and type = 'Component'
       and (
         lower(trim(name)) = lower(trim($2))
         or lower(trim(split_part(name, '·', 1))) = lower(trim($2))
         or (
           length(trim($2)) >= 5
           and lower(name) like ('%' || lower(trim($2)) || '%')
         )
       )
     order by
       case
         when lower(trim(name)) = lower(trim($2)) then 0
         when lower(trim(split_part(name, '·', 1))) = lower(trim($2)) then 1
         else 2
       end,
       length(name) desc,
       id asc
     limit 1`,
    [params.library.id, refTrim]
  )) as Array<{ id: number; wcm_id: string }>;

  if (existing.length > 0) {
    const row = existing[0]!;
    return { id: row.id, wcmId: row.wcm_id, elementCreated: false };
  }

  const compWcmId = `cmp-${mkId(`${params.library.id}:${refTrim}`)}`;
  const id = await upsertElement({
    sql: params.sql,
    libraryId: params.library.id,
    libraryName: params.library.name,
    wcmId: compWcmId,
    name: refTrim,
    type: "Component"
  });
  if (!id) return null;
  return { id, wcmId: compWcmId, elementCreated: true };
}

type ComponentCatalogEntry = { id: number; wcmId: string; name: string };

type ComponentCatalogIndex = {
  byNameNorm: Map<string, ComponentCatalogEntry>;
  byIdNorm: Map<string, ComponentCatalogEntry>;
};

/** In-memory index of catalog components by normalized name and id (wcm_id + suffixes + UUIDs). */
async function loadComponentCatalogIndex(sql: any, libraryId: number): Promise<ComponentCatalogIndex> {
  const rows = (await sql(
    `select id, wcm_id, name from wcm_elements where library_id = $1 and type = 'Component'`,
    [libraryId]
  )) as Array<{ id: number; wcm_id: string; name: string }>;

  const byNameNorm = new Map<string, ComponentCatalogEntry>();
  const byIdNorm = new Map<string, ComponentCatalogEntry>();

  const putId = (key: string, entry: ComponentCatalogEntry) => {
    const k = key.trim().toLowerCase();
    if (!k) return;
    if (!byIdNorm.has(k)) byIdNorm.set(k, entry);
  };
  const putName = (key: string, entry: ComponentCatalogEntry) => {
    const k = key.trim().toLowerCase();
    if (!k) return;
    if (!byNameNorm.has(k)) byNameNorm.set(k, entry);
  };

  for (const r of rows) {
    const entry: ComponentCatalogEntry = { id: r.id, wcmId: r.wcm_id, name: r.name };
    const nameNorm = r.name.trim().toLowerCase();
    if (nameNorm) {
      putName(nameNorm, entry);
      const beforeDot = nameNorm.split("·")[0]?.trim();
      if (beforeDot && beforeDot !== nameNorm) putName(beforeDot, entry);
    }

    const wcm = r.wcm_id.trim();
    putId(wcm, entry);

    const stripped = wcm.replace(/^component-/i, "").replace(/^cmp-/i, "");
    if (stripped && stripped.toLowerCase() !== wcm.toLowerCase()) putId(stripped, entry);

    const uuidIn = stripped.match(PT_UUID_RE);
    if (uuidIn?.[0]) putId(uuidIn[0], entry);
  }

  return { byNameNorm, byIdNorm };
}

function resolveRefAgainstCatalog(ref: string, catalog: ComponentCatalogIndex): ComponentCatalogEntry | null {
  const t = ref.trim().replace(/\s+/g, " ");
  if (!t) return null;
  const lower = t.toLowerCase();
  if (catalog.byIdNorm.has(lower)) return catalog.byIdNorm.get(lower)!;
  if (catalog.byNameNorm.has(lower)) return catalog.byNameNorm.get(lower)!;

  const uuidHit = t.match(PT_UUID_RE);
  if (uuidHit?.[0]) {
    const u = uuidHit[0].toLowerCase();
    if (catalog.byIdNorm.has(u)) return catalog.byIdNorm.get(u)!;
  }

  const lastSeg = t.split(/[/\\]/).pop()?.trim().toLowerCase() || "";
  if (lastSeg && lastSeg !== lower) {
    if (catalog.byIdNorm.has(lastSeg)) return catalog.byIdNorm.get(lastSeg)!;
    if (catalog.byNameNorm.has(lastSeg)) return catalog.byNameNorm.get(lastSeg)!;
  }

  return null;
}

async function resolveComponentForEnrichRef(params: {
  sql: any;
  library: Library;
  ref: string;
  catalog: ComponentCatalogIndex;
}): Promise<{ id: number; wcmId: string; elementCreated: boolean } | null> {
  const hit = resolveRefAgainstCatalog(params.ref, params.catalog);
  if (hit) return { id: hit.id, wcmId: hit.wcmId, elementCreated: false };
  return resolveOrCreateComponentForRef({
    sql: params.sql,
    library: params.library,
    ref: params.ref
  });
}

/**
 * Resolve a mined reference token to an existing catalog row: components first, then UUID → PT / Content / AT / SiteArea / Component by `wcm_id` prefix.
 */
async function resolveReferenceTargetForContentEnrich(params: {
  sql: any;
  library: Library;
  ref: string;
  catalog: ComponentCatalogIndex;
  parentElementId: number;
}): Promise<{ id: number; wcmId: string } | null> {
  const comp = await resolveComponentForEnrichRef({
    sql: params.sql,
    library: params.library,
    ref: params.ref,
    catalog: params.catalog
  });
  if (comp && comp.id !== params.parentElementId) {
    return { id: comp.id, wcmId: comp.wcmId };
  }

  const t = params.ref.trim();
  const uuidHit = t.match(PT_UUID_RE);
  const u = uuidHit?.[0]?.toLowerCase();
  if (!u) return null;

  const rows = (await params.sql(
    `select id, wcm_id from wcm_elements
     where library_id = $1
       and id <> $3
       and (
         lower(wcm_id) = lower($2)
         or lower(wcm_id) = lower('pt-' || $2)
         or lower(wcm_id) = lower('content-' || $2)
         or lower(wcm_id) = lower('component-' || $2)
         or lower(wcm_id) = lower('at-' || $2)
         or lower(wcm_id) = lower('sitearea-' || $2)
       )
     order by id asc
     limit 1`,
    [params.library.id, u, params.parentElementId]
  )) as Array<{ id: number; wcm_id: string }>;
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, wcmId: row.wcm_id };
}

function parseContentItemIdFromWcmId(wcmId: string): string | null {
  const w = wcmId.trim();
  const m = /^content-(.+)$/i.exec(w);
  const id = m?.[1]?.trim();
  return id || null;
}

async function countContentElementsForEnrich(sql: any, libraryId: number): Promise<number> {
  const rows = (await sql(
    `select count(*)::int as c from wcm_elements where library_id = $1 and type = 'Content'`,
    [libraryId]
  )) as Array<{ c: number }>;
  const c = rows[0]?.c ?? 0;
  return Math.min(Math.max(0, c), MAX_CONTENT_ENRICH_TARGETS);
}

async function loadContentEnrichTargetsFromDb(sql: any, libraryId: number): Promise<ContentEnrichTarget[]> {
  const rows = (await sql(
    `select wcm_id from wcm_elements where library_id = $1 and type = 'Content' order by id asc limit $2`,
    [libraryId, MAX_CONTENT_ENRICH_TARGETS]
  )) as Array<{ wcm_id: string }>;
  const out: ContentEnrichTarget[] = [];
  for (const r of rows) {
    const itemId = parseContentItemIdFromWcmId(r.wcm_id);
    if (itemId) out.push({ wcmId: r.wcm_id, itemId });
  }
  return out;
}

function extractContentItemUuid(payload: unknown, itemId: string): string | null {
  const fromId = extractPtRestUuid(itemId);
  if (fromId) return fromId;
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  for (const k of ["uuid", "documentId", "resourceId"] as const) {
    const v = o[k];
    if (typeof v === "string") {
      const u = extractPtRestUuid(v);
      if (u) return u;
    }
  }
  const idv = o.id;
  if (typeof idv === "string") {
    const u = extractPtRestUuid(idv);
    if (u) return u;
  }
  return null;
}

async function enrichContentItemReferences(params: {
  sql: any;
  library: Library;
  headers: Record<string, string>;
  target: ContentEnrichTarget;
}): Promise<{
  linksCreated: number;
  diagnostics: { refsExtracted: number; linkWrites: number };
}> {
  const { sql, library, headers, target } = params;
  const parentRows = (await sql(`select id from wcm_elements where library_id = $1 and wcm_id = $2`, [
    library.id,
    target.wcmId
  ])) as Array<{ id: number }>;
  const parentId = parentRows[0]?.id;
  if (!parentId) {
    return { linksCreated: 0, diagnostics: { refsExtracted: 0, linkWrites: 0 } };
  }

  const catalog = await loadComponentCatalogIndex(sql, library.id);
  const payloads: unknown[] = [];

  const hit = await fetchWcmItemById(library, target.itemId, headers);
  if (hit?.text.trim()) {
    const ct = (hit.contentType || "").toLowerCase();
    const parsed =
      ct.includes("json") ? tryParseJson(hit.text) : tryParseJson(hit.text) || tryParseXml(hit.text);
    if (parsed) {
      payloads.push(parsed);
      const linked = await fetchLinkedDocumentsFromHateoas(library.base_url, headers, parsed, 2);
      payloads.push(...linked);
    }
  }

  const markupParts: string[] = [];
  for (const p of payloads) {
    const m = extractPtDetailMarkup(p);
    if (m) markupParts.push(m);
  }
  const markup = markupParts.join("\n").slice(0, MAX_MARKUP_BYTES);

  const refs = new Set<string>();
  for (const p of payloads) {
    for (const r of collectPtComponentRefStrings(p, markup)) refs.add(r);
    const payloadJson = JSON.stringify(p).slice(0, PT_JSON_REF_PROBE_BYTES);
    for (const r of findEverythingAttributeRefs(payloadJson)) refs.add(r);
  }
  for (const p of payloads) {
    const el = extractElementsSubtree(p);
    if (el !== undefined && el !== null) {
      for (const r of collectRefsFromElementsDeep(el)) refs.add(r);
    }
  }

  let uuid: string | null = null;
  for (const p of payloads) {
    uuid = extractContentItemUuid(p, target.itemId);
    if (uuid) break;
  }
  if (!uuid) uuid = extractPtRestUuid(target.itemId);
  if (uuid) {
    const refUuids = await fetchReferenceUuids(library.base_url, headers, uuid);
    for (const u of refUuids) refs.add(u);
  }

  const parentWcmRows = (await sql(`select wcm_id from wcm_elements where id = $1`, [parentId])) as Array<{
    wcm_id: string;
  }>;
  const parentWcmId = parentWcmRows[0]?.wcm_id || target.wcmId;

  let linksCreated = 0;
  for (const ref of refs) {
    if (isLikelyNoiseRefToken(ref)) continue;
    const resolved = await resolveReferenceTargetForContentEnrich({
      sql,
      library,
      ref,
      catalog,
      parentElementId: parentId
    });
    if (!resolved) continue;
    await upsertLink({ sql, parentId, childId: resolved.id, linkType: "REFERENCES" });
    if (graphSidecar.enabled) {
      void graphSidecar.upsertEdge({
        from: nodeKey(library.id, parentWcmId),
        to: nodeKey(library.id, resolved.wcmId),
        type: "REFERENCES",
        properties: { libraryId: library.id, libraryName: library.name }
      });
    }
    linksCreated += 1;
  }

  return {
    linksCreated,
    diagnostics: { refsExtracted: refs.size, linkWrites: linksCreated }
  };
}

function extractPtDetailMarkup(payload: unknown): string {
  let best = "";
  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    const o = node as Record<string, unknown>;
    for (const key of ["markup", "templateMarkup", "html", "template", "presentationHtml", "content"]) {
      const v = o[key];
      if (typeof v === "string" && v.length > best.length) best = v;
    }
    for (const v of Object.values(o)) walk(v);
  }
  walk(payload);
  return best.slice(0, MAX_MARKUP_BYTES);
}

function extractPtDetailName(payload: unknown): string {
  let best = "";
  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    const o = node as Record<string, unknown>;
    for (const key of ["name", "title", "displayName"]) {
      const v = o[key];
      if (typeof v === "string" && v.trim() && v.length > best.length) best = v.trim();
    }
    for (const v of Object.values(o)) walk(v);
  }
  walk(payload);
  return titleCase(best).slice(0, 240);
}

const MAX_DISCOVER_PT_TARGETS = 250;

function ptListRowHasPresentationSignal(o: Record<string, unknown>): boolean {
  const typeStr = String(o.type || o.elementType || o.category || "").toLowerCase();
  if (typeStr.includes("presentation")) return true;
  if (extractPtUuidFromWcmLinks(o)) return true;
  const hrefs = gatherHateoasHrefsFromPayload(o, ["edit", "self", "alternate"]);
  return hrefs.some((h) =>
    /presentation-template|presentationtemplates|presentation_templates/i.test(h)
  );
}

function ptDescriptorFromListObject(o: Record<string, unknown>): PtEnrichTarget | null {
  if (!ptListRowHasPresentationSignal(o)) return null;

  let uuid = extractPtUuidFromWcmLinks(o);
  if (!uuid) {
    for (const fld of [o.uuid, o.id, o.resourceId, o.documentId]) {
      if (typeof fld === "string") {
        const u = extractPtRestUuid(fld);
        if (u) {
          uuid = u;
          break;
        }
      }
    }
  }

  let itemId: string | null = null;
  for (const href of gatherHateoasHrefsFromPayload(o, ["edit", "self", "alternate"])) {
    const id = extractItemIdFromHref(href);
    if (id) {
      itemId = id;
      break;
    }
  }

  const rawId = typeof o.id === "string" ? o.id.trim() : "";
  if (rawId && !rawId.includes("/") && !extractPtRestUuid(rawId) && /^[a-zA-Z0-9_.-]+$/.test(rawId)) {
    itemId = itemId || rawId;
  }

  if (!uuid && !itemId) return null;
  return { uuid: uuid ? uuid.toLowerCase() : undefined, itemId: itemId || undefined };
}

async function loadPtTargetsFromDb(sql: any, libraryId: number): Promise<PtEnrichTarget[]> {
  const rows = (await sql(`select wcm_id from wcm_elements where library_id = $1 and type = 'PT'`, [libraryId])) as Array<{
    wcm_id: string;
  }>;
  const out: PtEnrichTarget[] = [];
  for (const r of rows) {
    const w = r.wcm_id;
    const uuid = extractPtRestUuid(w);
    const m = w.match(/^pt-item-(.+)$/i);
    let itemFromWcm: string | null = null;
    if (m?.[1]) {
      try {
        itemFromWcm = decodeURIComponent(m[1]);
      } catch {
        itemFromWcm = m[1];
      }
    }
    out.push({
      uuid: uuid || undefined,
      itemId: itemFromWcm || undefined
    });
  }
  return mergePtEnrichTargets(out);
}

/**
 * Presentation-templates list → { uuid, itemId } rows (HATEOAS edit/self → …/items/{id}).
 */
async function discoverPresentationTemplateDescriptorsFromApi(
  library: Library,
  headers: Record<string, string>
): Promise<PtEnrichTarget[]> {
  const origin = resolveOriginFromBaseUrl(library.base_url);
  const bases = wcmApiBases(origin);
  const paths = ["/presentation-templates", "/presentation-templates/", "/PresentationTemplate"];
  const found: PtEnrichTarget[] = [];
  for (const b of bases) {
    for (const p of paths) {
      const url = `${b}${p}`;
      const hit = await fetchWcmJsonCollectionAllPages({
        seedUrl: url,
        headers,
        logLabel: `presentation-templates ${p}`
      });
      if (!hit) continue;
      const objs: Array<Record<string, unknown>> = [];
      collectObjects(hit.mergedPayload, objs);
      for (const o of objs) {
        const d = ptDescriptorFromListObject(o);
        if (d) {
          found.push(d);
          if (found.length >= MAX_DISCOVER_PT_TARGETS) return mergePtEnrichTargets(found);
        }
      }
    }
  }
  return mergePtEnrichTargets(found);
}

function pushUuidFromValue(value: unknown, out: Set<string>): void {
  if (typeof value !== "string") return;
  const matches = value.match(new RegExp(PT_UUID_RE.source, "ig")) || [];
  for (const m of matches) out.add(m.toLowerCase());
}

function extractPtTargetsFromRows(rows: Record<string, unknown>[]): PtEnrichTarget[] {
  const uuids = new Set<string>();
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      const key = k.toLowerCase();
      if (
        key.includes("template") ||
        key.includes("presentation") ||
        key.includes("authoring") ||
        key.endsWith("id") ||
        key.endsWith("ids")
      ) {
        pushUuidFromValue(v, uuids);
      }
    }

    const links: unknown[] = [];
    if (Array.isArray(row.links)) links.push(...row.links);
    if (Array.isArray(row.link)) links.push(...row.link);
    if (row.link && typeof row.link === "object" && !Array.isArray(row.link)) links.push(row.link);
    for (const l of links) {
      if (!l || typeof l !== "object" || Array.isArray(l)) continue;
      const href = (l as Record<string, unknown>).href;
      const rel = String((l as Record<string, unknown>).rel || "").toLowerCase();
      if (typeof href === "string" && (rel.includes("presentation") || href.toLowerCase().includes("presentation"))) {
        pushUuidFromValue(href, uuids);
      }
    }
  }
  return [...uuids].map((u) => ({ uuid: u }));
}

async function discoverPtTargetsFromContentAndSiteAreas(
  library: Library,
  headers: Record<string, string>
): Promise<PtEnrichTarget[]> {
  const row: ScanLibraryRow = {
    id: library.id,
    name: library.name,
    base_url: library.base_url,
    username: library.username,
    password_secret_ref: library.password_secret_ref
  };
  const wcmLibraryId = await resolveScanWcmLibraryId(row, headers);
  const origin = resolveOriginFromBaseUrl(library.base_url);
  const seeds = wcmApiBases(origin).flatMap((b) => [`${b}/contents`, `${b}/site-areas`]);
  const found: PtEnrichTarget[] = [];
  for (const seed of seeds) {
    const hit = await fetchWcmJsonCollectionAllPages({
      seedUrl: seed,
      headers,
      wcmLibraryId: wcmLibraryId || undefined,
      logLabel: `pt-target-fallback ${seed.split("/").slice(-1)[0]}`
    });
    if (!hit) continue;
    const rows = extractListItemsFromPayload(hit.mergedPayload);
    found.push(...extractPtTargetsFromRows(rows));
    if (found.length >= MAX_DISCOVER_PT_TARGETS) break;
  }
  return mergePtEnrichTargets(found);
}

async function loadEnrichablePtTargetsMerged(
  sql: any,
  library: Library,
  headers: Record<string, string>
): Promise<PtEnrichTarget[]> {
  const fromDb = await loadPtTargetsFromDb(sql, library.id);
  const fromApi = await discoverPresentationTemplateDescriptorsFromApi(library, headers);
  const fromContentFallback = await discoverPtTargetsFromContentAndSiteAreas(library, headers);
  return mergePtEnrichTargets([...fromDb, ...fromApi, ...fromContentFallback]);
}

async function fetchWcmItemById(
  library: Library,
  itemId: string,
  headers: Record<string, string>
): Promise<{ text: string; contentType: string } | null> {
  const origin = resolveOriginFromBaseUrl(library.base_url);
  const enc = encodeURIComponent(itemId);
  const urls = [
    `${origin}/wps/mycontenthandler/wcmrest-v2/items/${enc}`,
    `${origin}/hcl/mycontenthandler/wcmrest-v2/items/${enc}`,
    `${origin}/dx/api/wcm/v2/items/${enc}`
  ];
  for (const url of urls) {
    const response = await fetchDx(url, headers);
    const raw = await response.text();
    if (response.ok && raw.trim()) {
      return { text: clampBodyText(raw), contentType: response.headers.get("content-type") || "" };
    }
  }
  return null;
}

function sortHrefsEditBeforeSelf(hrefs: string[]): string[] {
  const rank = (h: string) => (/\/edit(?:\?|$|[/])|[?&]action=edit|[?&]operation=edit/i.test(h) ? 0 : 1);
  return [...hrefs].sort((a, b) => rank(a) - rank(b));
}

async function fetchLinkedDocumentsFromHateoas(
  baseUrl: string,
  headers: Record<string, string>,
  payload: unknown,
  budget: number
): Promise<unknown[]> {
  const out: unknown[] = [];
  const hrefs = sortHrefsEditBeforeSelf(gatherHateoasHrefsFromPayload(payload, ["edit", "self"]));
  let n = 0;
  for (const href of hrefs) {
    if (n >= budget) break;
    const url = toAbsoluteWcmUrl(baseUrl, href);
    if (!url) continue;
    const r = await fetchDx(url, headers);
    const raw = clampBodyText(await r.text());
    if (!r.ok || !raw.trim()) continue;
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    const p = ct.includes("json") ? tryParseJson(raw) : tryParseJson(raw) || tryParseXml(raw);
    if (p) {
      out.push(p);
      n += 1;
    }
  }
  return out;
}

function collectUuidTokensDeep(node: unknown, out: Set<string>): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const x of node) collectUuidTokensDeep(x, out);
    return;
  }
  if (typeof node !== "object") {
    if (typeof node === "string") {
      const m = node.match(new RegExp(PT_UUID_RE.source, "ig")) || [];
      for (const hit of m) out.add(hit.toLowerCase());
    }
    return;
  }
  const o = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    const key = k.toLowerCase();
    if (
      typeof v === "string" &&
      /(uuid|id|target|source|reference|ref|component|content|template)/.test(key)
    ) {
      const m = v.match(new RegExp(PT_UUID_RE.source, "ig")) || [];
      for (const hit of m) out.add(hit.toLowerCase());
    }
    collectUuidTokensDeep(v, out);
  }
}

async function fetchReferenceUuids(
  baseUrl: string,
  headers: Record<string, string>,
  seedUuid: string
): Promise<Set<string>> {
  const origin = resolveOriginFromBaseUrl(baseUrl);
  const enc = encodeURIComponent(seedUuid);
  const urls = [
    `${origin}/wps/mycontenthandler/wcmrest-v2/references?uuid=${enc}&direction=from`,
    `${origin}/wps/mycontenthandler/wcmrest-v2/references?uuid=${enc}&direction=to`,
    `${origin}/hcl/mycontenthandler/wcmrest-v2/references?uuid=${enc}&direction=from`,
    `${origin}/hcl/mycontenthandler/wcmrest-v2/references?uuid=${enc}&direction=to`,
    `${origin}/dx/api/wcm/v2/references?uuid=${enc}&direction=from`,
    `${origin}/dx/api/wcm/v2/references?uuid=${enc}&direction=to`
  ];
  const out = new Set<string>();
  for (const url of urls) {
    try {
      const r = await fetchDx(url, headers);
      const raw = clampBodyText(await r.text());
      if (!r.ok || !raw.trim()) continue;
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      const p = ct.includes("json") ? tryParseJson(raw) : tryParseJson(raw) || tryParseXml(raw);
      if (!p) continue;
      collectUuidTokensDeep(p, out);
    } catch {
      // continue
    }
  }
  out.delete(seedUuid.toLowerCase());
  return out;
}

/**
 * Deep PT enrich: presentation-templates GET, follow edit/self HATEOAS, GET …/items/{id} (dx v2 first),
 * mine `elements` + markup for component refs, write REFERENCES edges.
 */
async function enrichPresentationTemplateDeep(params: {
  sql: any;
  library: Library;
  headers: Record<string, string>;
  target: PtEnrichTarget;
}): Promise<{
  elementsUpserted: number;
  linksCreated: number;
  diagnostics: {
    itemFetchAttempts: number;
    itemFetchSuccess: number;
    itemPayloadsWithElements: number;
    refsExtracted: number;
    linkWrites: number;
  };
}> {
  const { sql, library, headers, target } = params;
  const origin = resolveOriginFromBaseUrl(library.base_url);
  const payloads: unknown[] = [];
  let elementsUpserted = 0;
  let linksCreated = 0;
  let itemFetchAttempts = 0;
  let itemFetchSuccess = 0;
  let itemPayloadsWithElements = 0;

  const catalog = await loadComponentCatalogIndex(sql, library.id);

  const fetchedItemIds = new Set<string>();
  const ingestItemById = async (rawId: string) => {
    const iid = rawId.trim();
    if (!iid || fetchedItemIds.has(iid)) return;
    fetchedItemIds.add(iid);
    itemFetchAttempts += 1;
    const hit = await fetchWcmItemById(library, iid, headers);
    if (!hit?.text.trim()) return;
    itemFetchSuccess += 1;
    const ct = (hit.contentType || "").toLowerCase();
    const parsedItem =
      ct.includes("json") ? tryParseJson(hit.text) : tryParseJson(hit.text) || tryParseXml(hit.text);
    if (!parsedItem) return;
    const elSub = extractElementsSubtree(parsedItem);
    const elArr = normalizeElementsArray(elSub);
    if (elArr.length > 0) itemPayloadsWithElements += 1;
    if (elArr.length === 0) {
      const usingBasic = /^basic\s+/i.test(headers.Authorization || "");
      console.warn(
        "[DX.IQ enrich] `/items/{id}` JSON has no `elements` (or an empty array). " +
          "List views carry no markup; without `elements` no PT→component edges can be mined. " +
          (usingBasic
            ? "Try Cookie/session auth: set `password_secret_ref` to `cookie:` + base64(portal cookies such as JSESSIONID/LTPA) instead of relying on Basic alone."
            : "If this persists, re-export cookies after a full portal login—the API may require the same session as the browser.")
      );
    }
    payloads.push(parsedItem);
    const linked = await fetchLinkedDocumentsFromHateoas(library.base_url, headers, parsedItem, 2);
    payloads.push(...linked);
  };

  if (target.itemId?.trim()) {
    await ingestItemById(target.itemId);
  }

  if (target.uuid) {
    const uuid = target.uuid.toLowerCase();
    const urls = [
      `${origin}/wps/mycontenthandler/wcmrest-v2/presentation-templates/${uuid}`,
      `${origin}/wps/mycontenthandler/wcmrest-v2/presentation-templates/${uuid}?include=elements`,
      `${origin}/wps/mycontenthandler/wcmrest-v2/PresentationTemplate/${uuid}`,
      `${origin}/hcl/mycontenthandler/wcmrest-v2/presentation-templates/${uuid}`,
      `${origin}/hcl/mycontenthandler/wcmrest-v2/presentation-templates/${uuid}?include=elements`,
      `${origin}/hcl/mycontenthandler/wcmrest-v2/PresentationTemplate/${uuid}`,
      `${origin}/dx/api/wcm/v2/presentation-templates/${uuid}`,
      `${origin}/dx/api/wcm/v2/presentation-templates/${uuid}?include=elements`,
      `${origin}/dx/api/wcm/v2/PresentationTemplate/${uuid}`
    ];
    let bodyText = "";
    let contentType = "";
    for (const url of urls) {
      const response = await fetchDx(url, headers);
      const raw = await response.text();
      if (response.ok && raw.trim()) {
        bodyText = clampBodyText(raw);
        contentType = (response.headers.get("content-type") || "").toLowerCase();
        break;
      }
    }
    if (bodyText.trim()) {
      const parsed =
        contentType.includes("json")
          ? tryParseJson(bodyText)
          : contentType.includes("xml")
            ? tryParseXml(bodyText)
            : tryParseJson(bodyText) || tryParseXml(bodyText);
      if (parsed) {
        payloads.push(parsed);
        const linked = await fetchLinkedDocumentsFromHateoas(library.base_url, headers, parsed, 4);
        payloads.push(...linked);
      }
    }
  }

  let resolvedItemId = (target.itemId || "").trim() || null;
  for (const p of payloads) {
    if (!resolvedItemId) resolvedItemId = extractItemIdFromHateoasPayload(p);
  }

  const itemCandidates = [...new Set([resolvedItemId, (target.uuid || "").trim() || null].filter(Boolean))] as string[];

  for (const iid of itemCandidates) {
    await ingestItemById(iid);
  }

  let uuid = (target.uuid || "").trim().toLowerCase() || null;
  for (const p of payloads) {
    if (!uuid) {
      const u = extractFirstTemplateUuidFromTree(p);
      if (u) uuid = u.toLowerCase();
    }
  }
  if (!resolvedItemId) {
    for (const p of payloads) {
      resolvedItemId = extractItemIdFromHateoasPayload(p);
      if (resolvedItemId) break;
    }
  }

  if (!uuid && !resolvedItemId) {
    return {
      elementsUpserted: 0,
      linksCreated: 0,
      diagnostics: {
        itemFetchAttempts,
        itemFetchSuccess,
        itemPayloadsWithElements,
        refsExtracted: 0,
        linkWrites: 0
      }
    };
  }

  const wcmId = uuid ? `pt-${uuid}` : `pt-item-${encodeURIComponent(resolvedItemId!)}`;

  const markups: string[] = [];
  for (const p of payloads) {
    const m = extractPtDetailMarkup(p);
    if (m) markups.push(m);
  }
  const markup = markups.join("\n").slice(0, MAX_MARKUP_BYTES) || "";

  const refs = new Set<string>();
  for (const p of payloads) {
    for (const r of collectPtComponentRefStrings(p, markup)) refs.add(r);
    const payloadJson = JSON.stringify(p).slice(0, PT_JSON_REF_PROBE_BYTES);
    for (const r of findEverythingAttributeRefs(payloadJson)) refs.add(r);
  }
  for (const p of payloads) {
    const el = extractElementsSubtree(p);
    if (el !== undefined && el !== null) {
      for (const r of collectRefsFromElementsDeep(el)) refs.add(r);
    }
  }
  if (uuid) {
    const refUuids = await fetchReferenceUuids(library.base_url, headers, uuid);
    for (const u of refUuids) refs.add(u);
  }

  const parentRows = (await sql(`select id from wcm_elements where library_id = $1 and wcm_id = $2`, [
    library.id,
    wcmId
  ])) as Array<{ id: number }>;

  let parentId = parentRows[0]?.id;

  if (!parentId) {
    const nameSource = payloads[0];
    const name =
      (nameSource ? extractPtDetailName(nameSource) : "") ||
      (uuid ? `Presentation ${uuid.slice(0, 8)}` : `Presentation item ${(resolvedItemId || "").slice(0, 12)}`);
    const id = await upsertElement({
      sql,
      libraryId: library.id,
      libraryName: library.name,
      wcmId,
      name,
      type: "PT",
      rawMarkup: markup || undefined
    });
    if (id) {
      parentId = id;
      elementsUpserted += 1;
    }
  } else if (markup) {
    await sql(`update wcm_elements set raw_markup = $3 where library_id = $1 and wcm_id = $2`, [
      library.id,
      wcmId,
      markup.slice(0, MAX_MARKUP_BYTES)
    ]);
  }

  if (!parentId) {
    return {
      elementsUpserted,
      linksCreated: 0,
      diagnostics: {
        itemFetchAttempts,
        itemFetchSuccess,
        itemPayloadsWithElements,
        refsExtracted: refs.size,
        linkWrites: 0
      }
    };
  }

  for (const ref of refs) {
    if (isLikelyNoiseRefToken(ref)) continue;
    const resolved = await resolveComponentForEnrichRef({ sql, library, ref, catalog });
    if (!resolved) continue;
    if (resolved.elementCreated) elementsUpserted += 1;
    await upsertLink({ sql, parentId, childId: resolved.id, linkType: "REFERENCES" });
    if (graphSidecar.enabled) {
      void graphSidecar.upsertEdge({
        from: nodeKey(library.id, wcmId),
        to: nodeKey(library.id, resolved.wcmId),
        type: "REFERENCES",
        properties: { libraryId: library.id, libraryName: library.name }
      });
    }
    linksCreated += 1;
  }

  return {
    elementsUpserted,
    linksCreated,
    diagnostics: {
      itemFetchAttempts,
      itemFetchSuccess,
      itemPayloadsWithElements,
      refsExtracted: refs.size,
      linkWrites: linksCreated
    }
  };
}

/**
 * REST collection paths for WCM v2, ordered to mirror HCL Core Hierarchy navigation:
 * DocumentLibrary → SiteArea → Content → templates (AT/PT) → Component libraries.
 * Each path is tried under both contenthandler and /dx/api/wcm/v2 bases.
 */
function wcmHierarchyCollectionPaths(): string[] {
  return [
    // DocumentLibrary (top-level container)
    "/libraries",
    // SiteArea (hierarchical folders)
    "/site-areas",
    "/site-areas/",
    // Content (items in the hierarchy)
    "/contents",
    "/contents/analysis",
    // Authoring / presentation templates (used with libraries and site areas)
    "/authoring-templates",
    "/presentation-templates",
    "/presentation-templates/",
    "/PresentationTemplate",
    "/content-templates",
    // Component (reusable menus, navigators, field types, etc.)
    "/component/short-texts",
    "/component/rich-texts",
    "/component/images",
    "/component/menus",
    "/component/navigators",
    "/component/stylesheets",
    "/LibraryAuthoringToolsComponent",
    "/LibraryDateComponent",
    "/LibraryFileComponent",
    "/LibraryHTMLComponent",
    "/LibraryJSPComponent",
    "/LibraryLinkComponent",
    "/LibraryListPresentationComponent",
    "/LibraryNumericComponent",
    "/LibraryPageNavigationComponent"
  ];
}

function wcmApiBases(origin: string): string[] {
  return [`${origin}/wps/mycontenthandler/wcmrest-v2`, `${origin}/hcl/mycontenthandler/wcmrest-v2`, `${origin}/dx/api/wcm/v2`];
}

function buildTargets(baseUrl: string): string[] {
  const b = baseUrl.replace(/\/+$/, "");
  let origin: string;
  try {
    origin = new URL(b).origin;
  } catch {
    origin = b;
  }
  const wcmCollections = wcmHierarchyCollectionPaths();

  // DX 9.5 WCM REST lives under /hcl/mycontenthandler at host origin.
  // We probe both host-root contenthandler and classic dx/api collections.
  const candidates = [
    ...wcmApiBases(origin).flatMap((b) => wcmCollections.map((p) => `${b}${p}`)),
    `${origin}/dx/api/wcm/v2/explorer/`,
    b,
    `${b}/home`,
    `${b}/wps/mycontenthandler`,
    `${b}/wps/contenthandler`
  ];
  return [...new Set(candidates)];
}

function isLibrariesCollectionTarget(url: string): boolean {
  try {
    const u = new URL(url);
    return /\/libraries\/?$/i.test(u.pathname);
  } catch {
    return /\/libraries(?:\?|$)/i.test(url);
  }
}

function endpointProgressKey(url: string): string {
  try {
    const p = new URL(url).pathname.toLowerCase();
    const marker = p.match(/(?:\/wcmrest-v2|\/dx\/api\/wcm\/v2)(\/.*)$/i);
    if (marker?.[1]) return marker[1].replace(/\/+$/, "") || "/";
    return p.replace(/\/+$/, "") || "/";
  } catch {
    return url.split("?")[0] || url;
  }
}

async function beginEnrichContentPhase(sql: any, library: Library, cursor: ScanCursor): Promise<void> {
  const targets = await loadContentEnrichTargetsFromDb(sql, library.id);
  cursor.enrichContentTargets = targets;
  cursor.enrichContentIndex = 0;
  cursor.contentEnrichTotalHint = targets.length;
  if (cursor.enrichDiagnostics) {
    cursor.enrichDiagnostics.contentTargetsTotal = targets.length;
  }
  cursor.phase = targets.length > 0 ? "enrich_content" : "done";
}

async function beginEnrichPtPhase(
  sql: any,
  library: Library,
  headers: Record<string, string>,
  cursor: ScanCursor
): Promise<void> {
  const targets = await loadEnrichablePtTargetsMerged(sql, library, headers);
  cursor.enrichPtTargets = targets;
  cursor.enrichPtUuids = targets.map((t) => t.uuid).filter((u): u is string => Boolean(u));
  cursor.enrichIndex = 0;
  if (!cursor.enrichDiagnostics) {
    cursor.enrichDiagnostics = {
      ptTargetsTotal: 0,
      ptTargetsWithLocator: 0,
      itemFetchAttempts: 0,
      itemFetchSuccess: 0,
      itemPayloadsWithElements: 0,
      refsExtracted: 0,
      linkWrites: 0
    };
  }
  cursor.enrichDiagnostics.ptTargetsTotal = targets.length;
  cursor.enrichDiagnostics.ptTargetsWithLocator = targets.filter((t) => Boolean((t.uuid || "").trim() || (t.itemId || "").trim())).length;
  cursor.contentEnrichTotalHint = await countContentElementsForEnrich(sql, library.id);
  if (targets.length > 0) {
    cursor.phase = "enrich_pt";
  } else {
    await beginEnrichContentPhase(sql, library, cursor);
  }
}

export async function createScanJob(libraryId: number): Promise<number> {
  const sql = getSql();
  const rows = (await sql(
    `insert into scan_jobs (library_id, state, cursor, started_at)
     values ($1, 'running', '{}'::jsonb, now())
     returning id`,
    [libraryId]
  )) as Array<{ id: number }>;
  return rows[0]!.id;
}

export async function runScanChunk(options: { jobId: number; chunkSize?: number }) {
  const sql = getSql();
  const chunkSize = Math.min(Math.max(options.chunkSize ?? 2, 1), 10);

  const jobRows = (await sql(
    `select j.id, j.library_id, j.state, j.cursor
     from scan_jobs j
     where j.id = $1`,
    [options.jobId]
  )) as ScanJob[];
  if (jobRows.length === 0) throw new Error("Scan job not found");
  const job = jobRows[0]!;

  const libRows = (await sql(
    `select id, name, base_url, username, password_secret_ref
     from libraries where id = $1`,
    [job.library_id]
  )) as Library[];
  if (libRows.length === 0) throw new Error("Library not found for scan job");
  const library = libRows[0]!;

  const secret = parseSecret(library.password_secret_ref);
  const auth =
    library.username && secret.password
      ? `Basic ${Buffer.from(`${library.username}:${secret.password}`).toString("base64")}`
      : "";

  const existingCursor = (job.cursor || {}) as Partial<ScanCursor>;
  const cursor: ScanCursor = {
    phase: (existingCursor.phase as ScanCursor["phase"]) || "crawl",
    targets: existingCursor.targets || buildTargets(library.base_url),
    index: existingCursor.index || 0,
    fetched: existingCursor.fetched || 0,
    adapters: existingCursor.adapters || {
      contentTypeJson: 0,
      contentTypeXml: 0,
      fallbackHtml: 0
    },
    scannedAt: new Date().toISOString(),
    enrichPtTargets: migrateCursorToEnrichTargets(existingCursor),
    enrichPtUuids: Array.isArray(existingCursor.enrichPtUuids)
      ? (existingCursor.enrichPtUuids as string[])
      : undefined,
    enrichIndex: typeof existingCursor.enrichIndex === "number" ? existingCursor.enrichIndex : 0,
    folder: existingCursor.folder && typeof existingCursor.folder === "object"
      ? (existingCursor.folder as FolderCrawlCursor)
      : undefined,
    folderStepsDone: typeof existingCursor.folderStepsDone === "number" ? existingCursor.folderStepsDone : 0,
    crawlPagedRowsTotal:
      typeof existingCursor.crawlPagedRowsTotal === "number" ? existingCursor.crawlPagedRowsTotal : 0,
    crawlTotalItemsHint:
      typeof existingCursor.crawlTotalItemsHint === "number" ? existingCursor.crawlTotalItemsHint : undefined,
    wcmLibraryIdScope:
      typeof existingCursor.wcmLibraryIdScope === "string" && existingCursor.wcmLibraryIdScope.trim()
        ? existingCursor.wcmLibraryIdScope.trim()
        : undefined,
    endpointItemCounts:
      existingCursor.endpointItemCounts &&
      typeof existingCursor.endpointItemCounts === "object" &&
      !Array.isArray(existingCursor.endpointItemCounts)
        ? (existingCursor.endpointItemCounts as Record<string, number>)
        : {},
    contentEnrichTotalHint:
      typeof existingCursor.contentEnrichTotalHint === "number" ? existingCursor.contentEnrichTotalHint : undefined,
    enrichContentTargets: Array.isArray(existingCursor.enrichContentTargets)
      ? (existingCursor.enrichContentTargets as ContentEnrichTarget[])
      : undefined,
    enrichContentIndex: typeof existingCursor.enrichContentIndex === "number" ? existingCursor.enrichContentIndex : 0,
    enrichDiagnostics:
      existingCursor.enrichDiagnostics &&
      typeof existingCursor.enrichDiagnostics === "object" &&
      !Array.isArray(existingCursor.enrichDiagnostics)
        ? (existingCursor.enrichDiagnostics as ScanCursor["enrichDiagnostics"])
        : {
            ptTargetsTotal: 0,
            ptTargetsWithLocator: 0,
            itemFetchAttempts: 0,
            itemFetchSuccess: 0,
            itemPayloadsWithElements: 0,
            refsExtracted: 0,
            linkWrites: 0
          }
  };

  let processed = 0;
  /** Raised during enrich_content so each HTTP round-trip drains the queue faster than crawl/folder chunkSize. */
  let workBudget = chunkSize;
  let elementsUpserted = 0;
  let linksCreated = 0;

  const baseHeaders: Record<string, string> = {
    Accept: "text/html,application/xml,application/json;q=0.9,*/*;q=0.7",
    ...(auth ? { Authorization: auth } : {}),
    ...(secret.cookie ? { Cookie: secret.cookie } : {})
  };

  let wcmLibraryScopePromise: Promise<string | undefined> | null = null;
  let libraryRootElementIdPromise: Promise<number | null> | null = null;
  const getLibraryRootElementId = async (): Promise<number | null> => {
    if (!libraryRootElementIdPromise) {
      libraryRootElementIdPromise = ensureLibraryRootElementId({ sql, library });
    }
    return libraryRootElementIdPromise;
  };
  const getWcmLibraryScope = async (): Promise<string | undefined> => {
    if (cursor.wcmLibraryIdScope) return cursor.wcmLibraryIdScope;
    if (!wcmLibraryScopePromise) {
      const row: ScanLibraryRow = {
        id: library.id,
        name: library.name,
        base_url: library.base_url,
        username: library.username,
        password_secret_ref: library.password_secret_ref
      };
      wcmLibraryScopePromise = resolveScanWcmLibraryId(row, baseHeaders).then((id) => {
        const scoped = id ?? undefined;
        if (scoped) cursor.wcmLibraryIdScope = scoped;
        return scoped;
      });
    }
    return wcmLibraryScopePromise;
  };

  while (cursor.phase !== "done" && processed < workBudget) {
    if (cursor.phase === "crawl") {
      if (cursor.index >= cursor.targets.length) {
        if (!cursor.folder) {
          cursor.folder = await initFolderCrawlCursor(sql, library, baseHeaders);
        }
        if (cursor.folder.skipped) {
          await beginEnrichPtPhase(sql, library, baseHeaders, cursor);
          if ((cursor.phase as ScanCursor["phase"]) === "done") break;
        } else {
          cursor.phase = "folder_crawl";
        }
        continue;
      }

      const target = cursor.targets[cursor.index]!;
      cursor.index += 1;
      processed += 1;

      try {
        let parsed: unknown | null = null;
        let contentType = "";
        let bodyText = "";

        if (urlLooksWcmCollection(target)) {
          const wcmLib = await getWcmLibraryScope();
          const paged = await fetchWcmJsonCollectionAllPages({
            seedUrl: target,
            headers: baseHeaders,
            wcmLibraryId: wcmLib,
            logLabel: `scan [${cursor.index}/${cursor.targets.length}]`
          });
          if (paged) {
            parsed = paged.mergedPayload;
            contentType = "application/json";
            cursor.fetched += paged.pagesFetched;
            const endpointKey = endpointProgressKey(target);
            const prev = cursor.endpointItemCounts?.[endpointKey] ?? 0;
            if (!cursor.endpointItemCounts) cursor.endpointItemCounts = {};
            cursor.endpointItemCounts[endpointKey] = prev + paged.rowsMerged;
            const includeInItemProgress = !isLibrariesCollectionTarget(target);
            if (includeInItemProgress) {
              cursor.crawlPagedRowsTotal = (cursor.crawlPagedRowsTotal ?? 0) + paged.rowsMerged;
            }
            if (includeInItemProgress && paged.totalItemsHint != null) {
              cursor.crawlTotalItemsHint = Math.max(cursor.crawlTotalItemsHint ?? 0, paged.totalItemsHint);
            }
          }
        }

        if (!parsed) {
          const response = await fetchDx(target, baseHeaders);
          const rawBodyText = await response.text();
          bodyText = clampBodyText(rawBodyText);
          cursor.fetched += 1;

          if (!response.ok || !bodyText.trim()) {
            continue;
          }

          contentType = (response.headers.get("content-type") || "").toLowerCase();
          parsed = contentType.includes("json")
            ? tryParseJson(bodyText)
            : contentType.includes("xml")
              ? tryParseXml(bodyText)
              : tryParseJson(bodyText) || tryParseXml(bodyText);
        }

        if (parsed) {
        if (contentType.includes("json")) cursor.adapters.contentTypeJson += 1;
        else cursor.adapters.contentTypeXml += 1;

        const structuredElements = parseFromStructuredPayload(parsed, library.id, target);
        const ptWork: Array<{ id: number; structuralRefs: string[] }> = [];

        for (const el of structuredElements) {
          const id = await upsertElement({
            sql,
            libraryId: library.id,
            libraryName: library.name,
            wcmId: el.wcmId,
            name: el.name,
            type: el.type,
            rawMarkup: el.rawMarkup
          });
          if (id) {
            elementsUpserted += 1;
            // Fallback hierarchy: connect discovered nodes under the active library root
            // so graph views remain useful even when PT reference extraction is sparse.
            if (el.type !== "Library") {
              const libRootId = await getLibraryRootElementId();
              if (libRootId) {
                await upsertLink({ sql, parentId: libRootId, childId: id, linkType: "HAS_CHILD" });
                linksCreated += 1;
              }
            }
            if (el.type === "PT") ptWork.push({ id, structuralRefs: el.structuralRefs || [] });
          }
        }

        for (const { id: parentId, structuralRefs } of ptWork) {
          const ptRows = (await sql("select raw_markup from wcm_elements where id = $1", [parentId])) as Array<{
            raw_markup: string | null;
          }>;
          const fromMarkup = findComponentRefs(ptRows[0]?.raw_markup || "");
          const refs = new Set([...fromMarkup, ...structuralRefs]);
          for (const ref of refs) {
            const resolved = await resolveOrCreateComponentForRef({ sql, library, ref });
            if (!resolved) continue;
            if (resolved.elementCreated) elementsUpserted += 1;
            await upsertLink({ sql, parentId, childId: resolved.id, linkType: "REFERENCES" });
            if (graphSidecar.enabled) {
              const parentWcmRows = (await sql("select wcm_id from wcm_elements where id = $1", [parentId])) as Array<{
                wcm_id: string;
              }>;
              const parentWcmId = parentWcmRows[0]?.wcm_id;
              if (parentWcmId) {
                void graphSidecar.upsertEdge({
                  from: nodeKey(library.id, parentWcmId),
                  to: nodeKey(library.id, resolved.wcmId),
                  type: "REFERENCES",
                  properties: { libraryId: library.id, libraryName: library.name }
                });
              }
            }
            linksCreated += 1;
          }
        }
        } else {
        cursor.adapters.fallbackHtml += 1;
        const ptWcmId = `pt-${mkId(`${library.id}:${target}`)}`;
        const ptId = await upsertElement({
          sql,
          libraryId: library.id,
          libraryName: library.name,
          wcmId: ptWcmId,
          name: extractTitle(bodyText || "") || target,
          type: "PT",
          rawMarkup: bodyText.slice(0, MAX_MARKUP_BYTES)
        });
        if (!ptId) continue;
        elementsUpserted += 1;

        const refs = findComponentRefs(bodyText);
        for (const ref of refs) {
          const resolved = await resolveOrCreateComponentForRef({ sql, library, ref });
          if (!resolved) continue;
          if (resolved.elementCreated) elementsUpserted += 1;
          await upsertLink({ sql, parentId: ptId, childId: resolved.id, linkType: "REFERENCES" });
          if (graphSidecar.enabled) {
            void graphSidecar.upsertEdge({
              from: nodeKey(library.id, ptWcmId),
              to: nodeKey(library.id, resolved.wcmId),
              type: "REFERENCES",
              properties: { libraryId: library.id, libraryName: library.name }
            });
          }
          linksCreated += 1;
        }
      }
      } catch {
        // Continue with next target; errors are reflected via low fetched count.
      }
      continue;
    }

    if (cursor.phase === "folder_crawl") {
      const f = cursor.folder;
      if (!f || f.skipped) {
        await beginEnrichPtPhase(sql, library, baseHeaders, cursor);
        if ((cursor.phase as ScanCursor["phase"]) === "done") break;
        continue;
      }
      if (f.queue.length === 0) {
        await beginEnrichPtPhase(sql, library, baseHeaders, cursor);
        if ((cursor.phase as ScanCursor["phase"]) === "done") break;
        continue;
      }
      processed += 1;
      try {
        const r = await runFolderCrawlStep({ sql, library, headers: baseHeaders, cursor: f });
        cursor.folder = r.cursor;
        elementsUpserted += r.elementsUpserted;
        linksCreated += r.linksCreated;
        cursor.fetched += 1;
        cursor.folderStepsDone = (cursor.folderStepsDone ?? 0) + 1;
      } catch {
        if (cursor.folder) cursor.folder.queue = [];
      }
      continue;
    }

    if (cursor.phase === "enrich_pt") {
      let targets = cursor.enrichPtTargets || [];
      if (targets.length === 0) {
        targets = migrateCursorToEnrichTargets(cursor);
        if (targets.length > 0) cursor.enrichPtTargets = targets;
      }
      let eIdx = cursor.enrichIndex ?? 0;
      if (eIdx >= targets.length) {
        await beginEnrichContentPhase(sql, library, cursor);
        continue;
      }
      const ptTarget = targets[eIdx]!;
      cursor.enrichIndex = eIdx + 1;
      processed += 1;

      try {
        const r = await enrichPresentationTemplateDeep({
          sql,
          library,
          headers: baseHeaders,
          target: ptTarget
        });
        elementsUpserted += r.elementsUpserted;
        linksCreated += r.linksCreated;
        if (cursor.enrichDiagnostics) {
          cursor.enrichDiagnostics.itemFetchAttempts += r.diagnostics.itemFetchAttempts;
          cursor.enrichDiagnostics.itemFetchSuccess += r.diagnostics.itemFetchSuccess;
          cursor.enrichDiagnostics.itemPayloadsWithElements += r.diagnostics.itemPayloadsWithElements;
          cursor.enrichDiagnostics.refsExtracted += r.diagnostics.refsExtracted;
          cursor.enrichDiagnostics.linkWrites += r.diagnostics.linkWrites;
        }
        cursor.fetched += 1;
      } catch {
        // best-effort per PT
      }
      continue;
    }

    if (cursor.phase === "enrich_content") {
      workBudget = Math.max(workBudget, processed + CONTENT_ENRICH_PER_CHUNK);
      const cTargets = cursor.enrichContentTargets || [];
      if (cTargets.length === 0) {
        cursor.phase = "done";
        break;
      }
      let cIdx = cursor.enrichContentIndex ?? 0;
      if (cIdx >= cTargets.length) {
        cursor.phase = "done";
        break;
      }
      const cTarget = cTargets[cIdx]!;
      cursor.enrichContentIndex = cIdx + 1;
      processed += 1;

      try {
        const r = await enrichContentItemReferences({
          sql,
          library,
          headers: baseHeaders,
          target: cTarget
        });
        linksCreated += r.linksCreated;
        if (cursor.enrichDiagnostics) {
          cursor.enrichDiagnostics.contentRefsExtracted =
            (cursor.enrichDiagnostics.contentRefsExtracted ?? 0) + r.diagnostics.refsExtracted;
          cursor.enrichDiagnostics.contentLinkWrites =
            (cursor.enrichDiagnostics.contentLinkWrites ?? 0) + r.diagnostics.linkWrites;
        }
        cursor.fetched += 1;
      } catch {
        // best-effort per content item
      }
      continue;
    }
  }

  const done = cursor.phase === "done";
  if (done && cursor.enrichDiagnostics) {
    const d = cursor.enrichDiagnostics;
    console.log(
      `[DX.IQ enrich] library="${library.name}" ptTargets=${d.ptTargetsTotal} ptLocators=${d.ptTargetsWithLocator} itemFetch=${d.itemFetchSuccess}/${d.itemFetchAttempts} payloadsWithElements=${d.itemPayloadsWithElements} ptRefs=${d.refsExtracted} ptLinks=${d.linkWrites} contentTargets=${d.contentTargetsTotal ?? 0} contentRefs=${d.contentRefsExtracted ?? 0} contentLinks=${d.contentLinkWrites ?? 0}`
    );
  }
  await sql(
    `update scan_jobs
     set cursor = $2::jsonb,
         state = $3,
         completed_at = case when $3 = 'completed' then now() else completed_at end
     where id = $1`,
    [job.id, JSON.stringify(cursor), done ? "completed" : "running"]
  );

  const enrichPtTotal =
    cursor.enrichPtTargets && cursor.enrichPtTargets.length > 0
      ? cursor.enrichPtTargets.length
      : (cursor.enrichPtUuids?.length ?? 0);
  const enrichPtDone = cursor.enrichIndex ?? 0;
  const enrichContentTotal =
    cursor.enrichContentTargets?.length ?? cursor.contentEnrichTotalHint ?? 0;
  const enrichContentDone = cursor.enrichContentIndex ?? 0;
  const folderSteps = cursor.folderStepsDone ?? 0;
  const folderQueue = cursor.folder?.queue?.length ?? 0;
  const pagedRows = cursor.crawlPagedRowsTotal ?? 0;
  const crawlHint = cursor.crawlTotalItemsHint ?? 0;
  const progressTargetCount =
    cursor.phase === "crawl" && enrichPtTotal === 0
      ? Math.max(cursor.targets.length, crawlHint, pagedRows)
      : cursor.targets.length + folderSteps + folderQueue + enrichPtTotal + enrichContentTotal;
  const progressCurrentIndex =
    cursor.phase === "crawl"
      ? Math.max(cursor.index, pagedRows)
      : cursor.phase === "folder_crawl"
        ? cursor.targets.length + folderSteps
        : cursor.phase === "enrich_pt"
          ? cursor.targets.length + folderSteps + enrichPtDone
          : cursor.phase === "enrich_content"
            ? cursor.targets.length + folderSteps + enrichPtTotal + enrichContentDone
            : cursor.targets.length + folderSteps + enrichPtTotal + enrichContentTotal;

  return {
    ok: true,
    jobId: job.id,
    libraryId: library.id,
    state: done ? "completed" : "running",
    progress: {
      processedThisChunk: processed,
      targetCount: progressTargetCount,
      currentIndex: progressCurrentIndex,
      endpointTargetCount: cursor.targets.length,
      itemsFetched: pagedRows,
      totalItemsHint: crawlHint,
      fetchedPages: cursor.fetched,
      endpointItemCounts: cursor.endpointItemCounts || {},
      adapters: cursor.adapters,
      phase: cursor.phase,
      contentEnrichQueued: cursor.enrichContentTargets?.length ?? 0,
      contentEnrichDone: cursor.enrichContentIndex ?? 0
    },
    stats: {
      elementsUpserted,
      linksCreated
    }
  };
}
