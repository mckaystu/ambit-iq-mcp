import "dotenv/config";
import { createHash } from "node:crypto";
import Firecrawl from "@mendable/firecrawl-js";
import { pipeline } from "@huggingface/transformers";
import { Pinecone } from "@pinecone-database/pinecone";

const firecrawlKey = process.env.FIRECRAWL_API_KEY;
const pineconeKey = process.env.PINECONE_API_KEY;
if (!firecrawlKey || !pineconeKey) {
  console.error("Set FIRECRAWL_API_KEY and PINECONE_API_KEY in .env (see .env.example).");
  process.exit(1);
}

const INDEX_NAME = "ambit-iq-standards";
const PINECONE_ID_MAX = 512;

const app = new Firecrawl({ apiKey: firecrawlKey });
const pc = new Pinecone({ apiKey: pineconeKey });
const index = pc.index(INDEX_NAME);

function vectorIdForUrl(url: string): string {
  const b64 = Buffer.from(url, "utf8").toString("base64");
  if (b64.length <= PINECONE_ID_MAX) return b64;
  return createHash("sha256").update(url).digest("hex");
}

async function scrapeAndIngest(url: string, category: string, tooling: string) {
  const crawlResponse = await app.crawl(url, {
    limit: 10,
    scrapeOptions: { formats: ["markdown"] },
  });

  if (crawlResponse.status !== "completed") {
    throw new Error(`Crawl did not complete: status=${crawlResponse.status}`);
  }

  const pages = crawlResponse.data ?? [];
  if (pages.length === 0) {
    console.warn("No pages returned from crawl.");
    return;
  }

  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

  for (const page of pages) {
    const markdown = page.markdown?.trim();
    if (!markdown) continue;

    const pageUrl = page.metadata?.sourceURL ?? page.metadata?.url;
    if (!pageUrl) {
      console.warn("Skipping document with no source URL in metadata.");
      continue;
    }

    const output = await extractor(markdown, { pooling: "mean", normalize: true });
    const data = output.data;
    if (!data) throw new Error("Unexpected model output: missing .data");
    const vector = Array.from(data as Iterable<number>);

    const snippet = markdown.slice(0, 1000);

    await index.upsert([
      {
        id: vectorIdForUrl(pageUrl),
        values: vector,
        metadata: {
          text: snippet,
          source: pageUrl,
          category,
          tooling,
          last_updated: new Date().toISOString(),
        },
      },
    ]);
  }

  console.log(`Successfully ingested ${category} from ${url} (${pages.length} page(s) processed)`);
}

const startUrl = process.argv[2] ?? "https://vitejs.dev/guide/performance.html";
const category = process.argv[3] ?? "performance";
const tooling = process.argv[4] ?? "vite";

scrapeAndIngest(startUrl, category, tooling).catch((err) => {
  console.error(err);
  process.exit(1);
});
