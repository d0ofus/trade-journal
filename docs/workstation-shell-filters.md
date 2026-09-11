# Workstation navigation and filters

Implementation branch: `feat/workstation-shell-filters`. The reviewed implementation is approved for merge into `main`. This phase requires no database migration or environment change and retains the existing production market-data provider and ingestion mechanism.

## Behavior

- All authenticated application routes use the same 58px navigation rail, with an optional expanded label view, real destination links, sign out, and a mobile navigation drawer. The prototype and application share the component; the database-free demo exposes only its Trades and Journal destinations.
- Navigation and workstation views share appearance tokens and a device-local theme preference. Existing workstation themes are adopted when no new appearance preference exists. Other pages retain their original content styling. Demo appearance/navigation preferences are separate and clear with Reset demo.
- Workstation pages fill the available viewport without the old white wrapper, external filters, or duplicated navigation. Focus and chart fullscreen hide the outer navigation. Empty results retain navigation and usable filters.
- Your trades contains the three-line filter disclosure, active-filter count, applied date summary, and all prior filter fields. The filter form scrolls within half the panel height. Apply saves the active review before changing the URL; quick dates apply immediately with the draft fields. All time clears dates, while Clear all also resets local search and Unexported filtering.
- Dates retain their existing quick-range meaning and inclusive UTC server boundaries. Validation accepts open-ended dates and rejects invalid/reversed ranges. The selected trade cannot bypass the filtered server query. If excluded, the chart, review, and URL resolve to the next matching trade, or to an empty result without an empty-ID review request.
- Pending saves delay filter/navigation actions; failed or conflicting saves retain the active review and filter draft. The existing navigation guard remains in place for legacy editors. Shared-rail navigation requests that guard after awaiting the save, avoiding duplicate checks.
- No trade ingestion, import, accounting/materialization, market-data provider, candle API, or persistence schema changes are included.

## Review locally

- Mock preview: http://localhost:3000/preview/trades. Deterministic candles and browser-local reviews; no database access.
- Complete authenticated application: http://127.0.0.1:3101/trades. Public synthetic test login: `phase2-reviewer` / `phase2-local-test-only`. These credentials are only for this isolated local harness, never Vercel.
- The authenticated server uses the disposable PostgreSQL browser database, demo-only writes, and an external-network fence. Its charts use synthetic cached candles, so coverage warnings do not describe production data availability.

The existing guarded launch instructions in [phase two](./trades-workstation-phase-two.md#authenticated-browser-validation) apply. Rebuild the scratch production copy after later application edits; it does not reload automatically. The development mock preview reloads source changes.

## Verification

- 512 Vitest tests across 73 files passed using the isolated regression database, including combined filters, calendar boundaries, URL serialization, and strict selected-trade filtering.
- 30 workstation node tests passed.
- 18 Chromium mock-preview browser tests passed, covering the existing chart/drawing/history/replay/export/shortcut behavior and the new filters, navigation, mobile controls, theme persistence, viewport sizing, and bounded filter scrolling.
- Six authenticated Chromium production-build tests passed, including all seven navigation destinations, canonical reviews, PostgreSQL autosave, empty-result recovery, waiting for in-flight saves, and blocking filters/sign-out on conflicts.
- After final selection/theme refinements, the six targeted filter/shortcut browser tests passed again. The final production snapshot matches every current application-source file; all six authenticated checks passed again against that build.
- Application TypeScript, validation TypeScript, targeted ESLint, production compilation, repository safety checks, and `git diff --check` passed. Browser coverage is Chromium, including mobile emulation and reduced motion; Safari/Firefox are not claimed verified.

Screenshots are under the ignored `screenshots/workstation-shell-filters/` directory, with authenticated desktop/empty-result examples and dark/light desktop, laptop, and mobile views.
