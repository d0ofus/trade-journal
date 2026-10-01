# SMA50 distances, drawing input, and empty Notion sections

## Metrics

The pre-trade runner and its shared export formatter include SMA50 distance in
ADR14% and ATR14% units. For reference-session close C and the mean of 50
consecutive completed closes S, distance is `100 * (C / S - 1)`. Divide that
percentage by the existing ADR14% or Wilder ATR14% respectively. Positive values
are above SMA50; negative values are below it. Display signed two-decimal multiples.

The cutoff remains the previous trading session before the first verified
execution, using the existing split-adjusted daily history. There is no additional
provider request. Missing reference sessions, incomplete SMA50 history, and missing
or zero volatility denominators produce Unavailable with a reason. Metric response
fields are `sma50AdrMultiple` and `sma50AtrMultiple`; calculation-cache version 3
regenerates older entries on access. Database schema and cache caps are unchanged.

## Drawing responsiveness

Static history inspection found that each drawing keystroke already updated the
workspace in the original implementation. Commit 172b872 added more wrapping work
for multiline note layout. Profiling confirmed substantial per-keystroke React
rendering and all nine visible peer overlays repainting for one edited ticker;
it does not establish a single commit as the sole cause of the user's slowdown.

Annotation inputs now subscribe directly to their text in the existing draft
store. The draft changes synchronously on every input; the surrounding workspace
render runs as a React transition. Live overlays and captures read current drawings
directly, without waiting for that render. Undo history also updates synchronously.
Server autosave and recovery checkpoint intervals are unchanged.

Trade rows, review content and evidence have memoized boundaries with current
callback forwarding. Review subscriptions select relevant content/save changes;
template context and peer drawing controls retain stable identities. Unrelated
peer charts no longer repaint. Canvas text layouts use a bounded per-context cache,
and execution visibility is calculated once per main-chart paint.

The repeatable Chromium development-mode sequence in `drawing-typing.spec.ts`
measures input-to-next-frame latency, React commit durations and canvas operations.
A baseline run measured main/peer p95 at 193.8/166.7 ms, with nine peer overlays
painting 85 times each. After optimization, a run measured 9.7/29.4 ms, and only
the edited peer painted. Main text measurements fell from 4,200 to 1,824.
These synthetic local development measurements are comparative, not a production
latency guarantee. React development JSX work was prominent in a CPU profile.

## Notion presentation version 3

Whitespace-only rich text, empty paragraphs and empty lists produce no section
text blocks. A section without text or assigned images has no generated callout.
Evidence-only sections still publish. Missing original evidence remains an error.

Section bindings retain anchors even without containers. A confirmed update
archives an old app-owned box only after fingerprint verification. A persisted
removal intent reconciles a lost response; final verification detects restoration
of removed boxes. Template headings, placeholder bullets, and other Notion content
remain untouched. There is no bulk cleanup or automatic Notion publication.

Plans/status JSON expose `presentationVersion`. Missing versions represent legacy
plans: unfinished jobs retain their frozen behavior. Completed older publications
can prepare an explicit format-upgrade preview, separately from detecting newer
review content. Review completion still occurs only after all publishing steps.
All additions use existing JSON fields; no migration or separate worker is needed.

## Validation

Validated with 107 focused unit/integration tests, including publisher operations
against isolated PostgreSQL with mocked Notion responses. All 14 browser tests
passed: main/peer typing, composition and caret handling, undo/redo, recovery,
trade switching and reload, peer isolation, PNG alignment at four pixel ratios,
and an explicitly confirmed legacy-publication format update.

The final browser run measured main/peer input-to-next-frame p95 at 24.5/17.3 ms;
development-mode timings vary between runs. Typing triggered no additional market
data requests or visible-range resets. Only the edited peer overlay repainted.
Type checks, affected-file lint, repository safety checks, and the production build
passed. Production data and Notion pages were not modified during validation.
