# Closed-trade fundamentals

The `/trades` journal's Fundamentals section retains its commentary and adds Revenue / Net income previews, **View fundamentals**, and **Attach snapshot**. The popup follows the market-overview earnings profile. The miniature preview and viewing toggle are transient UI state; they do not become Notion page content, CSV properties, or review text. Attaching a snapshot is a deliberate review edit and follows the existing review-status behavior.

Hover anywhere in a quarter column in either popup chart to inspect that period's full USD amounts, YoY/QoQ growth and derived-Q4 labels; both charts highlight the selected quarter. The mini charts show the same details for their individual metric. Missing values are labelled **Unavailable**. Touch selects a period, and keyboard users can focus a chart and use Left/Right, Home/End and Escape. Tooltips are kept within the viewport, clear when the trade or cutoff changes, and use already-loaded data without additional fetching or journal edits. Summary cards continue to show the latest eligible quarter. The separate static capture SVG excludes all hover highlights and interaction controls.

## Historical data

Before entry defaults on for each selected trade. Its boundary is the earliest verified execution's America/New_York calendar date. SEC facts must have both a completed period and a filing date strictly before that boundary. Same-day filings are excluded because Company Facts supplies filing dates rather than reliable intraday availability. An unresolved execution date produces an explicit unavailable state. The toggle is separate from price-chart and replay controls.

The parser adapts `market-overview/worker/src/fundamentals-service.ts`: SEC ticker directory → CIK → Company Facts, USD US-GAAP revenue/net-income tag fallbacks, direct fiscal-quarter facts, FY less Q1–Q3 for Q4, and growth against the absolute prior value. It retains per-metric source accession, tag, form and filing date. Source facts are filtered before fiscal-calendar construction, version selection, Q4 subtraction, and growth. Growth uses earlier history before the display is trimmed to eight quarters; gaps and missing metrics remain unavailable. Non-calendar fiscal years use disclosed year ends, and incomplete transition periods are not subtracted into Q4.

Coverage matches standard USD revenue/net-income facts in 10-Q, 10-K and their amendments. Foreign reporting forms, custom issuer taxonomies and historical ticker changes are not inferred. Latest mode explicitly includes later filings and restatements.

Older stock imports classified as `OTHER` (or without a classification) use the existing legacy-share compatibility rule and resolve their ticker through SEC. This does not change broker classifications or accounting. Explicit non-stock instruments, ETFs and recognized option-contract symbols are excluded before SEC requests.

SEC's `fy` metadata identifies the filing's fiscal year, including on prior-year comparative facts. The parser offsets comparative years using the latest period disclosed in that same eligible filing before building its fiscal calendar. This prevents comparative annual results from displacing the current year's Q4.

## Automatic loading and configuration

`GET /api/workstation/fundamentals?tradeId=…&mode=before-entry|latest` requires the existing API session and workstation flag. It resolves the ticker and timestamp policy from the stored trade and returns private, non-cacheable HTTP responses. Browser callers cannot override the cutoff or ticker. The section fetches when opened and aborts/ignores obsolete requests when switching trades.

Apply the additive migration `20260928100000_sec_fundamentals_cache` through the project's normal deployment workflow, regenerate Prisma, and configure the existing server-only `SEC_USER_AGENT` to identify the application and a contact address. No paid API key, scheduler or backfill is needed. No changes to the market-overview deployment are required.

The regenerable cache stores compressed supported facts with all filing versions, shared by issuer CIK. A historical read revalidates after 24 hours, latest mode after 15 minutes, and an empty result after one hour. The ticker directory revalidates hourly. A distributed lease coordinates fetches across application instances, while the shared SEC gate allows at most two requests per second. HTTP 429/403 establishes a shared cooldown; transient network/5xx errors receive at most two retries with bounded timeouts.

Cache allocation is capped at 10 MB of compressed payloads, participates in the existing 100 MB cache / 400 MB branch safeguards, and evicts only regenerable SEC records. This cache is persistent in the application database: on-demand fetching does not mean storage-free loading, and revalidation intervals are not deletion deadlines. Cache tables are excluded from user-data backups. Provider failures preserve previously retrieved eligible history and expose its retrieval age with **Retry**. Uncached failures, unknown tickers and unsupported data have separate UI states. A manual Refresh SEC button is not part of the ordinary workflow.

## Evidence and publishing

Snapshots rasterize the same self-contained SVG used in the popup into a complete 2240 × 1640 PNG; scrolling, chart controls and modal chrome do not affect the capture. The image contains ticker, cutoff mode, retrieval time, filing context and both charts. Evidence metadata freezes the displayed quarters and their sources. Switching trades cancels in-flight attachment to the original review.

The current private evidence pipeline stores originals in R2 (IndexedDB in the explicitly labelled preview), enforces image and review limits, and retains recoverable pending uploads. `sectionEvidence.fundamentals` already supports the assignment, so no parallel reference schema or journal-content migration is needed. The optional `fundamentalsCapture` metadata is validated alongside existing evidence. Existing saved reviews remain readable.

