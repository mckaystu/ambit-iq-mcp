# agent.gate — governance console (admin dashboard)

React 19 + Vite dashboard for organizational compliance visibility, styled with Tailwind and HCL branding.

## Run locally

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
