/**
 * Vercel entry — delegates to compiled TypeScript handler.
 * Build: npm run build (outputs dist/http-mcp.js)
 *
 * maxDuration: longest allowed per invocation on Vercel (plan-dependent).
 * Streamable MCP may hold GET/SSE open; the platform will still stop at this limit.
 */
export const config = {
  maxDuration: 300,
};

export { default } from "../dist/http-mcp.js";