Only attached evidence and authored commentary enter the existing direct Notion publication, page ZIP and portable review flows. Automatic previews are never persisted in the review or included in publication plans. Removing a snapshot clears its evidence references while preserving commentary. No Notion publication is triggered automatically.

## Checks

- Focused parser/service/API/cache/client/evidence tests run under `vitest.workstation.config.ts` with mocked HTTP and Prisma; they never access the application database.
- `tests/workstation-preview/fundamentals.spec.ts` covers the popup, cutoff toggle, snapshot dimensions and provenance, capture with hover active, save/reload/removal, trade switching, mouse/keyboard/touch period inspection, missing/negative values, narrow-panel layout and tooltip positioning. It also checks that inspection adds no journal changes or fundamentals requests. Start the loopback development server with `TRADES_WORKSTATION_PREVIEW=1`.
- `npx tsx scripts/verify-sec-fundamentals.ts --live` performs two read-only SEC requests for BE and checks historical source dates without opening a database or writing cache records. An HTTP 403/429 means live provider connectivity has not been verified; mocked checks are not a substitute for that deployment check.

### Clickable legends

The popup's existing six legend entries toggle revenue/net-income bars and each
YoY/QoQ line independently. Hidden entries stay visible, muted and struck through.
Mouse, touch, Enter and Space use the same toggle; keyboard focus is visible.
Amount and growth domains use only enabled series, retain zero, and distinguish
hidden charts from unavailable values. A single bar is centred in its quarter;
growth axes disappear when their selected series have no usable values.

Selections last for the current trade, including modal reopening and cutoff
changes. Trade changes and page reloads restore all series. Summary cards and mini
charts stay complete. The shared modal tooltip omits hidden amounts/lines and
resets when visibility changes. Toggling does not fetch data or save a review.

Both Attach snapshot actions use the selected view, with static legend states and
no interactive overlays. Capture freezes visibility and data until attachment
finishes; at least one enabled series must have usable values. Capture provenance
adds optional six-boolean `seriesVisibility` metadata. Older evidence without it
represents all series visible. Existing images and exports remain immutable.
This uses existing review JSON; no SEC API, database or worker migration is needed.

Validation on 1 October 2026 passed 39 focused mocked/unit/integration tests and
all eight Fundamentals browser scenarios. Desktop/mobile views and the generated
2240×1640 PNG were inspected. Type checks, affected-file lint, repository safety
and the production build passed. Validation used synthetic data and the isolated
local test database; production reviews and Notion pages were not modified.

### Period-tooltip validation, 2026-09-30

All six Fundamentals browser scenarios and 33 focused mocked tests passed. The dedicated workstation TypeScript check, feature-specific ESLint, repository safety scan and production build passed. Desktop and narrow touch screenshots were inspected. Browser checks confirm that hover inspection leaves the review unchanged, sends no fundamentals requests, and is absent from the serialized SVG used for snapshot capture. This change is UI-only and requires no API, database migration or cache-policy changes.

### Local validation, 2026-09-28

Implemented after fast-forwarding the clean checkout to GitHub `main` at `e2fb630`. The focused mocked suites passed 29 tests, including the existing Notion file-export suite and a direct-publication-plan regression. All three fundamentals browser scenarios passed, and the popup and preview screenshots were visually inspected. The workstation TypeScript check, Prisma schema validation, feature-specific ESLint and production build passed.

The broad repository TypeScript invocation includes older test suites with existing typing errors; the project's dedicated workstation and production configurations passed. Repository-wide ESLint reported existing errors in `dashboard-workspace.tsx`, `use-review-statuses.ts`, and an ignored local verification artifact. Those unrelated files were not changed.

The initial live SEC probe returned HTTP 403 while `SEC_USER_AGENT` was unset. After the operator configured the identification/contact header, the read-only BE probe passed: both latest and historical modes returned eight quarters, and every historical source filing preceded its cutoff. The header is deployment configuration, independent of the application's package version, and its contact value is never committed.

### Release preparation, 2026-09-28

A fresh complete production database-and-images backup was downloaded and checksum-verified using the existing authenticated backup workflow. The backup was restored into a separate local PostgreSQL database, with every original image checked against its recorded hash and dimensions. Applying `20260928100000_sec_fundamentals_cache` there left every backed-up user-data table's row count and row-content fingerprint unchanged; the new cache table was empty. Backup files and authenticated validation state remain in ignored local directories.

The verified `SEC_USER_AGENT` was also configured as a Production secret in the existing Vercel project. Production rollout uses the existing Vercel build migration flow after the current journal reports **All changes saved**. Deployment verification must check the migration, existing journal content, live automatic fundamentals loading and snapshot attachment. No Notion publication is part of this release check.
