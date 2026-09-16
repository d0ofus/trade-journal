# Note controls, comparison controls and remaining fixes

## Implemented controls

With Select / pan active, drag a text or price-note box to extend or rotate its pointer. Drag its tip independently to change the chart anchor. The box moves to the left of its second anchor when that anchor crosses left of the tip, and to the right when it crosses back. Text boxes are kept within the plot. Existing one-anchor notes acquire a second saved anchor only when dragged; undo/redo, locks, saved reviews and exports use the same drawing data. Coordinates remain editable for precise placement.

**Toggle index comparison** defaults to **Shift+I** in Keyboard shortcuts. It targets the focused chart, remembers that panel's last SPY/QQQ choice across reloads, and uses SPY if neither has been selected. Existing custom assignments take precedence over the new default. Typing exclusions, disabled shortcuts, clearing and remapping continue to apply.

**Index comparison colour** in Chart settings applies to all panels, both indices, the legend and exported images. Rising candles remain hollow; falling candles use a translucent fill. Reset restores the theme's default blue. A colour change updates series styling without replacing candle data or requesting history. The benchmark retains its separate hidden price scale.

## Peak position cost: diagnosis and proposed fix

`peak-position-cost.ts` rejects every nonempty asset type except STOCK and ETF before examining executions. The reported multiplier message is that eligibility guard, not a missing historical price request. Eligible trades calculate the greatest simultaneous FIFO entry cost, excluding fees. This is cost basis, not the maximum market value after price appreciation.

A read-only production check on September 16, 2026 confirmed that all seven stored IE instrument records are classified OTHER. The sampled earliest execution on each record supplied no usable archived source classification or parser version. This confirms the present classification problem but does not establish which historical import produced it. Other rejected instruments can be legitimate options, futures or other unsupported products; they cannot safely receive a blanket multiplier of one. The current Instrument and workstation Trade models do not carry a verified contract multiplier.

Recommended first fix:

1. Resolve instrument identity once on the server and share the result between peak cost and market metrics. Prefer broker security type/contract metadata or a verified archived import row, matched by instrument, currency, exchange and applicable trade date. Record the evidence and distinguish verified equity, verified ETF, derivative, ambiguous and unresolved results. Current ticker-only lookup is insufficient for reused symbols or historical instruments.
2. Allow legacy OTHER rows only when resolved as equity/ETF, using share multiplier 1 for peak cost. Preserve option-symbol detection as an explicit exclusion and leave unsupported or unresolved instruments unavailable with a precise reason.
3. Keep this compatibility resolution separate from canonical executions, accounting and trade identity. Produce a reviewable audit before any later classification backfill, because changing asset type can collide with existing Instrument uniqueness keys.
4. Treat contract products as a separate extension: verify their contract multiplier and quantity convention before using quantity × entry price × multiplier. Never assume every option has multiplier 100 or every future has multiplier 1.

Test legacy equities, ETFs, OTHER option symbols, explicit derivatives, ambiguous tickers, partial closes, short positions, scale-ins, currency handling and incomplete execution cycles. Reconcile corrected examples to broker entry costs.

## Market metrics: proposed implementation

The previously confirmed IE trade entered January 7, 2026 has a resolved execution time and January 6 reference session. `loadTradeMetrics` rejects its OTHER classification before any daily-history or SEC request; all four fields receive **Unsupported instrument**. Age itself is not this failure's trigger.

Use the shared verified instrument resolution above to admit eligible legacy equities to the existing calculations. Retain the previous-session cutoff, completed-session windows, split adjustments and existing formulas. Keep ETFs eligible for volatility/dollar-volume metrics but exclude them from company market cap. Include resolved asset type and resolver/calculation versions in the metric cache identity so eligibility corrections do not reuse incompatible results. Unresolved identities should show **Instrument type needs verification**, separately from insufficient history, unavailable feed or unavailable SEC shares.

This should unlock ADR14, ATR14 and average dollar volume20 where daily history is sufficient. Market cap remains conditional on suitable historical SEC share observations and filings available at the reference date. Fixing classification does not guarantee historical market-cap coverage, and present-day shares should not substitute for unavailable history. No classification, eligibility, calculation or metric-cache behavior is changed in this release.

## Journal lag: diagnosis and proposed implementation

The current persistence hook already applies a 700 ms trailing debounce to server autosaves. However, every edit updates the workstation React state and synchronously serializes the entire review, including inline screenshots, into localStorage. A save that finishes while further edits are pending immediately loops into another save. The formatted editors also compare and potentially replace content as parent values change. These are concrete sources of work on the typing path; their contribution to a specific user's delay still needs browser profiling.

Recommended implementation:

1. Keep keystrokes and selection in Tiptap immediately. Update an in-memory document draft synchronously, but isolate editors from chart/workspace renders and publish preview changes on a short coalesced schedule. Never echo an older save response into an actively edited field. Only explicit trade loading, recovery or external replacement should reset editor content. This follows [Tiptap's integration performance guidance](https://tiptap.dev/docs/guides/performance).
2. Schedule a server save **1,200 ms after the last edit**. Restart that quiet-period timer on every change. Allow one request at a time; merge its revision metadata into the latest draft, then wait for the remaining quiet period before another automatic save. Explicit Save, Save & next, navigation and export must drain the latest draft immediately and await success.
3. Move recovery drafts to asynchronous IndexedDB, with text changes coalesced after about **300 ms**, a bounded periodic checkpoint during uninterrupted typing, and image assets stored separately once per change. This avoids repeatedly serializing megabytes of base64 on the main thread. Preserve old localStorage drafts during migration until the new recovery copy is durable. Report recovery failures distinctly from server-save failures.
4. On blur, visibility change and page hide, request an immediate local checkpoint. Keep the unsaved-change protection for pending work; do not claim that an asynchronous network request is guaranteed to finish during browser shutdown. Preserve revision-conflict handling, retry and recovery after reopening.

Validate with image-heavy reviews, rapid typing, IME composition, formatted lists, slow responses, offline failures, trade switching, close/reload recovery and conflicting tabs. Measure input-to-paint latency and verify that storage serialization and full-workspace rendering no longer run for every character. Autosave timing and persistence are unchanged in this release pending the requested proposal review.
