export type GraphNodePayload = {
  key: string;
  label: "Library" | "Component" | "AT" | "PT" | "SiteArea" | "Content" | "Folder";
  properties: Record<string, unknown>;
};

export type GraphEdgePayload = {
  from: string;
  to: string;
  type: string;
  properties?: Record<string, unknown>;
};

type GraphSidecar = {
  enabled: boolean;
  upsertNode: (payload: GraphNodePayload) => Promise<void>;
  upsertEdge: (payload: GraphEdgePayload) => Promise<void>;
};

function noOp(): GraphSidecar {
  return {
    enabled: false,
    upsertNode: async () => undefined,
    upsertEdge: async () => undefined
  };
}

function withWebhook(url: string): GraphSidecar {
  const token = process.env.GRAPH_SIDECAR_TOKEN?.trim();
  async function send(event: Record<string, unknown>) {
    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(4_000)
      });
    } catch {
      // Best effort sidecar sync; never break scan pipeline.
    }
  }

  return {
    enabled: true,
    upsertNode: async (payload) => send({ event: "upsert_node", payload }),
    upsertEdge: async (payload) => send({ event: "upsert_edge", payload })
  };
}

export function createGraphSidecar(): GraphSidecar {
  const webhookUrl = process.env.GRAPH_SIDECAR_URL?.trim();
  if (!webhookUrl) return noOp();
  return withWebhook(webhookUrl);
}

