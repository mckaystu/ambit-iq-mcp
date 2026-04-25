import { createEnabledAuditors, runAuditors } from "./auditors/index";
import type { AuditFinding } from "./auditors/types";
import { clampBodyText, fetchDx, resolveOriginFromBaseUrl } from "./wcmFetch";
import {
  extractListItemsFromPayload,
  fetchWcmJsonCollectionAllPagesFirstSeed,
  withLibraryIdParam,
  withPageSizeParam,
  WCM_DEFAULT_PAGE_SIZE
} from "./wcmPagedFetch";

export type ScanLibraryRow = {
  id: number;
  name: string;
  base_url: string;
  username: string;
  password_secret_ref: string;
};

export type FolderCrawlCursor = {
  wcmLibraryId: string;
  queue: Array<{
    folderId: string;
    breadcrumb: string[];
    depth: number;
    parentElementId: number | null;
  }>;
  /** Folder ids already expanded (avoid duplicate queue). */
  seenFolderIds: string[];
  skipped: boolean;
  warning?: string;
};

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const ITEM_AUDIT_CONCURRENCY = 12;

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function firstString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function extractId(o: Record<string, unknown>): string {
  return firstString(o.id, o.uuid, o.wcmId, o.resourceId, o.documentId);
}

function parseModifiedMs(o: Record<string, unknown>): number | null {
  const raw = firstString(
    o.lastModified,
    o.modified,
    o.updated,
    o.lastModifiedDate,
    typeof o.lastModifiedDate === "string" ? o.lastModifiedDate : undefined
  );
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function itemElementType(o: Record<string, unknown>): "Content" | "Component" {
  const t = firstString(o.type, o.elementType, o.category, o.kind).toLowerCase();
  if (t.includes("component") || t.includes("portlet")) return "Component";
  return "Content";
}

function wcmBases(origin: string): string[] {
  return [`${origin}/wps/mycontenthandler/wcmrest-v2`, `${origin}/hcl/mycontenthandler/wcmrest-v2`, `${origin}/dx/api/wcm/v2`];
}

async function fetchJsonFirstOk(
  paths: string[],
  headers: Record<string, string>
): Promise<{ data: unknown; url: string } | null> {
  for (const url of paths) {
    const res = await fetchDx(url, headers);
    const text = clampBodyText(await res.text());
    if (!res.ok || !text.trim()) continue;
    const data = tryParseJson(text);
    if (data) return { data, url };
  }
  return null;
}

async function resolveWcmLibraryId(libraryName: string, origin: string, headers: Record<string, string>): Promise<string | null> {
  const want = libraryName.trim().toLowerCase();
  for (const base of wcmBases(origin)) {
    const hit = await fetchWcmJsonCollectionAllPagesFirstSeed({
      seedUrls: [withPageSizeParam(`${base}/libraries`, WCM_DEFAULT_PAGE_SIZE)],
      headers,
      logLabel: `WCM libraries list (resolve "${libraryName}")`
    });
    if (!hit) continue;
    for (const row of extractListItemsFromPayload(hit.mergedPayload)) {
      const n = firstString(row.name, row.title, row.displayName, row.libraryTitle).toLowerCase();
      if (n === want || n.includes(want) || want.includes(n)) {
        const id = extractId(row);
        if (id) return id;
      }
    }
  }
  return null;
}

/** Resolve WCM REST library id for URL-scoped collection GETs (used by main scan crawl). */
export async function resolveScanWcmLibraryId(
  library: ScanLibraryRow,
  headers: Record<string, string>
): Promise<string | null> {
  const origin = resolveOriginFromBaseUrl(library.base_url);
  return resolveWcmLibraryId(library.name, origin, headers);
}

async function resolveRootFolderId(wcmLibraryId: string, origin: string, headers: Record<string, string>): Promise<string | null> {
  const enc = encodeURIComponent(wcmLibraryId);
  for (const base of wcmBases(origin)) {
    const hit = await fetchJsonFirstOk(
      [
        `${base}/libraries/${enc}`,
        `${base}/libraries/${enc}?expand=folders`,
        `${base}/libraries/${enc}?expand=all`
      ],
      headers
    );
    if (!hit) continue;
    const root = hit.data as Record<string, unknown>;
    const rf = root.rootFolder;
    if (rf && typeof rf === "object" && !Array.isArray(rf)) {
      const id = extractId(rf as Record<string, unknown>);
      if (id) return id;
    }
    const direct = firstString(root.rootFolderId, root.defaultFolderId, root.rootContentFolderId);
    if (direct) return direct;
    const objs: Record<string, unknown>[] = [];
    const walk = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) {
        for (const x of n) walk(x);
        return;
      }
      objs.push(n as Record<string, unknown>);
      for (const v of Object.values(n as Record<string, unknown>)) walk(v);
    };
    walk(hit.data);
    for (const o of objs) {
      const t = firstString(o.type, o.elementType).toLowerCase();
      if (t.includes("folder") && extractId(o)) {
        const id = extractId(o);
        const isRoot = o.isRoot === true || String(o.name).toLowerCase() === "root";
        if (isRoot || objs.length < 8) return id;
      }
    }
  }

  // Fallback for tenants that hide rootFolderId on /libraries/{id} but expose folder listings.
  for (const base of wcmBases(origin)) {
    const list = await fetchWcmJsonCollectionAllPagesFirstSeed({
      seedUrls: [withLibraryIdParam(withPageSizeParam(`${base}/folders`, WCM_DEFAULT_PAGE_SIZE), wcmLibraryId)],
      headers,
      wcmLibraryId,
      logLabel: `WCM folders list (resolve root ${wcmLibraryId.slice(0, 8)})`
    });
    if (!list) continue;
    const folders = extractListItemsFromPayload(list.mergedPayload);
    if (folders.length === 0) continue;

    let best: Record<string, unknown> | null = null;
    for (const f of folders) {
      const isRoot = f.isRoot === true || firstString(f.name).toLowerCase() === "root";
      const parentId = firstString(f.parentId, f.parentFolderId, f.parent);
      if (isRoot || !parentId) {
        best = f;
        break;
      }
    }
    if (!best) best = folders[0]!;
    const id = extractId(best);
    if (id) return id;
  }

  return null;
}

