# ServicesBookingReports

Data-first CRM booking pipeline dashboard built with Next.js (App Router), Tailwind, Recharts, Lucide, and Papa Parse.

## How updates work

1. Drop the latest report in `data/` (`.csv`, `.xls`, or `.xlsx`).
2. Prefer naming it one of:
   - `latest_opportunities.csv`
   - `latest_opportunities.xlsx`
   - `latest_opportunities.xls`
3. If no pinned file exists, the app automatically selects the newest supported file in `data/`.
4. Refresh the dashboard.

You can also upload directly from the dashboard using **Upload Weekly Report** (it writes to `data/latest_opportunities.<ext>` and auto-refreshes).

## Run

```bash
npm install
npm run db:migrate
npm run dev
```

Create `.env.local` with `DATABASE_URL` before running migrations.

## Data ingestion and normalization

Implemented in `src/lib/dataProcessor.ts`:

- Parses CSV with `papaparse`.
- Parses Excel (`.xls`, `.xlsx`) with `xlsx`.
- Cleans `Booking Revenue US` to a number.
- Parses `Active Stage Started` and `Est. Close Date` into dates.
- Maps `Pipeline Stage` into consistent order (`Stage 0` .. `Stage 6`).
- Computes fiscal year/quarter with default quarter selection based on latest date in the file.

## Dashboard features

- Current fiscal quarter default view.
- Weekly snapshot (current vs previous week pipeline).
- Multi-select filters: GEO, Opportunity Owner, Service Category.
- Sorting controls for service category / owner in deal table.
- Funnel chart by stage (deal count/value context).
- GEO breakdown bar chart.
- Owner leaderboard (top 10 by booking revenue).
This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
