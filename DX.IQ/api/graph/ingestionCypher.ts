/**
 * FalkorDB Cypher for graph ingestor: richer node props + batched edges.
 * Uses :Entity { key } plus role labels (same convention as events.ts / wcmHierarchyCypher).
 *
 * Database access uses `GRAPH.QUERY` over Redis (ioredis) — the standard Node integration for
 * FalkorDB; a separate `falkordb` npm package is not required for this server runtime.
 */

import pLimit from "p-limit";
import { esc, graphQuery } from "./_redis";

export type IngestNodeProps = Record<string, string | number | boolean>;

function buildSet(alias: "n" | "r" | "t", props: IngestNodeProps): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    const key = k.replace(/[^A-Za-z0-9_]/g, "");
    if (!key) continue;
    if (typeof v === "number") parts.push(`${alias}.${key} = ${Number.isFinite(v) ? v : 0}`);
    else if (typeof v === "boolean") parts.push(`${alias}.${key} = ${v ? "true" : "false"}`);
    else parts.push(`${alias}.${key} = '${esc(String(v))}'`);
  }
  return parts.length ? ` SET ${parts.join(", ")}` : "";
}

export function ingestLibraryKey(wcmLibraryId: string): string {
  return `ingest:wcm:${wcmLibraryId}:library`;
}

export function ingestSiteAreaKey(wcmLibraryId: string, externalId: string): string {
  return `ingest:wcm:${wcmLibraryId}:sitearea:${externalId}`;
}

export function ingestContentKey(wcmLibraryId: string, externalId: string): string {
  return `ingest:wcm:${wcmLibraryId}:content:${externalId}`;
}

export function ingestComponentKey(wcmLibraryId: string, componentName: string): string {
  return `ingest:wcm:${wcmLibraryId}:component:${componentName.trim().slice(0, 200)}`;
}

export function ingestTemplateKey(wcmLibraryId: string, templateId: string): string {
  return `ingest:wcm:${wcmLibraryId}:tpl:${templateId.trim().slice(0, 200)}`;
}

export function cypherMergeIngestLibrary(params: {
  key: string;
  wcmLibraryId: string;
  name: string;
  title?: string;
  lastModified?: string;
  status?: string;
}): string {
  const props: IngestNodeProps = {
    libraryId: params.wcmLibraryId,
    name: params.name,
    ...(params.title ? { title: params.title } : {}),
    ...(params.lastModified ? { lastModified: params.lastModified } : {}),
    ...(params.status ? { status: params.status } : {})
  };
  return (
    `MERGE (n:Entity { key: '${esc(params.key)}' }) ` +
    `SET n:Library, n.updatedAt = timestamp()` +
    buildSet("n", props)
  );
}

export function cypherMergeIngestHierarchyNode(params: {
  key: string;
  label: "SiteArea" | "ContentItem";
  externalId: string;
  name: string;
  title?: string;
  lastModified?: string;
  status?: string;
  wcmType?: string;
}): string {
  const props: IngestNodeProps = {
    externalId: params.externalId,
    name: params.name,
    ...(params.title ? { title: params.title } : {}),
    ...(params.lastModified ? { lastModified: params.lastModified } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.wcmType ? { wcmType: params.wcmType } : {})
  };
  return (
    `MERGE (n:Entity { key: '${esc(params.key)}' }) ` +
    `SET n:${params.label}, n.updatedAt = timestamp()` +
    buildSet("n", props)
  );
}

export function cypherMergeContentTemplate(params: {
  key: string;
  templateId: string;
  name: string;
  title?: string;
  lastModified?: string;
  status?: string;
}): string {
  const props: IngestNodeProps = {
    templateId: params.templateId,
    name: params.name,
    ...(params.title ? { title: params.title } : {}),
    ...(params.lastModified ? { lastModified: params.lastModified } : {}),
    ...(params.status ? { status: params.status } : {})
  };
  return (
    `MERGE (n:Entity { key: '${esc(params.key)}' }) ` +
    `SET n:ContentTemplate, n.updatedAt = timestamp()` +
    buildSet("n", props)
  );
}

export function cypherMergeComponentIngest(params: {
  key: string;
  name: string;
  title?: string;
  lastModified?: string;
  status?: string;
}): string {
  const props: IngestNodeProps = {
    name: params.name,
    ...(params.title ? { title: params.title } : {}),
    ...(params.lastModified ? { lastModified: params.lastModified } : {}),
    ...(params.status ? { status: params.status } : {})
  };
  return (
    `MERGE (n:Entity { key: '${esc(params.key)}' }) ` +
    `SET n:Component, n.updatedAt = timestamp()` +
    buildSet("n", props)
  );
}

