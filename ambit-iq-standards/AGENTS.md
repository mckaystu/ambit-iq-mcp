# Agent instructions — Ambit.IQ

You are helping with **Ambit.IQ**: governance-oriented tooling (MCP tools, optional OPA, Postgres-backed decision logs, HTML certificates, audit trails).

## Source of truth

- **MCP server and deploy shape:** the `ambit-iq-mcp` project (sibling to this repo). Prefer reading that README and `src/` before guessing tool contracts or env vars.
- **Secrets:** never commit `DATABASE_URL`, `AMBIT_SIGNING_KEY`, `MCP_AUTH_TOKEN`, or PEM files. Use `.env.example` patterns from the MCP repo.

## Architecture reminders

- **Stdio (Cursor local):** built from `dist/stdio-mcp.js` / `src/stdio-mcp.ts`. Do not route local stdio through the Vercel HTTP entrypoint.
- **Vercel:** HTTP handler and `api/mcp.js` path; static site from `public/`. Follow existing entrypoint layout—do not introduce conflicting root `index.js` or wrong `package.json` `main` for that deploy shape.
- **GRC persistence:** `log_vibe_transaction` and related tools expect migrations applied (`ambit_decision_logs`, hash chain). Unsigned or half-configured DB setups should degrade gracefully per existing code; do not remove fallback behavior without an explicit product decision.

## Coding style

- Match TypeScript and file layout already used in `ambit-iq-mcp`.
- Keep MCP tool schemas and responses backward compatible unless the user requests a breaking version bump.
- When adding policy or compliance behavior, document new env vars in `.env.example` and the MCP README.

## When using Ambit MCP from the IDE

If the user’s Cursor session has the Ambit.IQ MCP server enabled, prefer **`audit_vibe`** / profile listing tools for policy checks on proposed code, and logging tools when the user wants an audit trail or compliance history—rather than inventing parallel checks.
