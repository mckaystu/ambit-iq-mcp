import "../_load-env";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";

type ElementRow = {
  id: number;
  wcm_id: string;
  name: string;
  type: string;
};

type LinkRow = {
  parent_id: number;
  child_id: number;
  link_type: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const db = process.env.DATABASE_URL;
    if (!db) return res.status(500).json({ ok: false, error: "DATABASE_URL is not configured" });
    const sql = neon(db);

    const libraryId = Number(req.query.libraryId);
    if (!libraryId || Number.isNaN(libraryId)) {
      return res.status(400).json({ ok: false, error: "libraryId query param is required" });
    }
    const limit = Math.min(Math.max(Number(req.query.limit || 800), 100), 2000);

    const elements = (await sql(
      `select id, wcm_id, name, type
       from wcm_elements
       where library_id = $1
       order by id asc
       limit $2`,
      [libraryId, limit]
    )) as ElementRow[];

    if (elements.length === 0) {
      return res.status(200).json({
        ok: true,
        libraryId,
        nodes: [],
        edges: [],
        hierarchy: [],
        summary: { nodes: 0, edges: 0, unusedComponents: 0, truncated: false }
      });
    }

    const nodeIdSet = new Set<number>(elements.map((e) => e.id));
    const links = (await sql(
      `select parent_id, child_id, link_type
       from wcm_links
       where parent_id in (select id from wcm_elements where library_id = $1)
         and child_id in (select id from wcm_elements where library_id = $1)
       order by parent_id asc
       limit $2`,
      [libraryId, limit * 4]
    )) as LinkRow[];

    const filteredLinks = links.filter((l) => nodeIdSet.has(l.parent_id) && nodeIdSet.has(l.child_id));
    const byId = new Map<number, ElementRow>(elements.map((e) => [e.id, e]));
    const inbound = new Map<number, number>();
    const outbound = new Map<number, number>();
    for (const e of elements) {
      inbound.set(e.id, 0);
      outbound.set(e.id, 0);
    }
    for (const l of filteredLinks) {
      inbound.set(l.child_id, (inbound.get(l.child_id) || 0) + 1);
      outbound.set(l.parent_id, (outbound.get(l.parent_id) || 0) + 1);
    }

    const nodes = elements.map((e) => ({
      id: e.id,
      wcmId: e.wcm_id,
      name: e.name,
      type: e.type,
      inbound: inbound.get(e.id) || 0,
      outbound: outbound.get(e.id) || 0,
      isUnused: e.type === "Component" && (inbound.get(e.id) || 0) === 0
    }));

    const edges = filteredLinks
      .map((l) => {
        const from = byId.get(l.parent_id);
        const to = byId.get(l.child_id);
        if (!from || !to) return null;
        return {
          fromId: from.id,
          fromName: from.name,
          fromType: from.type,
          toId: to.id,
          toName: to.name,
          toType: to.type,
          type: l.link_type
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    const hierarchy = nodes
      .filter((n) => n.type === "PT")
      .map((pt) => ({
        ptId: pt.id,
        ptName: pt.name,
        children: edges
          .filter((e) => e.fromId === pt.id)
          .map((e) => ({ id: e.toId, name: e.toName, type: e.toType }))
      }))
      .filter((pt) => pt.children.length > 0)
      .sort((a, b) => b.children.length - a.children.length)
      .slice(0, 100);

    const ptCount = nodes.filter((n) => n.type === "PT").length;
    const componentCount = nodes.filter((n) => n.type === "Component").length;
    const story =
      edges.length === 0
        ? {
            headline: "No relationship edges yet",
            detail:
              "Edges are REFERENCES from PTs to components (plus HAS_CHILD from folder crawl when enabled). " +
              "The enrich phase follows presentation-templates and HATEOAS edit/self links, GETs …/dx/api/wcm/v2/items/{id} for the full `elements` tree, and regexes markup for [Component …], [Property … field=…], and [Plugin:Link …]. " +
              "Refs match catalog components by name or UUID (wcm_id). Run a fresh scan after upgrading; use Cookie auth if item/detail GETs are empty.",
            ptCount,
            componentCount
          }
        : null;

    return res.status(200).json({
      ok: true,
      libraryId,
      nodes,
      edges,
      hierarchy,
      story,
      summary: {
        nodes: nodes.length,
        edges: edges.length,
        unusedComponents: nodes.filter((n) => n.isUnused).length,
        truncated: nodes.length >= limit
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Failed to build graph subgraph",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
