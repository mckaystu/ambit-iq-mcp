import { getCurrentUser } from "./_auth.js";
import { withRateLimit } from "./_security.js";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  const user = getCurrentUser(req);
  if (!user) return sendJson(res, 401, { error: "Unauthorized" });
  return sendJson(res, 200, { user });
}

export default withRateLimit(handler, { max: 300, windowMs: 60_000 });
