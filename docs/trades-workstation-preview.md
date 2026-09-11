# Trades workstation preview

The implementation branch is `feat/trades-workstation-revamp`. The user approved merging to main on 2026-09-11 with the existing production candle provider; Alpaca configuration is deferred. Trade ingestion, the existing market-candle API and the outcome-calculation provider selection are unchanged. Shared candle helpers accept explicit chart-only credentials and cache sources; their legacy defaults are preserved.

## Run the mock preview

```powershell
$env:TRADES_WORKSTATION_PREVIEW = '1'
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open http://localhost:3000/preview/trades. This route requires development mode and the explicit preview flag; normal authentication remains enabled on application routes. Preview candles and reviews use a mock adapter. Notes, annotations, and preferences are saved in browser local storage. The preview does not call application APIs or the real database.

## Loading history while panning

- Each chart requests older/newer windows when panning or zooming near its loaded edge, following the Lightweight Charts [infinite-history pattern](https://tradingview.github.io/lightweight-charts/tutorials/demos/infinite-history).
- Requests are debounced by 180 ms, serialized per chart, and limited to three automatic pages per gesture. Load older / Load newer provide keyboard-accessible controls and explicit continuation.
- Windows are bounded by timeframe: 14 days at 5m, 21 days at 10m, 28 days at 15m, 90 days at 1h, one year at 1d, and five years at 1wk. Adjacent requests overlap two intervals; duplicate timestamps are merged in ascending order.
- Prepending restores the candle under the viewport's left edge and the fractional scroll position. Existing executions and drawings retain their time/price anchors. Switching timeframe requests history around the current visible context. Fit trade and execution navigation request a fresh context window if the destination is outside loaded coverage.
- Switching trade/timeframe or closing a chart aborts its old history session. Late responses cannot update a replacement session. Background history requests keep the current candles visible.
- Errors preserve existing candles and retry the same window. Empty windows pause automatic loading, explain missing history, and permit searching the next window manually. A truncated response is rejected rather than silently skipping bars. No candles are invented to fill gaps.
- Provider names, exact loaded/visible dates, manual history controls, and coverage warnings are available from each chart's history button. Missing execution coverage and fetch failures also flag that button. A provider response is not proof of complete session coverage.
- Replay continues to conceal incomplete/future candles, executions, annotations, and reviews. Loading newer history is disabled while replay is active.
- Charts stop accumulating data at 100,000 bars to bound browser memory. This is an application safeguard, not a TradingView lookback restriction. No polling or streaming is added.

The mock generator contains 800 calendar days before each sample trade. The paging test loads over 40,000 actual synthetic 5m bars across more than two years. This proves pagination mechanics, not real-provider availability or exchange-calendar accuracy of the synthetic fixture.

## Compact chart workspace and linked dates

- The page title and bottom review panels start collapsed. The top-bar chevron restores the title; the bottom shelf restores Executions, Evidence, or Drawings. Review groups and the journal can collapse without deleting their panels or reviews. These preferences persist locally.
- Focus in the chart toolbar hides surrounding navigation, title, trade list, journal, and bottom panels. Restore (or Escape when no editor/menu is active) returns the workspace. Chart date windows survive resizing.
- Chart settings offer **Main left / two right** and **Main above / two below**. Chart headers are 30 pixels high; OHLC appears inside the canvas and history details open on demand. Annotation labels reserve space for OHLC and the TradingView attribution mark. Dark and light themes retain the existing palette.
- On phones, charts form a vertically scrollable stack of full-width canvases instead of two narrow secondary charts.
- The calendar button offers **Link clicked date** or independent navigation. Click a candle on any chart to reveal its date in the others. A chart already displaying the target remains unchanged; charts that need to move retain their own candle spacing and load historical candles as needed. Repeated clicks do not repeatedly recenter the views.
- Panning, wheel zoom, dragging, drawing, and annotation selection never propagate date changes. Hover crosshairs remain a separate option. Go to date and execution selection also reveal only missing targets. Fit trade remains an explicit command for fitting the trade on all charts.
- A candle click selects that candle's period; execution selections retain their exact timestamps. For example, clicking a daily candle does not move an intraday view already displaying part of that day. When navigation is needed, prefer an execution in the selected period or an actual session candle instead of centering intraday charts at midnight. Each chart can retain a different date range.
- Previously saved pan/zoom window locks migrate to click linking without resetting the theme, panel layout, drawings, or journal. Explicit independent navigation remains independent.
- Three-chart PNG exports preserve the chosen top/bottom or left/right arrangement and every individual chart bitmap.

## Keyboard shortcuts

Open **Chart settings → Keyboard shortcuts** or press `?` while a chart has keyboard focus. The authenticated Settings page also contains **Workstation → Keyboard shortcuts** when the workstation feature flag is enabled. Both entry points use the same component and application storage key; the mock preview has a separate key. Preferences are device-local in this phase, not synchronized to a user profile or stored on trade reviews.

Defaults: `V` select/pan, `H` horizontal line, `R` horizontal ray, `T` trend line, `A` arrow, `B` zone, `N` text note, `M` measurement, `L`/`S` long/short risk-reward, `F` fullscreen active chart, `Shift+F` focus the workspace, `G` jump to date. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo/redo drawings. Delete removes an unlocked selected drawing. Ctrl/Cmd+Enter saves and advances; Alt+Up/Down selects the previous/next trade outside editors.

- Click a chart or reach it with Tab to focus it. Drawing and chart commands require chart focus; they do not activate merely because a chart was used earlier. Inputs, selects, contenteditable/Tiptap editors, dialogs, composition and held-key repeats keep their normal behavior.
- A single command registry supplies recording/conflict checks, dispatch and live toolbar shortcut labels. Search actions, record a combination, clear/reset individual bindings, reset all, disable single-character shortcuts or disable shortcuts entirely. Escape and Tab remain fixed navigation keys.
- Changes persist immediately and update other open tabs. Storage failures are visible. A demo reset also resets demo shortcuts without touching application preferences.
- Fullscreen is an in-page chart view, keeping the theme, drawing toolbar and inline annotation properties. Background panels become inert and Tab stays inside the fullscreen controls. Closing the date dialog returns focus to the chart. Esc first cancels a drawing/selection or closes a dialog, then restores the fullscreen chart/workspace.
- `G` focuses an explicit UTC date/time input. Enter applies the existing conditional reveal behavior: only charts missing the target move, with each chart retaining its own zoom.

## Isolated chart-provider configuration

The workstation now has its own authenticated, feature-gated `/api/workstation/candles` endpoint. Journal outcomes and older charts retain `/api/market/candles` and the original `loadCandlesForSymbol` behavior. **Do not add global `ALPACA_*` credentials for this rollout:** those are still consumed by the legacy service. Use these server-only chart settings instead:

| Variable | Initial value / purpose |
| --- | --- |
| `TRADES_WORKSTATION_ENABLED` | `1` in authenticated staging first; unset/`0` keeps the workstation endpoint disabled |
| `TRADES_CHART_PROVIDER` | `alpaca` to opt in; default `legacy` preserves the existing provider path; `yahoo` selects separate Yahoo chart requests |
| `TRADES_ALPACA_API_KEY_ID` | Alpaca key ID, secret in Vercel |
| `TRADES_ALPACA_API_SECRET_KEY` | Alpaca secret key, secret in Vercel |
| `TRADES_ALPACA_DATA_FEED` | `sip` (default); `iex` is also supported |
| `TRADES_ALPACA_ADJUSTMENT` | `raw` (default); adjusted execution coordinates are not enabled and other values are rejected |
| `TRADES_ALPACA_DELAY_SECONDS` | Defaults to `900` for SIP and `0` for IEX; set SIP to `0` only after verifying recent-data entitlement |
| `TRADES_CHART_YAHOO_FALLBACK` | Enabled by default; `0` disables fallback |
| `TRADES_ALPACA_DATA_BASE_URL` | Optional; only `https://data.alpaca.markets` is accepted |

