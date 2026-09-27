# Dashboard presentation

The dashboard uses the application's shared appearance preference and workstation color tokens. Its reporting loader, date resolver and accounting calculations are unchanged.

Six overview metrics remain visible across Performance, Entry timing and Breakdowns. All 24 original metric definitions, eight charts, the entry heatmap and four breakdown tables remain available. Definitions, import freshness and the matching-trade link are shared across tabs.

The optional `tab` parameter accepts `performance`, `timing` or `breakdowns`; missing and unknown values use Performance. Tab navigation uses browser history with the already-loaded report, preserving date-input drafts and the heatmap selection. Applying filters and choosing date presets preserve the active tab. Only visible performance charts are mounted; their underlying report values are not changed.

Dashboard styles are scoped to `.dashboard-workspace`. Other application pages retain their existing surfaces. Responsive tables scroll within their panels, and report tabs support arrow keys, Home and End.

| Location | Preserved reports |
| --- | --- |
| Above tabs | Six overview metrics |
| Performance | Eight charts and 15 outcome, cost and consistency metrics |
| Entry timing | Weekday / 30-minute entry heatmap with all four metric choices |
| Breakdowns | Three activity metrics and four breakdown tables |
| Across tabs | Account and date controls, cohort and sample sizes, freshness, definitions and matching-trade link |

Both the route-level and streamed loading states use dashboard colors. The route error boundary retains the selected URL and offers a retry without exposing server error details.

Release verification includes a same-database, frozen-clock comparison against the preceding reporting implementation, all date presets and drilldowns, dark/light desktop/mobile captures, report inventory checks and a network assertion for tab and appearance changes.

The September 2026 release compared complete reports and drilldown trade IDs against `25104c1` on the same restored database at `2026-09-27T12:00:00Z`. All Time, YTD, 3 months, 6 months, a custom range and an empty range were byte-identical. The combined JSON SHA-256 was `5df195ef2ca6fe40290c0ff9a99e87f5f970f1490bbe61ce8e3025aecf483d26`. Private fixture data and screenshots remain outside Git. Nine dashboard browser checks passed, including desktop/mobile in both themes, and a separate isolated database-failure check verified the themed error boundary and retry.
