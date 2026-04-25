# DX.IQ

HCL DX WCM deep-scan inventory and relationship mapper.

## Stack
- Vite + React + TypeScript
- Tailwind CSS
- Recharts
- Local Node API adapter for `/api/*` routes
- Neon/Postgres database

## Quick start
```bash
npm install
cp .env.example .env.local
# Set DATABASE_URL in .env.local to a Neon (or Postgres) connection string, then:
# Run db/schema.sql in the Neon SQL editor (and db/migrations/001_add_library_element_type.sql if upgrading).
npm run dev:api
npm run dev
```
Open the Vite URL (usually `http://localhost:5173`). Keep both `dev:api` and `dev` running for full UI + API.

## Database
Apply `db/schema.sql` to your Neon/Postgres database.
Set `DATABASE_URL` in `.env.local`. See `.env.example`.

## Optional Graph Sidecar (Phase 1)
- Set `GRAPH_SIDECAR_URL` to a webhook endpoint that accepts JSON events.
- During scan ingestion, DX.IQ now emits best-effort events:
  - `upsert_node` for `Library`, `Content`, `SiteArea`, `PT`, `AT`, `Component`
  - `upsert_edge` for `REFERENCES` links
- If `GRAPH_SIDECAR_URL` is not set, behavior is unchanged (no sidecar writes).
- Built-in ingest endpoint: `POST /api/graph/events` (writes to FalkorDB Cloud via RedisGraph protocol).
  - Required envs for built-in ingest: `FALKOR_REDIS_URL`
  - Optional: `FALKOR_GRAPH_NAME` (default `dxiq`)
  - Optional auth: `GRAPH_SIDECAR_TOKEN` (`Authorization: Bearer <token>`)
  - Local loopback setup:
    - `GRAPH_SIDECAR_URL=http://localhost:3000/api/graph/events`
    - `FALKOR_REDIS_URL=redis://default:password@host:port`

## Next implementation steps
1. Add shadcn/ui components (`button`, `input`, `table`, `card`, `tabs`).
2. Wire `libraries` CRUD API endpoints with encrypted credential references.
   - Connectivity probe endpoint now available at `POST /api/libraries/test-connection`.
3. Implement `POST /api/scan/start` + `POST /api/scan/continue` chunk logic:
   - Fetch ATs, PTs, Site Areas, Content in paged chunks.
   - Parse PT markup for `[Component ... name="..."]` and `[Property ... context="component" ...]`.
   - Persist progress cursor in `scan_jobs.cursor`.
4. Build Dead Wood report (`child_id is null`) and treemap/table API.

## Connectivity test payload (example)
```json
{
  "name": "Sample DX",
  "baseUrl": "https://riesen-dev-latest.team-q-dev.com/hcl/dx/nexHaven/home/!ut/p/z1/...",
  "username": "your-user",
  "password": "your-password"
}
```

## Contenthandler probe payload (example)
`POST /api/libraries/test-contenthandler`
```json
{
  "baseUrl": "https://your-dx-host.example.com",
  "username": "your-user",
  "password": "your-password",
  "contenthandlerPath": "/hcl/mycontenthandler/wcmrest-v2/libraries"
}
```

**DX 9.5:** WCM library listing often lives at `/hcl/mycontenthandler/wcmrest-v2/libraries` (not `/dx/api/wcm/v2/...` on the same host). If `contenthandlerPath` is omitted, discovery tries that path first, then fallbacks.

## Library discovery payload (example)
`POST /api/libraries/discover`
```json
{
  "baseUrl": "https://your-dx-host.example.com/hcl/dx/nexHaven",
  "username": "your-user",
  "password": "your-password",
  "contenthandlerPath": "/hcl/mycontenthandler/wcmrest-v2/libraries"
}
```

Returns discovered library candidates for UI selection before saving/scanning.

## Scan APIs (first implementation)
- `POST /api/scan/start` with `{ "libraryId": number, "chunkSize": 2 }`
  - Creates a scan job and processes first chunk.
- `POST /api/scan/continue` with `{ "jobId": number, "chunkSize": 2 }`
  - Resumes from persisted cursor.
- `GET /api/scan/status?jobId=123`
  - Returns job state, cursor progress, and inventory counts.

Current chunk scanner:
- Uses saved library base URL + auth.
- Crawls a bounded target list (`base`, `base/home`, common contenthandler paths).
- Uses Contenthandler adapters:
  - JSON payload parser
  - XML payload parser
  - HTML fallback parser
- Stores discovered typed elements (`AT/PT/SiteArea/Content/Component`).
- Parses PT markup for component references and stores `Component` + `REFERENCES` links.

## Reports
- `GET /api/reports/dead-wood?libraryId=<id>&limit=200`
  - Lists components with no inbound references (`child_id is null` equivalent via `NOT EXISTS`).