This release keeps `TRADES_CHART_PROVIDER=legacy`; no Alpaca credentials are needed. A future Alpaca rollout should validate branch-scoped Preview credentials before Production. Environment changes take effect on new deployments. Vercel Preview uses a production build, so staging must use the authenticated adapter and an isolated database, not the development-only mock route. [Vercel environment variables](https://vercel.com/docs/environment-variables).

Use consolidated SIP history for US equity execution reviews. IEX covers one exchange, whereas SIP includes all US exchanges. Alpaca's [market-data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq) allows historical SIP queries without the paid subscription when their end is at least 15 minutes old. The new chart path caps requests at the configured delay and reports that cutoff when it restricts the requested range. Live account entitlement and actual two-year history remain phase-two checks.

Chart cache rows use `MarketCandle.source = workstation:v1:alpaca:<feed>:<adjustment>`, leveraging the existing unique key without a new cache migration. Reads and writes use only that exact source; old `alpaca`/`demo` cache rows are not imported, relabelled or deleted. Complete matching intraday coverage can be served from cache; daily/weekly requests conservatively refresh from the provider, retaining the isolated cache as an outage fallback. Existing outcome readers do not consume these namespaced rows.

Each response identifies provider, feed, adjustment, delay, cache/fallback status and series identity. History pages with a different identity cannot be appended to an existing series: previous candles and viewport are preserved, with Retry history / Reload chart controls. An initial Yahoo fallback is labelled with an **unverified** price basis and kept on Yahoo for subsequent pages. It is never described as equivalent to raw Alpaca data. Raw execution prices and drawings are not transformed. Adjusted views require validated corporate-action transformations before they can be enabled.

## Application adapter and production findings

The authenticated workstation adapter calls `/api/workstation/candles` with explicit symbol/timeframe/from/to and a 30,000-bar request limit. Successful complete pages are cached in browser memory for five minutes (up to 48 pages). Partial, failed, and empty responses remain immediately retryable. The chart server applies the selected policy above; only the explicit legacy mode calls the original candle loader.

Read-only production inspection on 2026-09-11 found:

- GitHub records a successful Production deployment at `8c9308227c6488bc7884ceb2874a870421feae9e`, matching synchronized `main`.
- Vercel's project and shared environment variable searches returned no `ALPACA` variables. No secret values were revealed or settings changed.
- A fresh authenticated request to [production AAPL 5m candles](https://trade-journal-gray-theta.vercel.app/api/market/candles?symbol=AAPL&timeframe=5m&limit=30) returned `source: "yahoo"`, `cacheKind: null`, and 30 candles. That deliberately small diagnostic request reported `truncated: true`; it is not evidence of full historical coverage.
- The existing ABAT 1h trade chart displayed `YAHOO` and `Fallback data`.

Consequently, Alpaca is supported in production code but is not configured in the inspected Vercel settings. The effective configured path is database cache, then Yahoo, then Stooq for daily candles where needed. A particular request may return cache instead of Yahoo. The code's `iex` default is not evidence that production is currently receiving an Alpaca IEX feed.

Real two-year 5m coverage still requires a suitably configured historical provider and an authenticated integration check. No provider credentials, production settings, ingestion code, or production data were changed for this implementation.

## Verification

```powershell
npm run test:workstation
npm run test:workstation:providers
npm run test:workstation:browser
.\node_modules\.bin\tsc.cmd -p tsconfig.workstation.json
.\node_modules\.bin\eslint.cmd src/components/workstation src/lib/workstation tests/workstation-preview playwright.workstation.config.ts
```

The browser suite requires the running preview above and Playwright Chromium (`npx playwright install chromium --only-shell`). It uses isolated browser contexts, blocks application API requests, and neither loads database credentials nor runs seeds/migrations. Its configuration is separate from the database-dependent application suite.

Unit checks cover history merging, two-year paging, fractional viewport restoration, cancellation, concurrent requests, retries, missing/truncated/invalid candles, source provenance, timeframe context, cache behavior, execution alignment, long/short calculations, and review exports. Browser checks cover actual dragging, pixel stability of executions/annotations after prepending, timeframe changes, local review recovery, replay, themes, and mobile controls.

Verified after the click-linking change: 26 unit tests and 12 browser tests passed, along with application-source TypeScript, targeted ESLint, and `git diff --check`; the running preview returned HTTP 200. The suite covers history, exports, execution/annotation placement, exact-time and coarse-candle date targets, and saved-preference migration. Browser checks cover pixel stability after prepending and replay, collapse/focus, draft recovery, independent pan/zoom on every chart, click-only date linking from each timeframe, no movement when a target is already visible, preserved zoom during remote navigation, drawing gestures, exact execution selection, themes, mobile layouts, and a multichart PNG download. The keyboard check uses reduced motion.

Screenshots are written under the ignored `test-results/workstation-preview/` directory. Updated compact/focus layouts and the downloaded multichart PNG are copied to `screenshots/workstation-space-2026-09-11/`; earlier history screenshots remain in `screenshots/workstation-preview-2026-09-11/`. Application-source TypeScript checking excludes test files; it is not a claim that the repository's pre-existing test typing issues are resolved. Database persistence, migration, authenticated browser and production-build checks were subsequently completed in [phase two](./trades-workstation-phase-two.md). Live Alpaca verification currently stops at HTTP 401 with the supplied credentials; recent Yahoo 5m availability was verified separately.

The user approved the release with the existing provider after the [phase-two checks](./trades-workstation-phase-two.md). These history checks do not certify every export/docking/drawing feature. Live Alpaca coverage remains deferred.


## Phase one verification and next phase

Verified after adding shortcuts and chart-provider isolation: **29 workstation unit tests, 66 mocked provider/API regression tests, and 14 Chromium browser tests passed**. Application-source TypeScript, targeted ESLint and `git diff --check` passed. Tests verify focused shortcuts, remapping/conflicts/reset/reload, editor isolation, fullscreen annotation editing, date navigation, existing chart interactions, API authentication/feature gating, chart-only credentials, exact cache namespaces, provider pagination, delay, fallback and unchanged legacy loader behavior.

Provider tests use `vitest.workstation.config.ts`, an explicit allowlist of fully mocked Prisma/HTTP suites that does not load environment files or include database-backed tests. The default `vitest.config.ts` retains its isolated-database safety preflight. The local default Node 20.14 is too old for the installed Vitest dependencies; the provider suite was run with the already cached Node **22.23.1**, after restoring the missing matching Windows Rolldown optional binding in `node_modules`. Use a compatible Node 22 runtime for the provider test command. No project dependency versions or production runtime settings were changed for that repair.

Screenshots for this phase are under `screenshots/workstation-shortcuts-2026-09-11/`. The preview continues at http://localhost:3000/preview/trades. Keyboard preferences currently persist on this device; account-level synchronization is not implemented. Browser verification covers Chromium, including mobile emulation and reduced motion in the existing suite; it does not certify Safari or Firefox.

Next phase, subject to the user's go-ahead: authenticated save/migration/concurrency and historical-journal checks against an isolated database, ingestion fixture regression for executions/fees/positions/P&L/idempotency, real Alpaca entitlement and historical coverage/fallback checks, and a production build. Live provider tests require chart credentials supplied privately through environment configuration. No real database tests, migrations, provider connection, ingestion runs, commits, pushes or deployments were performed in phase one.
