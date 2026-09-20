# Chart controls and drawing improvements

Earnings markers are deferred. This change adds no data provider, API endpoint, Market Overview dependency, or database migration.

- Chart settings expose four SMA period fields. Blank fields disable unused averages; periods must be distinct integers from 1 to 500. Existing defaults and chart-specific colour palettes are unchanged.
- Restored narrow chart views load bounded pre-range indicator history, keeping their visible dates unchanged. This fixes longer averages disappearing on reload and in captures; missing provider history is never synthesized.
- Price & time measurements have independent **Extend left** / **Extend right** options, both off by default. Both price boundaries extend together in each selected direction. Extended lines have narrow selection targets and respect chart clipping.
- Planned entry/exit drawings render as 12-by-10 CSS-pixel up/down triangles with their tips at the saved coordinates. New tool defaults are green/red; saved colours remain unchanged. **Show price** defaults on, and hiding it never hides custom notes. Execution, stop and target markers are unchanged.
- Selected-drawing properties and tool defaults expose the new switches. Drawings retain schema version 1 through optional `extendLeft`, `extendRight`, and `showPrice` fields. Autosave, recovery, JSON exports and PNG captures reuse the existing paths.
- TradingView attribution is in Help and the existing peer-comparison footer; notices and exported-image credits remain intact.

## Validation

Use Node 22 for the current Vitest dependencies. Run workstation unit/provider suites, the chart-preferences and review persistence/export suites against isolated PostgreSQL, focused preview browser suites (chart controls, drawing tools, sizing and peers), `tsc -p tsconfig.build.json --noEmit`, `check:workstation:validation`, relevant ESLint, and `npm run build`.

Verified locally on 2026-09-20: 54 workstation unit tests, 116 mocked provider/API tests, 31 isolated database/preferences/export tests, and 23 preview browser tests passed. Application/focused TypeScript checks, relevant lint, repository safety, and the production build passed. Browser checks verify all four SMA colours in the actual captured PNG and peer canvases, and unchanged visible dates after reload. Broad `tsc --noEmit` also includes unrelated legacy test suites and reports type errors there; the build and workstation validation configurations above are clean.

Windows currently reserves the old disposable PostgreSQL port 55439. The authenticated test configuration and synthetic visibility seed also accept **127.0.0.1:15439**, still requiring the exact `trades_workstation_auth_test` database and normal test-database mutation safeguards. Production database targets remain prohibited. No reserved-port settings were changed.

Authenticated production-build browser validation must be run separately: the isolated test-server launch was blocked by the execution environment during this implementation. Database-backed endpoint tests use mocked authentication and do not substitute for that browser login check.
