#!/usr/bin/env node
/**
 * Smoke test: same URL resolution + library-entries parsing as api/libraries/discover.ts
 * Usage:
 *   node scripts/verify-wcm-discovery.mjs
 *   DX_BASE_URL=https://host/hcl/dx/tenant node scripts/verify-wcm-discovery.mjs
 * Optional Basic auth:
 *   DX_USER=u DX_PASS=p node scripts/verify-wcm-discovery.mjs
 */
function resolveDxUrl(base, rawPath) {
  const path = rawPath.trim();
  if (!path) return base.toString();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (/^\/dx\/api\//i.test(normalized)) {
    return new URL(normalized, base.origin).toString();
  }
  if (/^\/hcl\/mycontenthandler\//i.test(normalized)) {
    return new URL(normalized, base.origin).toString();
  }
  const basePath = base.pathname.replace(/\/+$/, "");
  if (basePath && basePath !== "/" && /^\/(?:dx|wps|hcl)\//i.test(normalized)) {
    return new URL(`${basePath}${normalized}`, base.origin).toString();
  }
  return new URL(normalized, base).toString();
}

function parseLibraryEntriesWcmRest(payload) {
  if (!payload || typeof payload !== "object") return [];
  const root = payload;
  const entries = root["library-entries"];
  if (!Array.isArray(entries)) return [];
  const labels = [];
  for (const item of entries) {
    if (!item || typeof item !== "object") continue;
    const o = item;
    if (String(o.type || "") !== "Library") continue;
    let title = "";
    if (typeof o.displayTitle === "string") title = o.displayTitle.trim();
    else if (typeof o.title === "string") title = o.title.trim();
    else if (o.title && typeof o.title === "object") {
      const t = o.title;
      if (typeof t.value === "string") title = t.value.trim();
    }
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const label = title || name;
    if (label) labels.push(label);
  }
  return [...new Set(labels)];
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const baseUrl =
  process.env.DX_BASE_URL ||
  "https://riesen-dev-latest.team-q-dev.com/hcl/dx/nexHaven";
const path =
  process.env.DX_WCM_LIBRARIES_PATH ||
  "/hcl/mycontenthandler/wcmrest-v2/libraries";

const fixturePath = join(__dirname, "fixtures", "wcm-libraries-sample.json");

function assertParse(labels) {
  const want = ["Web Content", "Design Library"];
  const missing = want.filter((w) => !labels.includes(w));
  if (missing.length) {
    console.error("Fixture parse mismatch, missing:", missing.join(", "));
    process.exit(1);
  }
}

async function main() {
  const useFixture = process.argv.includes("--fixture");

  if (useFixture) {
    const payload = JSON.parse(readFileSync(fixturePath, "utf8"));
    const labels = parseLibraryEntriesWcmRest(payload);
    console.log("mode: --fixture", fixturePath);
    console.log("parsed Library labels:", labels.length, labels);
    assertParse(labels);
    console.log("OK");
    return;
  }

  const base = new URL(baseUrl);
  const target = resolveDxUrl(base, path);
  const headers = {
    Accept: "application/json",
    "User-Agent": "DX.IQ-verify-wcm-discovery/1.0"
  };
  const u = process.env.DX_USER;
  const p = process.env.DX_PASS;
  if (u && p) {
    headers.Authorization =
      "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
  }

  console.log("baseUrl:", baseUrl);
  console.log("resolved GET:", target);

  const r = await fetch(target, { method: "GET", headers, redirect: "follow" });
  const text = await r.text();
  console.log("status:", r.status, "content-type:", r.headers.get("content-type") || "");

  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    console.error(
      "Response was not JSON (often 401 HTML). Set DX_USER/DX_PASS or run: node scripts/verify-wcm-discovery.mjs --fixture"
    );
    console.error("body preview:", text.slice(0, 200));
    process.exit(1);
  }

  const labels = parseLibraryEntriesWcmRest(payload);
  const total = payload.total;
  const entries = payload["library-entries"];
  console.log("payload.total:", total, "library-entries length:", Array.isArray(entries) ? entries.length : 0);
  console.log("parsed Library labels:", labels.length);
  console.log("sample:", labels.slice(0, 8).join(" | "));

  if (r.ok && labels.length === 0) {
    console.error("Expected some libraries from WCM REST JSON.");
    process.exit(1);
  }
  if (!r.ok) {
    console.error("Request failed (auth or network).");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
