# Trade Journal (Next.js + Prisma + IBKR CSV/Flex Import)

Production-focused trading journal inspired by TraderVue/TradesViz/TradeZella/TraderSync.

## Stack

- Next.js 16 (App Router) + TypeScript
- TailwindCSS + shadcn-style UI components
- Prisma ORM
- SQLite local default (`file:./dev.db`)
- NextAuth (credentials auth)
- Recharts + lightweight-charts
- Zod validation
- Vitest tests

## Quick Start (Local)

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Run migrations:

```bash
npm run prisma:migrate
```

4. Start dev server:

```bash
npm run dev
```

5. Login at `http://localhost:3000/login` with `AUTH_USERNAME` / `AUTH_PASSWORD`.

## Scripts

- `npm run dev` - local dev
- `npm run build` - production build
- `npm run lint` - lint
- `npm run test` - tests
- `npm run prisma:generate` - generate Prisma client
- `npm run prisma:migrate` - local migration (`prisma migrate dev`)
- `npm run prisma:migrate:deploy` - apply committed migrations (`prisma migrate deploy`)
- `npm run prisma:seed` - seed data

## Free Hosting Setup (Vercel + Managed Postgres)

Recommended free-tier stack:

- App hosting: Vercel
- Database: Neon or Supabase Postgres
- File storage: not required for current import flow (CSV parsed in memory and discarded)

### 1) Create a managed Postgres database

Create a Neon or Supabase Postgres project and copy the connection string(s).

You will need:

- `DATABASE_URL` - app runtime URL
- `DIRECT_URL` - direct DB URL for Prisma migrations (can be the same URL if you only have one)

### 2) Convert Prisma from SQLite to Postgres

Current repo migrations are SQLite-based. Prisma migrations are provider-specific, so switching to Postgres requires a Postgres migration baseline.

1. In [prisma/schema.prisma](C:\Users\ErvinLieu\Documents\Projects\trade-journal\prisma\schema.prisma), set datasource provider to `postgresql`.
2. Set local `.env` values to your Postgres URLs:
   - `DATABASE_URL=postgresql://...`
   - `DIRECT_URL=postgresql://...`
3. Replace the existing SQLite migration history with a Postgres baseline (for a fresh deployment with no data migration requirement):
   - Remove `prisma/migrations/*` contents.
   - Run:

```bash
npm run prisma:migrate -- --name init_postgres
```

4. Commit the new `prisma/migrations` files.

If you must preserve an existing SQLite dataset, do a one-time data migration before cutover instead of wiping migration history.

### 3) Deploy to Vercel

1. Push this repo to GitHub/GitLab/Bitbucket.
2. In Vercel, import the repo as a new project.
3. Set environment variables (Production, Preview as needed):
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `NEXTAUTH_URL` (your deployed app URL)
   - `NEXTAUTH_SECRET` (strong random value)
   - `AUTH_USERNAME`
   - `AUTH_PASSWORD`
   - `IBKR_FLEX_TOKEN`
   - `IBKR_FLEX_QUERY_ID`
   - `CRON_SECRET`
   - optional: `IBKR_FLEX_BASE_URL`, `IBKR_FLEX_MAX_POLLS`, `IBKR_FLEX_POLL_MS`
4. Deploy.

`vercel.json` is configured to:

- run Prisma deploy migrations before build:
  - `npm run prisma:migrate:deploy && npm run build`
- call daily cron endpoint:
  - `/api/cron/flex-import` on `0 23 * * *` (UTC)

## Cron Job (Daily IBKR Flex Pull)

### Vercel Cron (recommended)

This repo already defines:

- [vercel.json](C:\Users\ErvinLieu\Documents\Projects\trade-journal\vercel.json)
  - `path: /api/cron/flex-import`
  - `schedule: 0 23 * * *`

The cron route requires bearer auth:

- `Authorization: Bearer <CRON_SECRET>`

Set `CRON_SECRET` in Vercel env vars.

### If not using Vercel Cron

Use any scheduler (GitHub Actions, cron-job.org, UptimeRobot, etc.) and send:

- `GET https://<your-domain>/api/cron/flex-import`
- Header: `Authorization: Bearer <CRON_SECRET>`

## CSV Upload Storage Policy

Current behavior:

- Uploaded CSV files are read from request form-data.
- They are parsed/imported in-memory.
- Files are not persisted to object storage.

Object storage (S3/R2/Supabase Storage) is only needed if you want:

- long-term raw file retention
- audit/archive requirements
- very large async imports

## Required Environment Variables

Core:

- `DATABASE_URL`
- `DIRECT_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `AUTH_USERNAME`
- `AUTH_PASSWORD`

IBKR Flex:

- `IBKR_FLEX_TOKEN`
- `IBKR_FLEX_QUERY_ID`
- `CRON_SECRET`

Optional Flex tuning:

- `IBKR_FLEX_BASE_URL` (default IBKR endpoint)
- `IBKR_FLEX_MAX_POLLS` (default `20`)
- `IBKR_FLEX_POLL_MS` (default `3000`)

## Prisma Deployment Flow (Production)

After committing migrations:

1. Vercel build runs:
   - `npm run prisma:migrate:deploy`
   - then `npm run build`
2. App starts with generated Prisma client (`postinstall` runs `prisma generate`).

Manual fallback:

```bash
npm run prisma:migrate:deploy
```

## IBKR Flex Import Usage

- Manual import:
  - Settings page -> `Run Flex Import Now`
  - or `POST /api/flex/run`
- Scheduled import:
  - `GET /api/cron/flex-import` with bearer token

## Tests

```bash
npm run test
```
