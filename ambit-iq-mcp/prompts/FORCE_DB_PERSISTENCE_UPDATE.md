# Prompt: force Ambit decision log to hit Postgres (Vercel + Neon)

Copy everything inside the block below into a new chat with your coding agent (or follow it yourself).

---

```text
Goal: Produce at least one new row in PostgreSQL table `ambit_decision_logs` for project `vercel-test` (or a named `metadata.project_id` I specify), and prove it with SQL.

Constraints:
- The running MCP must be the latest code path that AWAITS persistence (`persistVibeDecision` / tool response shows `persistence: "inserted_postgres"` or explicit `wrote_fallback` + `persist_error` — not `scheduled_async_non_blocking`).
- Do not print secrets (DATABASE_URL, AMBIT_SIGNING_KEY, MCP_AUTH_TOKEN) in chat; redact in logs.

Do this in order:

1. **Repo / deploy**
   - Confirm `ambit-iq-mcp` includes awaited `log_vibe_transaction` persistence (handlers await `persistVibeDecision`; no fire-and-forget).
   - If the deployed Vercel app is behind, deploy to production from this repo (`vercel --prod` or Git push), then wait until the deployment is live.

2. **Vercel env (DATABASE_URL)**
   - Use Neon **direct** connection string (hostname WITHOUT `-pooler`) for `DATABASE_URL` if pooled URL still fails transactions.
   - Remove `channel_binding=require` from `DATABASE_URL`; keep `sslmode=require` only unless Neon docs require more.
   - Optional: append `?connect_timeout=15` if needed; do not add unsupported params blindly.

3. **Schema**
   - On the SAME database as `DATABASE_URL`, ensure migrations ran: `001_ambit_decision_logs.sql` then `002_integrity_hash_chain.sql` (or `npx prisma db push` from this package).
   - If `SELECT log_hash FROM ambit_decision_logs ORDER BY timestamp DESC LIMIT 1` returns a row with NULL `log_hash`, fix chain head (truncate table if acceptable, or backfill) before testing inserts.

4. **Force a write via MCP**
   - Call tool `log_vibe_transaction` with:
     - `actor_id`: `force-db-prompt`
     - `intent_prompt`: `forced persistence verification`
     - `proposed_code`: `export const FORCE_DB_WRITE = true;\n`
     - `profile_id`: `baseline.global`
     - `metadata`: `{ "project_id": "vercel-test" }`
   - Record the exact tool JSON: `persistence`, and any `persist_error` / `fallback_path`.

5. **Verify in Neon SQL Editor** (same branch DB as Vercel `DATABASE_URL`)
   ```sql
   SELECT id, actor_id, metadata->>'project_id' AS project_id, decision,
          log_hash IS NOT NULL AS has_chain, timestamp
   FROM ambit_decision_logs
   WHERE actor_id = 'force-db-prompt'
      OR metadata->>'project_id' = 'vercel-test'
   ORDER BY timestamp DESC
   LIMIT 10;
   ```
   - Success = at least one row with `has_chain` true (after 002) for this actor or project_id.

6. **If still empty**
   - Read Vercel function logs for `[ambit-iq-mcp] log_vibe_transaction`.
   - If tool returns `wrote_fallback` + `db_integrity_persist_failed`, fix the error string (pooler, PEM, schema, advisory lock).
   - Confirm `AMBIT_SIGNING_KEY` in Vercel is one-line PEM with `\n` for newlines if stored as a single env value.

Deliverable: one sentence stating whether a row appeared, plus the `persistence` field from the tool response (no secrets).
```

---

## One-liner for a human (Cursor chat) after MCP is connected

> Call MCP tool `log_vibe_transaction` with arguments: `actor_id` = `force-db-prompt`, `intent_prompt` = `forced persistence verification`, `proposed_code` = `export const FORCE_DB_WRITE = true;\n`, `profile_id` = `baseline.global`, `metadata` = `{"project_id":"vercel-test"}`. Then tell me the value of `persistence` in the response and whether I should run the SQL in step 5 above.
