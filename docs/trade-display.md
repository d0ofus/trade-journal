# Workstation execution times, session backgrounds and peak cost

## Execution times

Execution details show the interpreted New York time and its UTC equivalent first. For example, 7 January 2026 at 09:30:01 EST is 14:30:01 UTC. The existing interpretation already supplies that UTC instant; the display does not convert it again. Summer dates use EDT. Explicit source offsets stay authoritative, and unresolved interpretations keep their warnings without receiving an inferred Eastern timezone.

The original database value, available broker timestamp and interpretation revision remain under a keyboard-accessible **Technical details** disclosure. Source-matched timestamps and user-confirmed timezones are identified separately. Imported records, account/report policies, execution placement and accounting are unchanged.

## Extended hours

Identified US-equity extended sessions use one background shade outside the exchange's regular hours: `#171e2b` in dark mode and `#f2f5fa` in light mode. The existing New York calendar supplies DST, holidays and early closes. Shading applies to 5m, 10m, 15m and 1h charts, including shared journal workstations and PNG captures. Regular sessions, daily/weekly candles and unknown calendars retain their backgrounds.

The series primitive draws underneath the grid, candles and volume. It classifies only visible calendar days, bounds its calendar cache to 512 entries, and reuses logical bands until the visible bars or rendered data change. The installed Lightweight Charts version accepts only integer indexes in `logicalToCoordinate`; the primitive interpolates between integer coordinates to split mixed hourly candles at the actual open. Missing time has no candle column, and bands stop at the rendered data boundary, including replay.

The primitive receives existing rendered-data references alongside the existing series update and attaches separately to export clones. It adds no history request, candle processing pass, React update, timer or independent animation-frame loop. Pointer sweeps do not repaint the shading.

## Peak position cost

Each **Your Trades** item shows `fills · shares · Max $amount`. This is the highest entry cost of shares held simultaneously, using the trade's allocated execution rows in canonical order. Scale-ins add lots; exits consume FIFO trade lots at their entry cost. Short trades use positive entry value. Fees and exit proceeds do not inflate the result.

For example, buying 100 shares at $10 and another 100 at $12 reaches $2,200. Selling the first 100 shares and buying 100 at $11 subsequently reaches $2,300. The existing share count and separate Largest Notional metric retain their definitions.

Values are memoized when trade data changes and formatted in the trade's native currency with two decimals. There is no FX conversion. Incomplete entry histories, invalid values and unsupported contract multipliers show an explained unavailable marker. Values are masked during replay. No schema, public API, dependency or preference changes are needed.

## Validation

The local validation uses synthetic fixtures and a guarded loopback PostgreSQL cluster. Unit/integration tests cover timestamp provenance, lot matching, calendar boundaries, geometry invalidation and existing history/cache behavior. Browser tests cover one through four panels, themes, sessions, replay, exports, fullscreen, resizing, disclosures, mobile cards and authenticated saved views.

The production benchmark compares main at `3a01db4` with the changed build, alternating build order, restoring identical cache fixtures before each navigation and excluding warm-up pairs. Both builds use the same offline provider double with a 50 ms response delay, Node 22.23.1 and Chromium. No live provider calls are permitted. Run `scripts/benchmark-workstation-ohlc.ts` using its existing isolated database guard and `WORKSTATION_OHLC_BENCHMARK=1`; set `WORKSTATION_OHLC_SESSION=extended` or `regular` and `WORKSTATION_OHLC_SAMPLES=10`. Explicit session runs write to `artifacts/ohlc/display-<session>/`. Extended runs additionally assert that the changed build actually paints shading in its intraday panels.

### Measured results — 15 September 2026

All **120 unit/integration tests**, **39 workstation/history tests**, **32 preview browser tests** and **7 authenticated browser tests** passed. Application/workstation TypeScript, targeted ESLint, the production build and repository-safety checks passed. Browser instrumentation confirmed zero shading repaints on pointer sweeps, preserved the OHLC controller's synchronous updates and detected no added chart commits or storage writes during movement. A fresh 10,000-update real-DOM OHLC run measured a **0.1 ms p95** and **0.4 ms maximum**; its attachment is preserved in `artifacts/trade-display/ohlc-interaction-timing.json`.

The extended-session production comparison contains **120 measured navigations**, ten per build/scenario/panel-count combination, with warm-up pairs excluded. Each changed run painted the expected session backgrounds: one intraday panel in the single-panel case and two in the four-panel case. The viewport was 1920×1080. Values below are median milliseconds from navigation to candle paint.

| Panels | Cache | First panel: baseline → changed | All panels: baseline → changed | Candle HTTP calls, both builds | Provider-double calls, both builds |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | Cold | 3080.3 → 2904.3 | 3080.3 → 2904.3 | 3 | 1 |
| 1 | Partial | 416.5 → 410.5 | 416.5 → 410.5 | 3 | 1 |
| 1 | Warm | 416.6 → 419.0 | 416.6 → 419.0 | 2 | 0 |
| 4 | Cold | 3284.3 → 3153.3 | 6763.9 → 6751.3 | 12 | 4 |
| 4 | Partial | 507.3 → 536.8 | 4027.8 → 3528.7 | 12 | 4 |
| 4 | Warm | 523.7 → 516.8 | 547.8 → 541.1 | 8 | 0 |

No repeatable loading slowdown was detected in these runs. Every scenario's paired mean difference had a 95% confidence interval containing zero, for first-panel paint, all-panel paint and the first panel's response-to-paint interval. Gap-fill timings were variable, especially for partially cached four-panel loads; these observations are regression evidence, not a production latency or statistical equivalence guarantee. Candle HTTP and provider-double counts matched in every measured pair, and all warm samples made zero provider calls.

Raw loading samples and confidence intervals are in `artifacts/ohlc/display-extended/`. Screenshots and the exported chart are in `artifacts/trade-display/`. These local artifacts are gitignored. Release requires only the existing Vercel application deployment, with no migration or separate worker service.