export function cypherMergeHasChildKeys(parentKey: string, childKey: string): string {
  return (
    `MERGE (a:Entity { key: '${esc(parentKey)}' }) ` +
    `MERGE (b:Entity { key: '${esc(childKey)}' }) ` +
    `MERGE (a)-[r:HAS_CHILD]->(b) ` +
    `SET r.updatedAt = timestamp()`
  );
}

export function cypherMergeBasedOn(params: { contentKey: string; templateKey: string }): string {
  return (
    `MERGE (c:Entity { key: '${esc(params.contentKey)}' }) ` +
    `MERGE (t:Entity { key: '${esc(params.templateKey)}' }) ` +
    `MERGE (c)-[r:BASED_ON]->(t) ` +
    `SET r.updatedAt = timestamp()`
  );
}

export function buildBatchUsesComponent(
  rows: Array<{ contentKey: string; componentKey: string; elementName: string }>
): string | null {
  if (rows.length === 0) return null;
  const lit = rows
    .map(
      (r) =>
        `{ck:'${esc(r.contentKey)}', pk:'${esc(r.componentKey)}', en:'${esc(r.elementName)}'}`
    )
    .join(", ");
  return (
    `UNWIND [${lit}] AS row ` +
    `MERGE (c:Entity { key: row.ck }) ` +
    `MERGE (p:Entity { key: row.pk }) ` +
    `MERGE (c)-[r:USES_COMPONENT]->(p) ` +
    `SET r.elementName = row.en, r.updatedAt = timestamp()`
  );
}

export async function runCypherBatches(
  queries: string[],
  concurrency: number
): Promise<void> {
  const limit = pLimit(Math.max(1, Math.min(concurrency, 16)));
  await Promise.all(queries.map((q) => limit(() => graphQuery(q))));
}

/** Best-effort decode of Falkor/RedisGraph --compact result into row objects. */
export function parseCompactGraphRows(raw: unknown): Array<Record<string, string>> {
  if (!Array.isArray(raw) || raw.length < 2) return [];
  const header = raw[0] as unknown[];
  const data = raw[1] as unknown[];
  if (!Array.isArray(header) || !Array.isArray(data)) return [];
  const keys = header.map((h) => (Array.isArray(h) ? String(h[0]) : String(h)));
  return data.map((row) => {
    const obj: Record<string, string> = {};
    if (!Array.isArray(row)) return obj;
    row.forEach((cell, i) => {
      const k = keys[i] || `col${i}`;
      const val = Array.isArray(cell) ? cell[0] : cell;
      obj[k] = val == null ? "" : String(val);
    });
    return obj;
  });
}

/** Visualizer queries (read). */
export function cypherGetOrphanedComponents(wcmLibraryId: string): string {
  const prefix = esc(`ingest:wcm:${wcmLibraryId}:component:`);
  return (
    `MATCH (c:Entity) ` +
    `WHERE c:Component AND c.key STARTS WITH '${prefix}' ` +
    `AND NOT ( ()-[:USES_COMPONENT]->(c) ) ` +
    `RETURN c.key AS key, c.name AS name, c.title AS title ` +
    `LIMIT 500`
  );
}

export function cypherGetDeepestPath(libraryKey: string): string {
  return (
    `MATCH (root:Entity { key: '${esc(libraryKey)}' }) ` +
    `MATCH p = (root)-[:HAS_CHILD*]->(leaf) ` +
    `WHERE NOT (leaf)-[:HAS_CHILD]->() ` +
    `RETURN length(p) AS depth ` +
    `ORDER BY depth DESC ` +
    `LIMIT 1`
  );
}

export function cypherGetTemplateUsage(wcmLibraryId: string): string {
  const tplPrefix = esc(`ingest:wcm:${wcmLibraryId}:tpl:`);
  return (
    `MATCH (t:Entity) ` +
    `WHERE t:ContentTemplate AND t.key STARTS WITH '${tplPrefix}' ` +
    `OPTIONAL MATCH (c:Entity)-[:BASED_ON]->(t) ` +
    `RETURN coalesce(t.name, t.templateId, t.key) AS template, count(c) AS contentItems ` +
    `ORDER BY contentItems DESC ` +
    `LIMIT 200`
  );
}
