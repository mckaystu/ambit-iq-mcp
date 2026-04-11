/**
 * Vercel may require outputDirectory "public" to exist after `npm run build`.
 * Ensures public/index.html exists even if the folder was missing from git.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const indexHtml = join(publicDir, "index.html");

const fallback = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/><title>Ambit.IQ MCP</title></head>
<body><h1>Ambit.IQ MCP</h1><p>HTTP MCP: <code>/mcp</code></p></body>
</html>
`;

mkdirSync(publicDir, { recursive: true });
if (!existsSync(indexHtml)) {
  writeFileSync(indexHtml, fallback, "utf8");
  console.log("ensure-public-output: wrote fallback public/index.html");
} else {
  console.log("ensure-public-output: public/index.html ok");
}
