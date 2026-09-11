# Chart sizing and execution diagnostics

Implemented on `feat/chart-sizing-execution-diagnostics`. The user approved committing and pushing the reviewed implementation to GitHub `main` on 2026-09-11. This release preserves the existing market-data provider; Alpaca configuration and live history validation are a separate follow-up.

## Local review

- Workstation: <http://localhost:3000/preview/trades>
- MU mismatch example: <http://localhost:3000/preview/trades?scenario=execution-mismatch>

Both previews use browser-local demo persistence, with no requests to the trade database. The mismatch example uses two audited candle fixtures within explicitly synthetic chart context. It is not a complete historical MU chart or a real account review.

### Resizing

Drag the separators between charts. Two charts have one division; three charts have a main division and a secondary division; four charts have a column division and independent vertical divisions in each column. Chart instances stay mounted during resizing.

Focus a separator with Tab and use its axis's arrow keys. Shift makes a larger adjustment. Home/End move to the usable limits. Enter or double-click resets that division. Escape cancels an active drag. **My workspace → Reset chart sizes** restores all default dimensions. Saved presets include chart sizes.

Narrow workspaces stack charts vertically and scroll inside the chart workspace. Each chart's bottom handle changes its height, independently of desktop proportions. Mobile heights are retained on reload.

### Execution labels

The eye button in the chart toolbar switches between full labels and compact, selectable buy/sell markers. A corresponding control is available in individual-chart fullscreen. Chart settings retain the option to hide all execution graphics. Captures and journal chart attachments use the selected mode.

TradingView plot logos are disabled using the documented `layout.attributionLogo` option. Linked credit remains outside the plots, including Focus/fullscreen, with credit in image footers. See [TradingView's API documentation](https://tradingview.github.io/lightweight-charts/docs/5.1/api/interfaces/LayoutOptions#attributionlogo) and [the retained notice](../THIRD_PARTY_NOTICES.md).

### Execution diagnostics

Select a marker, an execution-table row, or an execution in the chart's history panel. Details show the exact stored UTC timestamp, containing candle's end-exclusive interval, low/high, distance outside the candle, provider/feed, adjustment basis, session-date convention and source timezone verification status.

Time matching, price matching, missing candles and source-timezone uncertainty are separate checks. Intraday matching does not bridge missing bars or known regular-session boundaries. Daily/weekly matching uses session-date metadata when known; missing metadata produces an explicit uncertainty indication. Diagnostics and image footers share the same calculation.

The MU example preserves **2026-09-08 15:09:25 UTC**, selling **6 at 1008.71**. The 15:05–15:10 UTC candle's range is **1015.3900–1017.6600**, leaving a **6.6800** price-unit discrepancy. A different candle's price match does not establish the correct execution time.

The archived timezone-free timestamp cannot verify its original timezone. A timezone-bearing IBKR report or trade confirmation is still needed. No automatic time shifts, ingestion changes, historical record corrections, market-data provider changes or database migrations were made. Any timestamp correction requires a separate affected-import and downstream-impact proposal after source verification.

## Screenshots

| View | Dark | Light |
| --- | --- | --- |
| Desktop, resized three charts | [Screenshot](../screenshots/chart-sizing-execution-diagnostics/desktop-dark.png) | [Screenshot](../screenshots/chart-sizing-execution-diagnostics/desktop-light.png) |
| Laptop | [Screenshot](../screenshots/chart-sizing-execution-diagnostics/laptop-dark.png) | [Screenshot](../screenshots/chart-sizing-execution-diagnostics/laptop-light.png) |
| Mobile | [Screenshot](../screenshots/chart-sizing-execution-diagnostics/mobile-dark.png) | [Screenshot](../screenshots/chart-sizing-execution-diagnostics/mobile-light.png) |
| MU execution inspection | [Screenshot](../screenshots/chart-sizing-execution-diagnostics/execution-diagnostic-dark.png) | [Screenshot](../screenshots/chart-sizing-execution-diagnostics/execution-diagnostic-light.png) |

[Actual asymmetric four-chart PNG export](../screenshots/chart-sizing-execution-diagnostics/resized-four-chart-export.png). Screenshots are local review artifacts in the repository's ignored screenshots directory.

## Verification

- Full Vitest regression suite: **527 passed** across 75 files, using the isolated local regression database. Four subsequently added provider/session metadata tests also passed, alongside eight diagnostic tests.
- Existing workstation Node test suite: **30 passed**.
- Mock preview Chromium browser suite: **24 passed**, including six new resize/diagnostic tests and existing history, replay, drawing, date-linking and shortcut tests.
- Authenticated production-build Chromium browser suite: **6 passed**, using the isolated local browser-test database and an external-network fence. Covers authentication, persistence, evidence, cross-tab conflicts, navigation, filters and sign-out draft protection.
- Application and workstation-validation TypeScript configurations, targeted ESLint, repository safety scan, `git diff --check` and the production build passed.
- Visual inspection: dark/light desktop (1800×1100), laptop (1366×900), mobile (390×844), mismatch dialogs and asymmetric image export. Preview inspection recorded no page errors, API requests or horizontal page overflow.

Browser coverage is Chromium, including emulated touch and reduced motion; physical mobile devices and other browser engines were not tested. The existing default TypeScript configuration includes unrelated pre-existing test typing failures; the application's configured build checks and workstation validation checks pass.

Individual-chart screenshots work in fullscreen. To export the entire multichart layout, restore the chart from individual fullscreen first; the UI explains this when needed. Workspace Focus supports layout export.
