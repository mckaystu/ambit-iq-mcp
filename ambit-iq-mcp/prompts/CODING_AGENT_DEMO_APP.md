# Coding-agent prompt: simple demo app (certificate + report + Postgres)

Copy everything inside the block below into a new chat with your coding agent.

---

```text
You are implementing a minimal demo application in the Ambit.IQ MCP repository (or adjacent monorepo folder) that proves end-to-end governance output:

1. **HTML certificate** — produced via the Ambit MCP tool `audit_vibe`.
2. **PostgreSQL row** — produced via the Ambit MCP tool `log_vibe_transaction` (async tamper-evident chain).
3. **Markdown report** — produced via the Ambit MCP tool `generate_audit_report`, reading back rows keyed by `metadata.project_id`.

## Constraints

- Keep the solution **small** (one script or a tiny CLI package). Prefer **Node.js 20+**, ESM, and the existing **`@modelcontextprotocol/sdk`** client pattern (stdio transport) — same approach as `scripts/mcp-ci-smoke.mjs`.
- Do **not** reimplement policy logic; always go through the **MCP server** (`node dist/server.js` after `npm run build`, or `tsx src/server.ts` for local dev).
- Document required **environment variables** and **database migration**; never commit real secrets.

## Prerequisites (document in README snippet)

- `DATABASE_URL` — PostgreSQL (e.g. Neon), schema migrated with `migrations/001_ambit_decision_logs.sql` (or Prisma migrate if the project uses it).
- `AMBIT_SIGNING_KEY` — RSA private key PEM (required when `DATABASE_URL` is set, or `log_vibe_transaction` will error fail-secure and not persist).
- Optional: `AMBIT_VERIFYING_KEY` for `verify_audit_integrity` demos.
- Optional: `OPA_URL` / `OPA_POLICY_PATH` — only if testing OPA; otherwise omit.

## Demo flow the script must execute (in order)

1. **Build** (if using `dist/server.js`): run `npm run build` in the MCP package root.
2. **Connect** MCP stdio client to the server process.
3. **`audit_vibe`**  
   - Pass realistic `code` and `profileId` (e.g. `financial-services.eu`).  
   - Set `generateHtmlCertificate: true` and an explicit `certificateOutputPath` under `./reports/` (or `/tmp/...` if documented for serverless).  
   - Optionally set `logAuditTrail: true` to also write `.ambit/logs/` JSON+MD (filesystem, not Postgres).  
   - Capture the tool response (note: gate `blocked` may set `isError` on the MCP result — still expect certificate path in text if write succeeded).
4. **`log_vibe_transaction`**  
   - Required: `actor_id`, `intent_prompt`, `proposed_code`.  
   - Set `profile_id` to match the audit.  
   - Set `metadata.project_id` to a **fixed demo id** (e.g. `demo-governance-app`) — this is how `generate_audit_report` filters rows.  
   - Optional: `trace_id` UUID for correlation.  
   - If the tool returns a persistence configuration error (DB without signing key), print it clearly and exit non-zero.
5. **Wait** for async persistence: sleep **2–5 seconds** (or retry `get_compliance_history` with a short backoff) because Postgres writes are **non-blocking**.
6. **`generate_audit_report`**  
   - `project_id`: same value as `metadata.project_id`.  
   - `hours`: e.g. `24`.  
   - Save returned Markdown to `./reports/demo-audit-report.md` (or print to stdout + optional file).
7. **Exit criteria**  
   - Confirm certificate file exists on disk.  
   - Confirm report contains at least one row or explain empty (e.g. DENY filter in `get_compliance_history` vs report — document that `generate_audit_report` lists all decisions in window, not only DENY).  
   - Print absolute paths and a one-line “success” summary.

## Deliverables

- **Separate test app** (e.g. sibling package `ambit-governance-e2e-demo`): own `package.json`, `npm run demo`, script under `scripts/demo-governance-e2e.mjs`, `AMBIT_MCP_ROOT` pointing at `ambit-iq-mcp`.
- Short comment header in the script listing env vars and migration file path.
- No production deployment; local demo only.

## Acceptance checks

- `npm run build` succeeds in **ambit-iq-mcp**.  
- `npm run demo` in the test app exits 0 when env is configured.  
- After run: certificate HTML exists, `demo-audit-report.md` exists, and Postgres has a new row in `ambit_decision_logs` for the demo `project_id` (optional: mention how to verify with `psql` or Prisma Studio).

Implement now; keep the diff focused on the demo script, package.json script entry, and minimal README notes if needed.
```

---

## Tool reference (for humans)

| Goal            | MCP tool                 | Notes |
|----------------|--------------------------|--------|
| Certificate    | `audit_vibe`             | `certificateOutputPath`, `generateHtmlCertificate` |
| Postgres log   | `log_vibe_transaction`   | Needs `DATABASE_URL` + `AMBIT_SIGNING_KEY`; `metadata.project_id` for reports |
| Markdown report | `generate_audit_report` | `project_id` must match logged metadata |
