import "dotenv/config";
import { pipeline } from "@huggingface/transformers";
import { Pinecone } from "@pinecone-database/pinecone";

const apiKey = process.env.PINECONE_API_KEY;
if (!apiKey) {
  console.error("Missing PINECONE_API_KEY. Copy .env.example to .env and set it.");
  process.exit(1);
}

const INDEX_NAME = "ambit-iq-standards";

const pc = new Pinecone({ apiKey });
const index = pc.index(INDEX_NAME);

const standards = [
  {
    id: "std_001",
    text: "All Vite components must use functional definitions and Shorthand Property Names.",
    metadata: { category: "syntax", tooling: "vite", language: "typescript" },
  },
];

async function runIngestion() {
  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

  for (const std of standards) {
    const output = await extractor(std.text, { pooling: "mean", normalize: true });
    const data = output.data;
    if (!data) {
      throw new Error("Unexpected model output: missing .data");
    }
    const vector = Array.from(data as Iterable<number>);

    await index.upsert([
      {
        id: std.id,
        values: vector,
        metadata: std.metadata,
      },
    ]);
  }

  console.log(`✅ Standards ingested into ${INDEX_NAME}`);
}

runIngestion().catch((err) => {
  console.error(err);
  process.exit(1);
});
