# Peer comparison and review attachments

Peers keeps its existing commentary and evidence. Expanding it loads current curated
memberships; **Compare peers** refreshes them again and opens an isolated chart overlay.
The selected active group is saved per review. Deleted/inactive groups fall back to
highest priority, then alphabetical name; unavailable memberships are reported explicitly.

The primary ticker stays pinned alongside a virtualized peer grid. Dates are linked by
timestamp by default; price scales remain independent. The overlay copies the focused
chart's timeframe, session, price basis, visible range, moving averages, theme and Before
entry setting. Match workspace reapplies its dates/settings; Jump to entry requires a
resolved first execution. Peer drawings are intentionally not editable.

## Configuration and rollout

- `TRADES_WORKSTATION_ENABLED=1`
- `TRADES_CHART_PROVIDER=alpaca` and valid server-only
  `TRADES_ALPACA_API_KEY_ID` / `TRADES_ALPACA_API_SECRET_KEY`.
- The existing `TRADES_ALPACA_DATA_FEED` and `TRADES_ALPACA_DELAY_SECONDS` apply.
  Peer failures never silently switch feeds. Entitlement must be verified with valid keys.
- `MARKET_OVERVIEW_API_BASE` must point at the Worker, not the Vercel frontend.
  On 2026-09-18, the deployed frontend referenced
  `https://market-command-worker.cryptonerdo123.workers.dev`; its public
  `/api/peer-groups/ticker/AAPL` returned Consumer Electronics and Technology memberships.
- `MARKET_OVERVIEW_API_TOKEN` remains optional. `MARKET_OVERVIEW_WEB_BASE` is the
  existing link configuration (default `https://market-overview-nu.vercel.app`).

No new PostgreSQL migration or Market Overview Worker change is required. Reviews use
the existing application database connection; developer access to production Neon is not
needed to deploy this code. Vercel CLI authentication and an authenticated, read-only
application API request were verified on 2026-09-18. Production Alpaca secrets are present,
but a fresh Alpaca request and authenticated peer-comparison browser validation remain
outstanding; the earlier local HTTP 401 does not establish that production keys are invalid.
The user requested production rollout through GitHub `main`. The deployment configuration
includes the verified Market Overview Worker origin above; peer candles remain transient.

## Storage and request boundaries

`/api/journal/market-context?symbol=…&membershipOnly=1` skips metrics. Requests without
that option retain their existing response/behavior. The authenticated peer-candles route
accepts at most eight US-equity symbols and bounded dates. Unsupported exchange listings
show a per-chart message instead of substituting a US listing.

The overlay queues at most two batch requests and loads mounted rows plus one next row.
Its separate five-minute browser-memory cache uses LRU eviction at 100,000 bars, deduplicates
overlapping ranges, and never uses localStorage or IndexedDB for candles. Closing/changing
the overlay aborts obsolete loads. The server paginates Alpaca multi-symbol history through
the existing background provider queue, behind primary-chart leases; cooldowns and feed
delays apply. Regular-session hourly bars aggregate from session-open five-minute bars.
Large requests are bounded (40,000 source bars / 20 pages / roughly 55 seconds) and report
an actionable zoom/timeframe error instead of silently accepting incomplete history.

Peer history never enters candle, coverage or preparation-job tables. Only existing small
rate-coordination leases are allowed. Saved PNG captures are ordinary review evidence,
with immutable symbols/group/timeframe/session/basis/date/capture-time metadata.

## Attachments and ordering

All review sections support capture, reuse, inline previews and detachment. Existing chart
sections retain `evidenceIds`; other destinations use optional `notion.sectionEvidence`.
Document schema stays at version 1. Detachment removes one assignment; image deletion
clears every assignment. The 30-image and 4 MB package limits remain enforced. Portable
and Notion page exports map images by stable section ID and include one asset per image,
even when the same image appears under multiple headings.

Trade ordering is interpreted opening timestamp descending, then trade ID ascending, for
both server and workstation lists, selection, filtering, Save & next and neighbor prefetch.
Display dates and stale-trade write restrictions are unchanged.

## Validation

- `npm run test:workstation` and `npm run test:workstation:providers`
- `npm run test:workstation:persistence` with both database URLs set to isolated PostgreSQL
  and `ALLOW_TEST_DATABASE_MUTATIONS=1`.
- Preview browser tests: `peer-comparison.spec.ts`, `comparison-review.spec.ts`,
  `journal-recovery.spec.ts` via `playwright.workstation.config.ts`.
- Authenticated browser test: `tests/workstation-auth/peer-comparison.spec.ts`, using the
  guarded loopback test database/server. Provider responses are mocked; saving/recovery,
  exports and database counts are real.
- `npm run check:workstation:validation`, changed-file ESLint and `npm run build`.

Synthetic/mocked checks do not establish live Alpaca entitlement or production latency.

Implementation validation (2026-09-18): 116 provider/unit tests, 49 workstation tests,
25 isolated-PostgreSQL persistence tests, and 17 preview-browser tests passed, along with
TypeScript validation, changed-file lint, repository-safety scanning and the production
build. The authenticated peer browser test is included but was not executed: the tool
runner rejected starting its local production test server. Run that check before rollout.
