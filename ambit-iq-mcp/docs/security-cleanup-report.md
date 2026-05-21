# Security and Cleanup Report

Date: 2026-04-25  
Scope: `ambit-iq-mcp` (MCP server + dashboard)

## Executive Summary

- Completed dependency vulnerability remediation for root and dashboard packages.
- Hardened token and JWT verification to reduce auth bypass and timing-leak risk.
- Added safer CORS behavior and request body limits for the HTTP MCP endpoint.
- Re-ran build/test/audit checks; all passed after changes.

## Findings and Fixes

### 1) Dependency Vulnerabilities (Moderate) - Fixed

Initial findings from `npm audit`:

- Root package:
  - `hono` advisories (cookie handling, path traversal, middleware bypass, JSX attr injection, IP matching)
  - `@hono/node-server` middleware bypass advisory
- Dashboard package:
  - `postcss` XSS advisory (`</style>` escaping issue)

Fix applied:

- Ran:
  - `npm audit fix` in root
  - `npm audit fix` in `dashboard`
- Result:
  - Root vulnerabilities: `0`
  - Dashboard vulnerabilities: `0`

### 2) JWT Signature Validation Hardening - Fixed

File: `dashboard/api/_auth.js`

Issues addressed:

- JWT signature compare used plain string equality.
- Malformed token/header/payload parsing could throw runtime errors.
- No explicit algorithm gate on JWT header.

Fixes applied:

- Added constant-time signature comparison via `crypto.timingSafeEqual`.
- Added explicit `alg === "HS256"` header check.
- Wrapped JWT parsing/verification in `try/catch` and fail-closed (`null`).

Security impact:

- Reduces risk of timing attacks against signature checks.
- Prevents accidental acceptance of unexpected JWT algorithms.
- Improves resilience against malformed token input.

### 3) MCP HTTP Auth/CORS/Body Handling Hardening - Fixed

File: `src/http-mcp.ts`

Issues addressed:

- Bearer token compared with plain string equality.
- CORS reflected arbitrary origin or used wildcard fallback.
- Request body parser had no strict size enforcement.
- Error responses always leaked internal messages.

Fixes applied:

- Added constant-time bearer token comparison.
- Added origin allow-list support via `MCP_CORS_ORIGINS` (comma-separated).
  - In non-production, localhost origins remain allowed for dev UX.
- Added body size guard via `MCP_MAX_BODY_BYTES` (default: 1 MiB).
  - Oversized requests now return `413`.
  - Invalid JSON now returns `400`.
- Production error responses no longer include internal error details.

Security impact:

- Lowers token verification leakage risk.
- Limits cross-origin exposure to approved origins.
- Reduces DoS risk from oversized request payloads.
- Reduces sensitive error disclosure in production.

## Validation Performed

- `npm audit` (root): pass, 0 vulnerabilities
- `npm audit` (dashboard): pass, 0 vulnerabilities
- `npm run build` (root): pass
- `npm run test` (root + dashboard tests): pass
- Lint diagnostics for edited files: no errors

## Operational Notes

- New environment knobs introduced/used:
  - `MCP_CORS_ORIGINS` (optional): comma-separated allowed origins
  - `MCP_MAX_BODY_BYTES` (optional): max JSON body size for HTTP MCP endpoint

## Recommended Next Steps

- Set `MCP_CORS_ORIGINS` explicitly in production to known dashboard origins.
- Keep dependency audits in CI (`npm audit` gate at least for high/critical, preferably all).
- Consider adding per-endpoint structured rate limiting for the MCP HTTP endpoint similar to dashboard API wrappers.
