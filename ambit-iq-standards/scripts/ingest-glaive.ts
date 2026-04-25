import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pipeline } from "@huggingface/transformers";
import { Pinecone } from "@pinecone-database/pinecone";

const apiKeyRaw = process.env.PINECONE_API_KEY?.trim();
if (!apiKeyRaw) {
  console.error("Missing PINECONE_API_KEY. Set it in .env (see .env.example).");
  process.exit(1);
}
const apiKey = apiKeyRaw;

const INDEX_NAME = process.env.PINECONE_INDEX_NAME?.trim() || "ambit-iq-standards";
/** Pinecone metadata payload limit is ~40KB; keep headroom for other fields. */
const METADATA_TEXT_MAX = 30_000;
const METADATA_QUESTION_MAX = 8_000;
/** Set to `1` to match one-off scripts: `glaive-${Date.now()}-${random}` (re-runs create duplicates). */
const USE_RANDOM_IDS = process.env.GLAIVE_USE_RANDOM_IDS === "1";
/** Set to `1` to store untruncated `text` / `synthetic_query` (upsert fails if metadata exceeds ~40KB). */
const FULL_METADATA = process.env.GLAIVE_FULL_METADATA === "1";

type GlaiveDoc = { text?: string };
type GlaiveItem = {
  question?: string;
  documents?: GlaiveDoc[];
};

function stableVectorId(question: string, fullText: string): string {
  const h = createHash("sha256")
    .update(question, "utf8")
    .update("\0", "utf8")
    .update(fullText.slice(0, 50_000), "utf8")
    .digest("hex");
  return `glaive-${h}`;
}

function vectorId(question: string, fullText: string): string {
  if (USE_RANDOM_IDS) {
    return `glaive-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  }
  return stableVectorId(question, fullText);
}

function clampMeta(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

function parseGlaiveJson(raw: string): GlaiveItem[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Expected a JSON array of Glaive records at the top level.");
  }
  return parsed as GlaiveItem[];
}

async function ingestGlaive(filePath: string) {
  const raw = await readFile(filePath, "utf8");
  const rawData = parseGlaiveJson(raw);

  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  const pc = new Pinecone({ apiKey });
  const index = pc.index(INDEX_NAME);

  const batchSize = 50;
  let batch: Array<{ id: string; values: number[]; metadata: Record<string, string> }> = [];
  let ok = 0;
  let skipped = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    await index.upsert(batch);
    ok += batch.length;
    batch = [];
  };

  for (let i = 0; i < rawData.length; i++) {
    const item = rawData[i];
    const docs = Array.isArray(item.documents) ? item.documents : [];
    const fullText = docs
      .map((d) => (d && typeof d.text === "string" ? d.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();

    if (!fullText) {
      skipped += 1;
      continue;
    }

    const question = typeof item.question === "string" ? item.question : "";
    const output = await extractor(fullText, { pooling: "mean", normalize: true });
    const data = output.data;
    if (!data) {
      throw new Error(`Unexpected model output (missing .data) at index ${i}`);
    }
    const vector = Array.from(data as Iterable<number>);

    const id = vectorId(question, fullText);
    batch.push({
      id,
      values: vector,
      metadata: {
        text: FULL_METADATA ? fullText : clampMeta(fullText, METADATA_TEXT_MAX),
        source: "glaive-ai-rag-v1",
        category: "synthetic-reasoning",
        synthetic_query: FULL_METADATA ? question : clampMeta(question, METADATA_QUESTION_MAX),
      },
    });

    if (batch.length >= batchSize) {
      await flush();
      console.log(`Upserted ${ok} / ${rawData.length}…`);
    }
  }

  await flush();

  console.log(
    `✅ Glaive ingest finished: ${ok} vectors upserted to "${INDEX_NAME}" (${skipped} skipped with no document text).`,
  );
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npx tsx scripts/ingest-glaive.ts <path-to-glaive.json>");
  console.error("Expects a JSON array of { question?, documents: [{ text }] }.");
  process.exit(1);
}

ingestGlaive(filePath).catch((err) => {
  console.error(err);
  process.exit(1);
});
