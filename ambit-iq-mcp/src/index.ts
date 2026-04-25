/**
 * Vercel’s Node preset scans for a conventional entry file (e.g. src/index.ts).
 * This re-exports the Streamable HTTP MCP handler only — not stdio (`stdio-mcp.ts`).
 */
export { default } from "./http-mcp.js";
