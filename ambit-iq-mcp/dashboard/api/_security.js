const RATE_STATE = globalThis.__ambitRateState || new Map();
globalThis.__ambitRateState = RATE_STATE;

function keyFor(req) {
  return `${req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown"}:${req.url || ""}`;
}

export function applySecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", "no-store");
}

export function withRateLimit(handler, opts = {}) {
  const max = Number(opts.max || 120);
  const windowMs = Number(opts.windowMs || 60_000);
  return async (req, res) => {
    applySecurityHeaders(res);
    const k = keyFor(req);
    const now = Date.now();
    const row = RATE_STATE.get(k) || { count: 0, resetAt: now + windowMs };
    if (now > row.resetAt) {
      row.count = 0;
      row.resetAt = now + windowMs;
    }
    row.count += 1;
    RATE_STATE.set(k, row);
    if (row.count > max) {
      res.statusCode = 429;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ error: "Rate limit exceeded" }));
    }
    return handler(req, res);
  };
}

export function safeJson(req, options = {}) {
  const limitBytes = Number(options.limitBytes || 512 * 1024);
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) {
        const err = new Error("Payload too large");
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        const err = new Error("Invalid JSON");
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
