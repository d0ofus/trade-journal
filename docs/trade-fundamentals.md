# Closed-trade fundamentals

The `/trades` journal's Fundamentals section retains its commentary and adds Revenue / Net income previews, **View fundamentals**, and **Attach snapshot**. The popup follows the market-overview earnings profile. The miniature preview and viewing toggle are transient UI state; they do not become Notion page content, CSV properties, or review text. Attaching a snapshot is a deliberate review edit and follows the existing review-status behavior.

Hover anywhere in a quarter column in either popup chart to inspect that period's full reported-currency amounts, YoY/QoQ growth and derived-Q4 labels; both charts highlight the selected quarter. The mini charts show the same details for their individual metric. Missing values are labelled **Unavailable**. Touch selects a period, and keyboard users can focus a chart and use Left/Right, Home/End and Escape. Tooltips are kept within the viewport, clear when the trade or cutoff changes, and use already-loaded data without additional fetching or journal edits. Summary cards continue to show the latest eligible quarter. The separate static capture SVG excludes all hover highlights and interaction controls.

## Historical data

Before entry defaults on for each selected trade. Its boundary is the earliest verified execution's America/New_York calendar date. SEC facts must have both a completed period and a filing date strictly before that boundary. Same-day filings are excluded because Company Facts supplies filing dates rather than reliable intraday availability. An unresolved execution date produces an explicit unavailable state. The toggle is separate from price-chart and replay controls.

The parser adapts `market-overview/worker/src/fundamentals-service.ts`: SEC ticker directory → CIK → Company Facts, US-GAAP/IFRS revenue/net-income concepts in reported currency, direct fiscal-quarter facts, FY less Q1–Q3 for Q4, and growth against the absolute prior value. It retains per-metric source accession, tag, form and filing date. Source facts are filtered before fiscal-calendar construction, version selection, Q4 subtraction, and growth. Growth uses earlier history before the display is trimmed to eight quarters; gaps and missing metrics remain unavailable. Non-calendar fiscal years use disclosed year ends, and incomplete transition periods are not subtracted into Q4.

Coverage includes 10-Q, 10-K, 20-F, 40-F, 6-K, 8-K and their amendments, with US-GAAP and IFRS concepts in the issuer's reported currency. Company Facts remains primary. Incomplete quarterly coverage invokes the shared filing reader described below. Historical ticker changes are not inferred. Latest mode explicitly includes later filings and restatements.

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


## Shared SEC filing reader (10 November 2026)

The feature now normalizes supported domestic/foreign forms, US-GAAP and IFRS
concepts, source currency, accounting standard and owner-attributable versus
consolidated profit. Revenue includes both assessed-tax variants. A twelve-month
period in an interim report is not automatically a fiscal-year anchor. Source
versions are selected before compatible cumulative-period subtraction; growth is
unavailable when currency, accounting standard or profit basis differs.

Company Facts is still the primary data source. When its last eight quarters have
missing metrics, gaps or outdated reporting periods, the service discovers SEC
filings from the preceding 36 months, including historical submissions files. It
also checks newer, unrepresented filings once another quarter could have ended
(75 days after the latest period), even if eight older structured quarters look
complete. That check scans only recent filings after the latest period.
The reader reads filing-level standard XBRL and then consolidated HTML statement tables.
The same reader serves every issuer: there is no ticker/CIK allowlist. Custom tags
are understood only through unambiguous consolidated statement labels. Guidance,
adjusted figures, segment tables and percentage columns are excluded. Table units
and column currencies override unrelated amounts in surrounding prose. Net
revenues take precedence over a net-sales component.

Quarters may be obtained by subtracting compatible disclosed periods; a half-year
alone is never split into invented quarters. Every source and inferred calendar
is filtered by the before-entry boundary first. Currency selection uses eligible
primary statements or their comparative coverage, rather than occasional USD
convenience translations. Ambiguous currency identification is an explicit
unsupported state. Financial reports only available as PDFs/scans are not parsed.

The response and optional capture metadata now include reporting currency,
coverage, accounting/profit basis and direct document provenance. Summaries,
axes, mini charts, hover details and complete PNG captures use the selected
currency. Partial coverage is also labelled inside the captured SVG. Saved older
captures remain valid and retain their USD interpretation.

The normalized Company Facts key is `facts:v2:<CIK>`; old empty `v1` results are
bypassed. Submission listings revalidate after 15 minutes; successfully classified
filings and completed document observations are cached by accession for one year
because amendments receive new accessions. Cache keys also include the inferred
currency, accounting standard and fiscal calendar, preventing later context from
leaking into historical requests. All records use the existing compressed SEC cache and its allocation
limits. The shared SEC client handles JSON and bounded HTML/XML responses through
one rate gate, cooldown and cancellation policy. Retrieval is bounded to 105
seconds within the route's 120-second limit. Available completed documents survive
partial retrieval, including a later attachment failure in the same filing; Retry
reuses that work. Missing/oversized documents do not
block every older filing. There is no database migration, backfill or scheduler.

`fixtures/sec-fundamentals/manifest.json` records public SEC Company Facts and
financial-table fixtures for TSEM, MNDY, STM, WPM, SAP, TSM, AAPL and BE. Regression
tests compare actual amounts and source dates and also relabel source accessions
so success cannot depend on issuer identity. Separate browser tests mount the
real component with mocked HTTP for USD/EUR/TWD charts, tooltips, direct filing
links and captured metadata; they never open an application database.

Read-only live verification:

```
npx tsx scripts/audit-sec-fundamentals.ts --live --symbols=TSEM,MNDY,STM,WPM,SAP,TSM,AAPL,BE --cutoff=2026-01-13
npx tsx scripts/audit-sec-fundamentals.ts --live --journal --quiet
```

The journal audit selects distinct eligible imported share tickers inside a
PostgreSQL read-only transaction. It does not read journal prose or evidence and
never writes application cache, trades or reviews. SEC responses and resumable
verification artifacts are stored only in the ignored local
`artifacts/sec-fundamentals` directory. `--reparse` ignores previously parsed local
verification records; `--facts-only` explicitly reports when filing fallback has
not yet been checked. Unknown/renamed tickers and misclassified non-company
instruments remain separate from extraction failures.

Local validation on 10 November 2026 passed 97 focused tests across 11 suites,
11 browser scenarios (including USD/EUR/TWD capture round trips), the workstation
TypeScript check, affected-file ESLint, the repository safety scan and the
production build. Live source comparisons cover the six affected sample issuers
plus AAPL and BE, including the 13 January 2026 historical boundary. The journal
audit covers 239 distinct eligible imported share tickers: 206 have eight
contiguous quarters with both metrics, 21 have partial coverage, six have
unsupported reporting layouts/context and six have no current SEC ticker match.
Filing fallback and the corrected shared rules recovered complete coverage for
33 tickers beyond the initial structured-data audit. Resuming the interrupted
SATS/SQM checks reused completed work and resolved the retrieval interruptions;
SATS still has coverage gaps. The local report at
`artifacts/sec-fundamentals/journal-audit-final.md` lists remaining gaps by ticker
and period, with full observations in its companion JSON. Audit coverage describes successful
normalization, not an independent financial audit of every journal amount.
Production database records, application cache and external publications were
not modified during verification. No deployment or database migration was made.
