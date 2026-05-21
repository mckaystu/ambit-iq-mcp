# Project Vail — governance console (admin dashboard)

React 19 + Vite dashboard for organizational compliance visibility, styled with Tailwind and HCL branding.

## Run locally

**Policy IDE (`/dashboard/policies`)** needs the serverless API (not plain Vite alone):

```bash
npm install --legacy-peer-deps
npx vercel dev --listen 3000
```

Open http://localhost:3000 — Generate policy calls `/api/policy-manager` on the same origin.

Alternative (two terminals): `npm run dev:api` (port 3000) and `npm run dev` (Vite proxies `/api` → 3000). Do **not** set `VITE_DASHBOARD_API_BASE` to another localhost port (e.g. a Next.js app on 3001).

```bash
npm install --legacy-peer-deps
npm run dev
```

## Build

```bash
npm run build
```

## Data integration

Current data is mocked in `src/data.ts`.

Live data endpoint is now included at `api/dashboard-metrics.js` and queried by `src/data.ts`.

Set these environment variables in Vercel for the dashboard project (serverless `api/` routes only — never prefixed with `VITE_`):

- `DATABASE_URL` (Neon/Postgres connection string)
- `OPENAI_API_KEY` (**required** for **Policy IDE** `/dashboard/policies` → “Generate policy”: OpenAI Chat Completions with JSON mode; returns 503 if unset)
- `OPENAI_MODEL` (optional, default `gpt-4o-mini`)

The API expects these tables:

- `compliance_activity` (trend + active issues)
- `rules_library` (rule/industry metadata)

The UI already supports:

- date-range filtering (`7d`, `30d`, `90d` + custom start/end)
- insights, trend/industry charts, active issue drill-down
- dark/light mode

## Phase 3 Dashboard UI

New routes:

- `/dashboard/executive`
- `/dashboard/model-governance`
- `/dashboard/incidents`
- `/dashboard/agent-interactions`

New pages:

- Executive Dashboard
- Model Governance
- Incident Response
- Agent Interactions

APIs consumed:

- `/api/executive-dashboard`
- `/api/model-governance`
- `/api/incidents`
- `/api/agent-interactions`

Run dashboard locally:

```bash
npm install
npm run dev
```