async function upsertElementExtended(params: {
  sql: any;
  libraryId: number;
  wcmId: string;
  name: string;
  type: "Folder" | "Content" | "Component";
  rawMarkup?: string | null;
  breadcrumbPath?: string | null;
  lastModified?: Date | null;
  staleCandidate?: boolean;
  auditFindings?: AuditFinding[];
}): Promise<number | undefined> {
  const findingsJson = JSON.stringify(params.auditFindings ?? []);
  const rows = (await params.sql(
    `insert into wcm_elements (library_id, wcm_id, name, type, raw_markup, breadcrumb_path, last_modified, stale_candidate, audit_findings)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     on conflict (library_id, wcm_id)
     do update set
       name = excluded.name,
       type = excluded.type,
       raw_markup = coalesce(excluded.raw_markup, wcm_elements.raw_markup),
       breadcrumb_path = coalesce(excluded.breadcrumb_path, wcm_elements.breadcrumb_path),
       last_modified = coalesce(excluded.last_modified, wcm_elements.last_modified),
       stale_candidate = excluded.stale_candidate or wcm_elements.stale_candidate,
       audit_findings = case
         when excluded.audit_findings::text = '[]'::text then wcm_elements.audit_findings
         else excluded.audit_findings
       end
     returning id`,
    [
      params.libraryId,
      params.wcmId,
      params.name,
      params.type,
      params.rawMarkup ?? null,
      params.breadcrumbPath ?? null,
      params.lastModified ? params.lastModified.toISOString() : null,
      Boolean(params.staleCandidate),
      findingsJson
    ]
  )) as Array<{ id: number }>;
  return rows[0]?.id;
}

