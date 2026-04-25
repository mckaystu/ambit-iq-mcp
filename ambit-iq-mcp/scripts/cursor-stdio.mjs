/**
 * Local stdio MCP entry for Cursor (run after `npm run build`).
 * Do not use a root index.js — Vercel treats that as a serverless entry and crashes (no default export).
 */
import "../dist/stdio-mcp.js";
