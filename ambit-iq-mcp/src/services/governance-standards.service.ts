import { Pinecone } from "@pinecone-database/pinecone";
import type { Index } from "@pinecone-database/pinecone";

const DEFAULT_HF_MODEL = "sentence-transformers/all-MiniLM-L6-v2";

export type GovernanceStandardsMatch = {
  score?: number;
  text: string;
  source: string;
  metadata: Record<string, string>;
};

type GovernanceClients = {
  index: Index;
  indexName: string;
};

let clientsPromise: Promise<GovernanceClients> | null = null;

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`${name} is not set; required for query_governance_standards`);
  }
  return v;
}

function l2Normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

/**
 * Parse HF Inference API responses: pooled vector, token matrices, or batched.
 */
function flattenToEmbedding(data: unknown): number[] {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Embedding API returned empty or non-array body");
  }
  const first = data[0];
  if (typeof first === "number") {
    return data as number[];
  }
  if (Array.isArray(first)) {
    const rows = data as number[][];
    const dim = rows[0].length;
    const out = new Array(dim).fill(0);
    for (const row of rows) {
      for (let i = 0; i < dim; i++) out[i] += row[i] ?? 0;
    }
    for (let i = 0; i < dim; i++) out[i] /= rows.length;
    return out;
  }
  throw new Error("Unexpected embedding response shape from Hugging Face API");
}

/**
 * 384-d embeddings compatible with Xenova/all-MiniLM-L6-v2 ingest (same ST weights), without bundling @huggingface/transformers (too large for Vercel).
 */
async function embedQueryViaHuggingFaceApi(text: string): Promise<number[]> {
  const token = process.env.HUGGINGFACE_API_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "HUGGINGFACE_API_TOKEN is not set. Add a token from https://huggingface.co/settings/tokens — required for query_governance_standards on Vercel (serverless bundle cannot include the local Transformers.js model).",
    );
  }
  const model = process.env.HF_EMBEDDING_MODEL_ID?.trim() || DEFAULT_HF_MODEL;
  const url = `https://api-inference.huggingface.co/models/${model}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: text }),
  });
  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`Hugging Face embedding API ${res.status}: ${rawText.slice(0, 500)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    throw new Error("Hugging Face embedding API returned non-JSON");
  }
  const vector = l2Normalize(flattenToEmbedding(parsed));
  return vector;
}

/**
 * Lazily initializes Pinecone index handle (shared across tool calls). Embeddings use HF Inference API per request.
 */
export function ensureGovernanceStandardsClients(): Promise<GovernanceClients> {
  if (!clientsPromise) {
    clientsPromise = (async () => {
      const apiKey = requireEnv("PINECONE_API_KEY");
      const indexName = process.env.PINECONE_INDEX_NAME?.trim() || "project-vail-standards";
      const pc = new Pinecone({ apiKey });
      const index = pc.index(indexName);
      return { index, indexName };
    })();
  }
  return clientsPromise;
}

function metaString(m: Record<string, unknown> | undefined, key: string): string {
  if (!m || m[key] == null) return "";
  return String(m[key]);
}

function formatGovernanceResults(matches: GovernanceStandardsMatch[]): string {
  if (matches.length === 0) {
    return "No governance standards matched this query in Pinecone.";
  }
  const blocks: string[] = ["## Governance standards (ground truth)", ""];
  let i = 1;
  for (const m of matches) {
    const scoreLine = m.score != null ? ` (similarity score: ${m.score.toFixed(4)})` : "";
    blocks.push(`### ${i}${scoreLine}`);
    blocks.push(`**Source:** ${m.source || "(unknown)"}`);
    blocks.push("");
    blocks.push("**Text:**");
    blocks.push(m.text.trim() || "(no text in metadata)");
    blocks.push("");
    blocks.push("---");
    blocks.push("");
    i += 1;
  }
  return blocks.join("\n").trimEnd();
}

/**
 * Embeds the query (HF Inference API), runs top-3 Pinecone search, optional category metadata filter.
 */
export async function queryGovernanceStandards(options: {
  query: string;
  category?: string;
}): Promise<{ formatted: string; matches: GovernanceStandardsMatch[]; indexName: string }> {
  const query = options.query.trim();
  if (!query) {
    throw new Error("query must be a non-empty string");
  }

  const { index, indexName } = await ensureGovernanceStandardsClients();
  const vector = await embedQueryViaHuggingFaceApi(query);

  const category = options.category?.trim();
  const filter = category ? { category: { $eq: category } } : undefined;

  const res = await index.query({
    vector,
    topK: 3,
    includeMetadata: true,
    ...(filter ? { filter } : {}),
  });

  const matches: GovernanceStandardsMatch[] = (res.matches || []).map((rec) => {
    const md = (rec.metadata || {}) as Record<string, unknown>;
    const text = metaString(md, "text");
    const source = metaString(md, "source");
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(md)) {
      if (v != null) flat[k] = String(v);
    }
    return {
      score: rec.score,
      text,
      source,
      metadata: flat,
    };
  });

  return {
    formatted: formatGovernanceResults(matches),
    matches,
    indexName,
  };
}
