# Trade Journal (Next.js + Prisma + IBKR CSV/Flex Import)

Production-focused trading journal inspired by TraderVue/TradesViz/TradeZella/TraderSync.

## Stack

- Next.js 16 (App Router) + TypeScript
- TailwindCSS + shadcn-style UI components
- Prisma ORM
- PostgreSQL (local or managed)
- NextAuth (credentials auth)
- Recharts + lightweight-charts
- Zod validation
- Vitest tests

## Quick Start (Local)

1. Install dependencies:

```bash
npm ci
```

2. Create env file:

```bash
cp .env.example .env
```

3. Set `DATABASE_URL`, `DIRECT_URL`, authentication values, and any optional integrations in `.env`. Use a dedicated local database and never reuse Production credentials.

4. Run migrations:

```bash
npm run prisma:migrate
```

5. Start dev server:

```bash
npm run dev
```

6. Login at `http://localhost:3000/login` with `AUTH_USERNAME` / `AUTH_PASSWORD`.

## Scripts

- `npm run dev` - local dev
- `npm run build` - production build
- `npm run check:repo-safety` - scan tracked and candidate files without printing matched values
- `npm run check:repo-history-safety` - scan local Git refs, reflogs, and object-only history with redacted output
- `npm run lint` - lint
- `npm run test` - tests (requires the isolated test-database opt-in below)
- `npm run test:e2e` - build, reset deterministic demo data, and run Playwright
- `npm run test:repo-safety` - standalone repository-safety scanner tests
- `npm run test:repo-history-safety` - standalone Git-history safety scanner tests
- `npm run prisma:generate` - generate Prisma client
- `npm run prisma:migrate` - local migration (`prisma migrate dev`)
- `npm run prisma:migrate:deploy` - apply committed migrations (`prisma migrate deploy`)
- `npm run prisma:seed` - seed data

## Free Hosting Setup (Vercel + Managed Postgres)

Recommended free-tier stack:

- App hosting: Vercel
- Database: Neon or Supabase Postgres
- File storage: PostgreSQL archive by default; optional R2 for screenshot assets

### 1) Create a managed Postgres database

Create a Neon or Supabase Postgres project and copy the connection string(s).

You will need:

- `DATABASE_URL` - app runtime URL
- `DIRECT_URL` - direct DB URL for Prisma migrations (can be the same URL if you only have one)

### 2) Apply the PostgreSQL migration history

The committed migration history is PostgreSQL-specific and may already be applied to shared environments. Never delete, reorder, retimestamp, squash, or edit an applied migration. Add a new forward-only migration for corrections.

Set `DATABASE_URL` and `DIRECT_URL`, then run:

```bash
npm run prisma:migrate:deploy
```

### 3) Deploy to Vercel

1. Run `npm run check:repo-safety` and complete the approved history-sanitization procedure before exposing the repository to a remote host.
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
   - `IBKR_FLEX_RUN_SECRET`
   - `CRON_SECRET`
   - optional: `IBKR_FLEX_BASE_URL`, `IBKR_FLEX_MAX_POLLS`, `IBKR_FLEX_POLL_MS`
4. Deploy.

`vercel.json` is configured to:

- keep Preview and build jobs read-only with `npm run build`
- call daily cron endpoint:
  - `/api/cron/flex-import` on `0 7 * * *` (UTC)

## Cron Job (Daily IBKR Flex Pull)

### Vercel Cron (recommended)

This repo already defines:

- [vercel.json](vercel.json)
  - `path: /api/cron/flex-import`
  - `schedule: 0 7 * * *`

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
- They are parsed in-memory and applied transactionally.
- Raw content is archived by SHA-256 with import lifecycle and row-error metadata.
- Verified JSON backups include archived imports and screenshot assets.

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
- `IBKR_FLEX_RUN_SECRET`
- `CRON_SECRET`

Optional Flex tuning:

- `IBKR_FLEX_BASE_URL` (default IBKR endpoint)
- `IBKR_FLEX_MAX_POLLS` (default `20`)
- `IBKR_FLEX_POLL_MS` (default `3000`)

Journal integrations:

- `MARKET_OVERVIEW_API_BASE` - optional market-overview API origin for peer-group context
- `MARKET_OVERVIEW_API_TOKEN` - optional bearer token for the market-overview bridge
- `MARKET_OVERVIEW_WEB_BASE` - optional market-overview app origin for peer-group links
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` - optional R2 screenshot storage
- `NEXT_PUBLIC_TRADINGVIEW_LIBRARY_PATH` - optional licensed TradingView Advanced Charts bundle path

If R2 is not configured, journal screenshots still save as inline data URLs in the database so chart capture does not fail. Configure R2 before heavy use to keep the database small.

## Test Database Safety

Vitest and Playwright contain database-writing integration scenarios. They fail closed unless:

- `DATABASE_URL` and `DIRECT_URL` resolve to the same dedicated PostgreSQL host, database, and schema.
- The database or schema name contains `test`, `e2e`, or `ci` as a distinct token.
- `ALLOW_TEST_DATABASE_MUTATIONS=1` is explicitly set.
- Playwright targets a loopback URL.

Never enable the test opt-in against user data. `npm run test:e2e` resets demo-owned rows in the selected test target before running browser scenarios.

`E2E_DEMO_ONLY_WRITES` defaults to `0` in `.env.example`. Playwright enables it only for its isolated loopback server. Shared demo seeding is refused in CI and cannot be combined with test-mutation mode.

## Repository Safety

Run the dependency-free safety gate before staging or sharing changes:

```bash
npm run check:repo-safety
npm run test:repo-safety
npm run check:repo-history-safety
npm run test:repo-history-safety
```

The current-tree scanner reads Git-tracked and non-ignored candidate files and validates synthetic financial fixtures by canonical SHA-256. The history scanner separately inventories a specified repository's refs, reflogs, dangling trees, and otherwise object-only blobs. Its public report contains opaque finding IDs, structurally redacted paths, reachability classes, aggregate identity/signature counts, and evidence digests; it never returns object IDs, matched values, names, or email addresses. Opaque binaries fail closed unless every alias in a reachability class matches a reviewed exact Git path, raw SHA-256, and file mode; the application favicon is the only current exception. Rewrite eligibility requires every discovered ref to be supplied explicitly, stable beginning/end inventories, and resolved identity/signature decisions. A clean report proves only the recorded local scope and rules. It does not prove hidden remote refs, caches, forks, backups, encrypted archives, or OCR content are clean; follow the separately approved history-purge manifest before pushing this repository.

## Prisma Deployment Flow (Production)

After committing migrations, use a protected production release step rather than a generic Preview/build hook:

1. Stop import, Flex, and cron writes.
2. Create and verify the required snapshot/backups.
3. Run `npm run prisma:migrate:deploy` with production-only credentials and verify migration status.
4. Deploy the application build. Preview and build jobs run only `npm run build`.
5. App starts with generated Prisma client (`postinstall` runs `prisma generate`).

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
