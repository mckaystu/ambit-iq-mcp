/**
 * FalkorDB / RedisGraph Cypher used by WCM hierarchy sync.
 * All keys are namespaced per DX.IQ library row: library:{dbId}:...
 * Nodes use the shared :Entity { key } pattern (see events.ts) plus role labels.
 */

import { esc } from "./_redis";

export type GraphPropMap = Record<string, string | number | boolean>;

function buildSet(alias: "n" | "r", props: GraphPropMap): string {
  const assignments = Object.entries(props).map(([k, v]) => {
    const key = k.replace(/[^A-Za-z0-9_]/g, "");
    if (!key) return "";
    if (typeof v === "number") return `${alias}.${key} = ${Number.isFinite(v) ? v : 0}`;
    if (typeof v === "boolean") return `${alias}.${key} = ${v ? "true" : "false"}`;
    return `${alias}.${key} = '${esc(v)}'`;
  });
  const parts = assignments.filter(Boolean);
  return parts.length ? ` SET ${parts.join(", ")}` : "";
}

/** Documented templates (placeholders explained in comments). */
export const WCM_HIERARCHY_CYPHER_TEMPLATES = {
  /**
   * MERGE library anchor.
   * Placeholders: KEY, NAME, WCM_LIBRARY_ID, DB_LIBRARY_ID
   */
  mergeLibrary: `MERGE (n:Entity { key: 'KEY' })
SET n:Library, n.updatedAt = timestamp(), n.name = 'NAME', n.wcmLibraryId = 'WCM_LIBRARY_ID', n.dbLibraryId = DB_LIBRARY_ID`,

  /**
   * MERGE site area or content item node.
   * Placeholders: KEY, LABEL (SiteArea|ContentItem), NAME, WCM_TYPE, EXTERNAL_ID
   */
  mergeHierarchyNode: `MERGE (n:Entity { key: 'KEY' })
SET n:LABEL, n.updatedAt = timestamp(), n.name = 'NAME', n.wcmType = 'WCM_TYPE', n.externalId = 'EXTERNAL_ID'`,

  /**
   * MERGE component referenced from expanded content.
   * Placeholders: KEY, NAME
   */
  mergeComponent: `MERGE (n:Entity { key: 'KEY' })
SET n:Component, n.updatedAt = timestamp(), n.name = 'NAME'`,

  /**
   * Parent/child containment.
   * Placeholders: PARENT_KEY, CHILD_KEY
   */
  mergeHasChild: `MERGE (a:Entity { key: 'PARENT_KEY' })
MERGE (b:Entity { key: 'CHILD_KEY' })
MERGE (a)-[r:HAS_CHILD]->(b)
SET r.updatedAt = timestamp()`,

  /**
   * Content uses component (from ?expand=elements or embedded structure).
   * Placeholders: CONTENT_KEY, COMPONENT_KEY
   */
  mergeUsesComponent: `MERGE (c:Entity { key: 'CONTENT_KEY' })
MERGE (p:Entity { key: 'COMPONENT_KEY' })
MERGE (c)-[r:USES_COMPONENT]->(p)
SET r.updatedAt = timestamp()`
} as const;

export function cypherMergeLibrary(params: {
  key: string;
  name: string;
  wcmLibraryId: string;
  dbLibraryId: number;
}): string {
  const props: GraphPropMap = {
    name: params.name,
    wcmLibraryId: params.wcmLibraryId,
    dbLibraryId: params.dbLibraryId
  };
  return (
    `MERGE (n:Entity { key: '${esc(params.key)}' }) ` +
    `SET n:Library, n.updatedAt = timestamp()` +
    buildSet("n", props)
  );
}

export function cypherMergeHierarchyNode(params: {
  key: string;
  label: "SiteArea" | "ContentItem";
  name: string;
  wcmType: string;
  externalId: string;
}): string {
  const props: GraphPropMap = {
    name: params.name,
    wcmType: params.wcmType,
    externalId: params.externalId
  };
  return (
    `MERGE (n:Entity { key: '${esc(params.key)}' }) ` +
    `SET n:${params.label}, n.updatedAt = timestamp()` +
    buildSet("n", props)
  );
}

export function cypherMergeComponentNode(params: { key: string; name: string }): string {
  const props: GraphPropMap = { name: params.name };
  return (
    `MERGE (n:Entity { key: '${esc(params.key)}' }) ` +
    `SET n:Component, n.updatedAt = timestamp()` +
    buildSet("n", props)
  );
}

export function cypherMergeHasChild(params: { parentKey: string; childKey: string }): string {
  return (
    `MERGE (a:Entity { key: '${esc(params.parentKey)}' }) ` +
    `MERGE (b:Entity { key: '${esc(params.childKey)}' }) ` +
    `MERGE (a)-[r:HAS_CHILD]->(b) ` +
    `SET r.updatedAt = timestamp()`
  );
}

export function cypherMergeUsesComponent(params: { contentKey: string; componentKey: string }): string {
  return (
    `MERGE (c:Entity { key: '${esc(params.contentKey)}' }) ` +
    `MERGE (p:Entity { key: '${esc(params.componentKey)}' }) ` +
    `MERGE (c)-[r:USES_COMPONENT]->(p) ` +
    `SET r.updatedAt = timestamp()`
  );
}
