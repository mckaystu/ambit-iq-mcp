# Ambit.IQ MCP

Policy-style checks exposed as MCP tools, now with profile-based governance.

## Tools

- `audit_vibe`:
  - Input: `code` (required), `profileId` (optional)
  - HTML certificate: written on every audit by default (`reports/ambit-iq-certificate-<profile>.html`). Pass `generateHtmlCertificate: false` to skip.
  - Optional certificate metadata / path:
    - `appName`
    - `targetEnvironment`
    - `certificateOutputPath` (optional absolute/relative path)
  - Profiles:
    - `baseline.global`
    - `financial-services.eu`
    - `healthcare.us`
- `list_vibe_profiles`: list available policy profiles.
- `list_vibe_rules`: list active rules for a profile.
- `log_audit_trail`:
  - Input schema:
    - `user_prompt` (string)
    - `agent_reasoning` (string)
    - `ambit_results` (object)
    - `metadata` (object: `model_version`, `timestamp`, `git_branch`)
  - Persists structured provenance logs to `.ambit/logs/*.json`
  - Returns a Markdown summary suitable for PR comments
- **Phase 2 — GRC persistence & OPA-shaped decisions**
  - `log_vibe_transaction`: evaluate `proposed_code` + `intent_prompt` (OPA REST when `OPA_URL` is set; otherwise Ambit policy bridge), then **persist** to PostgreSQL (`ambit_decision_logs`) before returning (needed on Vercel), or JSON fallback if `DATABASE_URL` is unset or the insert fails (local: `.ambit/grc-fallback/`; Vercel: `/tmp/ambit-iq-grc-fallback/`). Sensitive strings in `raw_opa_payload` are masked before storage.
  - `get_compliance_history`: last DENY rows, optional `actor_id` / `violation_type` filter (parameterized SQL).
  - `generate_audit_report`: Markdown “Software Bill of Intent” for `metadata.project_id` over the last N hours (default 24).
  - `verify_audit_integrity`: Recompute hashes, validate the chain (`previous_hash` ↔ prior `log_hash`), and verify RSA signatures (`AMBIT_VERIFYING_KEY`). Returns **Clean**, **Tamper Alert**, or **Skipped** (no database).

## Database (Phase 2)

1. Copy `.env.example` → `.env` and set **`DATABASE_URL`** (do not commit secrets).
2. Apply schema to Neon/Postgres: run **`migrations/001_ambit_decision_logs.sql`**, then **`migrations/002_integrity_hash_chain.sql`** (or a single `npx prisma db push` against that database). Skipping **002** causes Prisma errors (`previous_hash` missing) for `verify_audit_integrity`, `generate_audit_report`, and inserts that include the hash chain.
3. Optional: run Open Policy Agent and set **`OPA_URL`** (e.g. `http://localhost:8181`) and **`OPA_POLICY_PATH`** (default `data.ambit.decision` → `POST /v1/data/ambit/decision` with body `{"input":{...}}`).
4. **Signing and verification:** when **`DATABASE_URL`** is set, **`AMBIT_SIGNING_KEY`** (RSA private PEM, use `\n` for newlines in env) is **required** for `log_vibe_transaction` to persist; each row stores `previous_hash`, `log_hash`, and `signature`. Concurrent writers are serialized with `pg_advisory_xact_lock` + `SELECT … FOR UPDATE` on the chain head. Set **`AMBIT_VERIFYING_KEY`** for `verify_audit_integrity` to check signatures. Generate keys with `openssl genrsa 2048` / `openssl rsa -pubout`.

### Troubleshooting: no rows in `ambit_decision_logs`

If Postgres stays empty after `log_vibe_transaction`, the tool response now includes **`persistence`** (`inserted_postgres` vs `wrote_fallback`) and optional **`fallback_path`** / **`persist_error`**.

1. **MCP / Vercel env** — The server only sees variables on **its** process. **Cursor:** `DATABASE_URL` + `AMBIT_SIGNING_KEY` in `mcp.json` `env`. **Vercel:** the same keys in the project **Environment Variables** UI. `log_vibe_transaction` **awaits** the DB write so serverless is not frozen before Prisma finishes.
2. **Fallback files** — Local stdio: **`$MCP_ROOT/.ambit/grc-fallback/`**. **Vercel:** **`/tmp/ambit-iq-grc-fallback/`** (ephemeral; you will not see it in the repo). JSON `"reason": "no_database_url"` means the deployment never got `DATABASE_URL`; `"db_integrity_persist_failed"` includes `"error"`.
3. **Schema / chain head** — Apply **`002_integrity_hash_chain.sql`** (or `prisma db push`). If the **latest** row has **`log_hash` NULL**, new inserts fail until you truncate or backfill. Use a Neon **direct** (non-pooled) `DATABASE_URL` if interactive transactions fail through the pooler.
4. **Server stderr** — Postgres failures log **`[ambit-iq-mcp] log_vibe_transaction:`** (see **Vercel → Functions → Logs**).

Quick check:

```sql
SELECT id, timestamp, actor_id, decision, log_hash IS NOT NULL AS has_hash
FROM ambit_decision_logs
ORDER BY timestamp DESC
LIMIT 5;
```

## Local (stdio, Cursor)

```bash
npm install
npm run build
npm start
```

