import crypto from "node:crypto";

const ROLE_PERMISSIONS = {
  admin: ["*"],
  exec: ["view.executive", "view.governance", "view.incidents", "view.interactions", "export.reports"],
  security: ["view.incidents", "view.interactions", "view.governance", "export.reports", "view.executive"],
  developer: ["view.executive"],
  auditor: ["view.executive", "view.incidents", "view.interactions", "view.governance", "export.reports"],
};

function b64urlDecode(input) {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replaceAll("-", "+").replaceAll("_", "/") + pad, "base64");
}

function constantTimeEqual(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function verifyJwtHs256(token, secret) {
  const [h, p, s] = String(token || "").split(".");
  if (!h || !p || !s) return null;
  try {
    const header = JSON.parse(b64urlDecode(h).toString("utf8"));
    // Reject tokens that do not explicitly use HS256.
    if (String(header?.alg || "") !== "HS256") return null;
    const msg = `${h}.${p}`;
    const sig = crypto.createHmac("sha256", secret).update(msg).digest("base64url");
    if (!constantTimeEqual(sig, s)) return null;
    const payload = JSON.parse(b64urlDecode(p).toString("utf8"));
    if (payload.exp && Date.now() / 1000 > Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

function toUser(payload = {}) {
  const role = String(payload.role || payload.roles?.[0] || process.env.AMBIT_DEV_USER_ROLE || "admin");
  const roles = Array.isArray(payload.roles) ? payload.roles.map(String) : [role];
  const derivedPermissions = roles.flatMap((r) => ROLE_PERMISSIONS[String(r).toLowerCase()] || []);
  return {
    id: String(payload.sub || payload.id || "dev-user"),
    email: String(payload.email || process.env.AMBIT_DEV_USER_EMAIL || "admin@example.com"),
    name: String(payload.name || "Local Admin"),
    tenant_id: payload.tenant_id ? String(payload.tenant_id) : null,
    roles,
    permissions: Array.from(new Set([...(Array.isArray(payload.permissions) ? payload.permissions.map(String) : []), ...derivedPermissions])),
  };
}

export function getCurrentUser(req) {
  const mode = String(process.env.AMBIT_AUTH_MODE || "off").toLowerCase();
  if (mode === "off") {
    return toUser({ role: "admin", email: "off-mode@example.com" });
  }
  if (mode === "local") {
    return toUser({
      role: process.env.AMBIT_DEV_USER_ROLE || "admin",
      email: process.env.AMBIT_DEV_USER_EMAIL || "admin@example.com",
      tenant_id: process.env.AMBIT_DEV_TENANT_ID || null,
    });
  }
  const auth = String(req.headers.authorization || "");
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) {
    // Dev-friendly fallback for browser requests when JWT mode is enabled but no bearer is present.
    // This keeps local dashboard UX working while still allowing strict JWT in production.
    const host = String(req.headers.host || "");
    const isLocalHost = host.includes("localhost") || host.includes("127.0.0.1");
    const allowLocalFallback =
      String(process.env.AMBIT_AUTH_ALLOW_LOCAL_FALLBACK || "").toLowerCase() === "1" ||
      String(process.env.AMBIT_AUTH_ALLOW_LOCAL_FALLBACK || "").toLowerCase() === "true" ||
      process.env.NODE_ENV !== "production";
    if (allowLocalFallback && isLocalHost) {
      return toUser({
        role: process.env.AMBIT_DEV_USER_ROLE || "admin",
        email: process.env.AMBIT_DEV_USER_EMAIL || "admin@example.com",
        tenant_id: process.env.AMBIT_DEV_TENANT_ID || null,
      });
    }
    return null;
  }
  const secret = String(process.env.AMBIT_JWT_SECRET || "");
  if (!secret) return null;
  const payload = verifyJwtHs256(m[1], secret);
  if (!payload) return null;
  return toUser(payload);
}

export function hasPermission(user, permission) {
  if (!user) return false;
  if (user.permissions.includes("*")) return true;
  return user.permissions.includes(permission);
}

export function requireRole(req, roles) {
  const user = getCurrentUser(req);
  if (!user) {
    const err = new Error("Unauthorized");
    err.statusCode = 401;
    throw err;
  }
  const allowed = new Set((roles || []).map((r) => String(r).toLowerCase()));
  if (user.roles.some((r) => allowed.has(String(r).toLowerCase())) || user.roles.some((r) => String(r).toLowerCase() === "admin")) {
    return user;
  }
  const err = new Error("Forbidden");
  err.statusCode = 403;
  throw err;
}

export function requireAuth(req) {
  const user = getCurrentUser(req);
  if (!user) {
    const err = new Error("Unauthorized");
    err.statusCode = 401;
    throw err;
  }
  return user;
}
