import Redis from "ioredis";

let redisClient: Redis | null = null;

function attachQuietErrorHandlers(client: Redis): void {
  client.on("error", () => {
    // Prevents Node "Unhandled error event" spam when Falkor/Redis is down or resets the socket.
  });
  client.on("close", () => {
    redisClient = null;
  });
}

export function resetRedisClient(): void {
  if (!redisClient) return;
  try {
    redisClient.disconnect(false);
  } catch {
    // ignore
  }
  redisClient = null;
}

export function getRedis(): Redis {
  if (redisClient) return redisClient;
  const redisUrl = process.env.FALKOR_REDIS_URL?.trim();
  if (!redisUrl) throw new Error("FALKOR_REDIS_URL is not configured");
  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy() {
      return null;
    }
  });
  attachQuietErrorHandlers(redisClient);
  return redisClient;
}

export async function graphQuery(query: string): Promise<any[]> {
  const r = getRedis();
  const graph = process.env.FALKOR_GRAPH_NAME?.trim() || "dxiq";
  try {
    const raw = (await r.call("GRAPH.QUERY", graph, query, "--compact")) as any[];
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    resetRedisClient();
    throw err;
  }
}

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}