Point Cursor at **`dist/server.js`** with `node`, or use **`index.js`** (re-exports `dist/server.js` after build). For iterative work: `npm run dev` (tsx).

Set **`DATABASE_URL`** and **`MCP_AUTH_TOKEN`** (Vercel) as required for your deployment.

## Vercel (Streamable HTTP)

Deploy from this project folder:

```bash
npx vercel
```

- MCP URL:
  - `https://<deployment>.vercel.app/mcp` (recommended)
  - `https://<deployment>.vercel.app/api/mcp` (direct function path)

### Authentication (recommended for production)

The HTTP MCP endpoint enforces bearer auth in `api/mcp.js`.

1. Set Vercel environment variable:
   - `MCP_AUTH_TOKEN=<strong-random-token>`
2. Send header from client on every request:
   - `Authorization: Bearer <MCP_AUTH_TOKEN>`

Notes:
- `OPTIONS` preflight remains open for CORS.
- If `MCP_AUTH_TOKEN` is missing, server returns `500` (misconfiguration).
- If token is invalid/missing, server returns `401`.

### Vercel build: “No Output Directory named public”

This app is **serverless** (`api/mcp.js`) plus a tiny static `public/` folder. In the Vercel project:

1. **Settings → General → Framework Preset:** choose **Other** (not Vite/CRA/Next static).
2. **Settings → General → Build & Output:** set **Build Command** to `npm run build` (or leave default; `vercel.json` sets it).
3. **Output Directory:** leave **empty** unless you intentionally use static export. If Vercel still requires `public`, the repo includes `public/index.html` so that folder exists after build.

### Runtime timeout (`Task timed out after 300 seconds`)

Streamable HTTP MCP often keeps a **GET** (SSE / long-lived stream) open. **Vercel Serverless** enforces a **maximum duration per invocation** (commonly **300s** on Pro; Hobby is lower). When the limit is hit, Vercel logs **Runtime Timeout** even if the client had **200** earlier.

- **Expected:** long sessions may disconnect; the MCP client should **reconnect** automatically. If Cursor misbehaves after ~5 minutes, **reload MCP** or use **local stdio** (`node dist/server.js`) for heavy sessions.
- **Need always-on / no hard cap:** run the same app on **Fly.io**, **Railway**, **Render**, or a small **VPS** (long-running Node), not Vercel serverless.
- This repo sets **`maxDuration`: 300** for `api/mcp.js` (`vercel.json` + `export const config` in `api/mcp.js`) so the route uses the longest duration your plan allows.

## Policy Framework Scaffold

This repo includes starter policy artifacts for governance-at-scale:

- Schemas:
  - `policies/schemas/rule.schema.json`
  - `policies/schemas/profile.schema.json`
- Catalogs:
  - `policies/catalogs/quality-baseline.json`
  - `policies/catalogs/corporate-ux.json`
  - `policies/catalogs/regulatory-financial-eu.json`
  - `policies/catalogs/regulatory-healthcare-us.json`
- Profiles:
  - `policies/profiles/baseline.global.json`
  - `policies/profiles/financial-services.eu.json`
  - `policies/profiles/healthcare.us.json`

These files are starter examples for quality, UX, and regulatory packs (GDPR/DORA, HIPAA-aligned controls). Treat output as engineering control signals, not legal certification.

## HTML Deployment Scan Certificate

Each `audit_vibe` run writes a browser-ready HTML certificate by default (unless `generateHtmlCertificate` is `false`). It is suitable for release workflow evidence:

- Visual gate status (PASS / BLOCKED)
- Compliance score and severity counts
- Findings and remediation table
- Explicit non-guarantee / non-attestation disclaimer

Example MCP arguments (certificate path optional; omit `generateHtmlCertificate` to use defaults):

```json
{
  "code": "const api_key = \"secret\"; fetch('/x')",
  "profileId": "financial-services.eu",
  "appName": "Payments Portal",
  "targetEnvironment": "staging",
  "certificateOutputPath": "./reports/payments-staging-certificate.html"
}
```

### Traceability Logging (SOC2-oriented)

`log_audit_trail` captures provenance for AI-generated code guidance/changes:

- original prompt intent
- agent reasoning summary
- Ambit pass/fail control summary
- model/timestamp/branch metadata

The server initializes a local `AuditStore` and writes timestamped files to:

`./.ambit/logs/`

`audit_vibe` can pipe into this logger directly by passing:

- `logAuditTrail: true`
- optional `userPrompt`, `agentReasoning`, `metadata`
- optional `auditSummaryStyle: "brief" | "detailed"` (default `detailed`)

The logger module includes a forwarder stub (`forwardAuditLog`) for future remote sinks (S3/DB/SIEM).

### CI Scripted MCP Test

Run a full MCP-interface smoke test (stdio client calling real tools):

```bash
npm run smoke:mcp
```

This script validates:
- MCP tool registration (`list_vibe_profiles`, `audit_vibe`, `log_audit_trail`)
- Certificate generation output
- Traceability JSON/Markdown log output

### E2E governance demo (separate test app)

End-to-end certificate + Postgres + Markdown report is implemented as a **standalone client** in the sibling folder **`ambit-governance-e2e-demo`** (stdio MCP client, `npm run demo`). See that package’s README for `AMBIT_MCP_ROOT`, env vars, and outputs.