async function upsertLink(sql: any, parentId: number, childId: number, linkType: string) {
  await sql(
    `insert into wcm_links (parent_id, child_id, link_type)
     select $1, $2, $3
     where not exists (
       select 1 from wcm_links w
       where w.parent_id = $1 and w.child_id is not distinct from $2 and w.link_type = $3
     )`,
    [parentId, childId, linkType]
  );
}

async function findLibraryElementId(sql: any, libraryId: number): Promise<number | null> {
  const rows = (await sql(
    `select id from wcm_elements where library_id = $1 and type = 'Library' order by id asc limit 1`,
    [libraryId]
  )) as Array<{ id: number }>;
  return rows[0]?.id ?? null;
}

/**
 * One folder-crawl step: expand the next queued folder (BFS), write Folder / items + HAS_CHILD links.
 */
export async function runFolderCrawlStep(params: {
  sql: any;
  library: ScanLibraryRow;
  headers: Record<string, string>;
  cursor: FolderCrawlCursor;
}): Promise<{ cursor: FolderCrawlCursor; elementsUpserted: number; linksCreated: number }> {
  let elementsUpserted = 0;
  let linksCreated = 0;
  const c = params.cursor;
  const origin = resolveOriginFromBaseUrl(params.library.base_url);
  const auditors = createEnabledAuditors();

  if (c.skipped) {
    return { cursor: c, elementsUpserted: 0, linksCreated: 0 };
  }

  if (c.queue.length === 0) {
    return { cursor: c, elementsUpserted: 0, linksCreated: 0 };
  }

  const current = c.queue.shift()!;
  if (c.seenFolderIds.includes(current.folderId)) {
    return { cursor: c, elementsUpserted: 0, linksCreated: 0 };
  }
  c.seenFolderIds.push(current.folderId);

  const folderEnc = encodeURIComponent(current.folderId);
  const pathsFolders = wcmBases(origin).map((b) =>
    withLibraryIdParam(withPageSizeParam(`${b}/folders/${folderEnc}/folders`, WCM_DEFAULT_PAGE_SIZE), c.wcmLibraryId)
  );
  const pathsItems = wcmBases(origin).map((b) =>
    withLibraryIdParam(withPageSizeParam(`${b}/folders/${folderEnc}/items`, WCM_DEFAULT_PAGE_SIZE), c.wcmLibraryId)
  );

  const [subRes, itemsRes] = await Promise.all([
    fetchWcmJsonCollectionAllPagesFirstSeed({
      seedUrls: pathsFolders,
      headers: params.headers,
      wcmLibraryId: c.wcmLibraryId,
      logLabel: `folder ${current.folderId}/folders`
    }),
    fetchWcmJsonCollectionAllPagesFirstSeed({
      seedUrls: pathsItems,
      headers: params.headers,
      wcmLibraryId: c.wcmLibraryId,
      logLabel: `folder ${current.folderId}/items`
    })
  ]);

  const breadcrumbPath = current.breadcrumb.join(" / ") || "(library root)";
  const folderName = current.breadcrumb.length ? current.breadcrumb[current.breadcrumb.length - 1]! : "Library root";

  const folderRow: Record<string, unknown> = subRes
    ? (extractListItemsFromPayload(subRes.mergedPayload).find((x) => extractId(x) === current.folderId) as Record<
        string,
        unknown
      >) || {}
    : {};
  const folderMeta = Object.keys(folderRow).length ? folderRow : { id: current.folderId, name: folderName };
  const modMs = parseModifiedMs(folderMeta);
  const stale = modMs !== null && Date.now() - modMs > TWO_YEARS_MS;

  const folderDbId = await upsertElementExtended({
    sql: params.sql,
    libraryId: params.library.id,
    wcmId: `folder-${current.folderId}`,
    name: firstString(folderMeta.name, folderMeta.title, folderName),
    type: "Folder",
    rawMarkup: null,
    breadcrumbPath,
    lastModified: modMs ? new Date(modMs) : null,
    staleCandidate: stale,
    auditFindings: stale
      ? [
          {
            auditorId: "staleness",
            severity: "info" as const,
            message: "Potentially stale: folder not modified in over 2 years",
            snippet: modMs ? new Date(modMs).toISOString() : undefined
          }
        ]
      : []
  });
  if (folderDbId) elementsUpserted += 1;

  if (folderDbId && current.parentElementId != null) {
    await upsertLink(params.sql, current.parentElementId, folderDbId, "HAS_CHILD");
    linksCreated += 1;
  }

  const childFolders = subRes ? extractListItemsFromPayload(subRes.mergedPayload) : [];
  for (const cf of childFolders) {
    const cid = extractId(cf);
    if (!cid || cid === current.folderId) continue;
    const childName = firstString(cf.name, cf.title, cid);
    c.queue.push({
      folderId: cid,
      breadcrumb: [...current.breadcrumb, childName],
      depth: current.depth + 1,
      parentElementId: folderDbId ?? current.parentElementId
    });
  }

  const rawItems = itemsRes ? extractListItemsFromPayload(itemsRes.mergedPayload) : [];

  const processItem = async (item: Record<string, unknown>) => {
    const iid = extractId(item);
    if (!iid) return;
    const elType = itemElementType(item);
    const name = firstString(item.name, item.title, item.displayName, iid);
    const markup =
      typeof item.markup === "string"
        ? item.markup
        : typeof item.html === "string"
          ? item.html
          : typeof item.content === "string"
            ? item.content
            : undefined;
    const findings = runAuditors(auditors, {
      folderPath: breadcrumbPath,
      folderDepth: current.depth,
      componentJson: { ...item, _folderPath: breadcrumbPath }
    });
    const itemMod = parseModifiedMs(item);
    const id = await upsertElementExtended({
      sql: params.sql,
      libraryId: params.library.id,
      wcmId: `${elType.toLowerCase()}-${iid}`,
      name,
      type: elType,
      rawMarkup: markup?.slice(0, 16_000) ?? null,
      breadcrumbPath,
      lastModified: itemMod ? new Date(itemMod) : null,
      staleCandidate: false,
      auditFindings: findings
    });
    if (id) elementsUpserted += 1;
    if (id && folderDbId) {
      await upsertLink(params.sql, folderDbId, id, "HAS_CHILD");
      linksCreated += 1;
    }
  };

  for (let i = 0; i < rawItems.length; i += ITEM_AUDIT_CONCURRENCY) {
    const batch = rawItems.slice(i, i + ITEM_AUDIT_CONCURRENCY);
    await Promise.all(batch.map((item) => processItem(item)));
  }

  return { cursor: c, elementsUpserted, linksCreated };
}

export async function initFolderCrawlCursor(
  sql: any,
  library: ScanLibraryRow,
  headers: Record<string, string>
): Promise<FolderCrawlCursor> {
  const origin = resolveOriginFromBaseUrl(library.base_url);
  const wcmLibraryId = await resolveWcmLibraryId(library.name, origin, headers);
  if (!wcmLibraryId) {
    return {
      wcmLibraryId: "",
      queue: [],
      seenFolderIds: [],
      skipped: true,
      warning: "Could not resolve WCM library id for folder crawl (libraries list mismatch)."
    };
  }
  const rootId = await resolveRootFolderId(wcmLibraryId, origin, headers);
  if (!rootId) {
    return {
      wcmLibraryId,
      queue: [],
      seenFolderIds: [],
      skipped: true,
      warning: "Could not resolve root folder id from library resource; folder API crawl skipped."
    };
  }

  const libElementId = await findLibraryElementId(sql, library.id);
  const cursor: FolderCrawlCursor = {
    wcmLibraryId,
    queue: [
      {
        folderId: rootId,
        breadcrumb: [library.name],
        depth: 0,
        parentElementId: libElementId
      }
    ],
    seenFolderIds: [],
    skipped: false
  };
  return cursor;
}
