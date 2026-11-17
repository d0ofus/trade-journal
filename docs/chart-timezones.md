# Chart display timezones

The shared chart selector offers **Exchange** (default), **System**, and **UTC**.
It appears in the workspace header, Chart settings, fullscreen controls, and peer
comparison. The device preference applies to every chart view; index and RVOL
panes use their parent chart's timeline. Trade views keep the current device choice.
Missing or invalid preferences use Exchange, including legacy installations.

Exchange requires verified exchange/calendar metadata. Missing metadata produces
an explicit UTC fallback. Supported US-equity peer charts use New York time.
System uses the browser's IANA timezone and rechecks on focus/visibility restoration;
it has no polling or network discovery. Formatting uses each timestamp's historical
offset, including daylight saving. Daily/weekly labels retain exchange trading dates
or the provider's date-only convention.

Date-jump and drawing-coordinate editors display the selected zone and store UTC
instants. Enter or blur commits edits. Changing zone reformats the committed instant
and discards an uncommitted draft. Nonexistent and ambiguous local times require a
different time or an exact entry in UTC. Broker-source diagnostics and reporting dates
keep their own explicit timezone semantics.

The pure `chart-timezone` module provides resolution, cached formatters, conversion,
and capture metadata. Its browser hook only discovers System time and applies native
formatters. Timezone is excluded from history/peer request keys, chart recreation,
indicator dependencies, saved trade views, and dock-layout effects. Candle timestamps,
calendar logic, provider identities, broker interpretation and RVOL calculations are
unchanged. Switching zones neither reloads history nor replaces chart canvases.

Capture freezes native formatting and includes the mode/resolved zone in the image
and optional `chartTimezone` metadata. Metadata records zones per panel or peer ticker
and explicit fallbacks. Document validation and JSON recovery/export retain it without
changing versions or database structure. Historical captures remain their original UTC
images; uploads have no assumed chart timezone. No migration or worker deployment is
required.

## Validation

Release checks passed 285 mock-only unit/provider tests, 71 existing workstation
regressions, and 53 browser scenarios across the focused runs. Browser coverage includes
all modes, synchronized controls, device changes, local-input conversion and DST errors,
native canvas/range preservation, zero extra requests/RVOL calculations/saves, peer
capture metadata, replay, drawing alignment, and both themes at DPR 1, 1.25 and 2.
All six timezone PNGs were visually inspected.

`scripts/benchmark-workstation-timezone.ts` compares the pre-change baseline at
`e297244` with the default Exchange implementation. Each phase uses 20 trials for
one/four charts and warm/cold intercepted transport, with an index pane and four-chart
RVOL. Initial price timing starts at the first foreground candle request; navigation
starts at the actual click. The maximum observed p95 increase was 22.0 ms for initial
price loading; all navigation comparisons passed the 100 ms budget. The maximum
synchronous native formatter update was 0.6 ms, below the 50 ms task budget. These are
controlled development-browser comparisons, not production-provider latency promises.
Raw reports and PNGs remain in ignored `artifacts/timezone-release`.
