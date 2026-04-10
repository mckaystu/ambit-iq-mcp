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

## Local (stdio, Cursor)

```bash
npm install
npm start
```

Point Cursor at `index.js` with `node`.

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
