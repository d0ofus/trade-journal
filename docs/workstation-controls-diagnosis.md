# Note controls, comparison controls and saving

## Implemented controls

With Select / pan active, drag a text or price-note box to extend or rotate its pointer. Drag its tip independently to change the chart anchor. The box moves to the left of its second anchor when that anchor crosses left of the tip, and to the right when it crosses back. Text boxes are kept within the plot. Existing one-anchor notes acquire a second saved anchor only when dragged; undo/redo, locks, saved reviews and exports use the same drawing data. Coordinates remain editable for precise placement.

**Toggle index comparison** defaults to **Shift+I** in Keyboard shortcuts. It targets the focused chart, remembers that panel's last SPY/QQQ choice across reloads, and uses SPY if neither has been selected. Existing custom assignments take precedence over the new default. Typing exclusions, disabled shortcuts, clearing and remapping continue to apply.

**Index comparison colour** in Chart settings applies to all panels, both indices, the legend and exported images. Rising candles remain hollow; falling candles use a translucent fill. Reset restores the theme's default blue. A colour change updates series styling without replacing candle data or requesting history. The benchmark retains its separate hidden price scale.

## Max notional and legacy metric compatibility

The old peak-cost and metric guards rejected IE's OTHER classification before processing its executions or requesting market data. The approved compatibility rule is now shared by both features: STOCK and ETF are share instruments; OTHER and missing classifications are calculated under an explicit share assumption. Recognisable OCC options and explicitly classified non-share products remain excluded. Nothing changes stored classifications, accounting records or contract multipliers.

Max notional now equals maximum simultaneous allocated shares multiplied by displayed average entry price, excluding fees. Long buys and opening short sells increase holdings; partial exits reduce them. Tooltips disclose the formula and the legacy share assumption. See [trade display](trade-display.md).

IE entered January 7, 2026 retains its resolved timestamp and January 6 reference session. Eligible legacy trades now reach the existing ADR14, ATR14, average dollar volume20 and historical market-cap calculations. Session cutoffs, split adjustments and completed-history requirements remain intact. ETF company market cap stays excluded. Suitable SEC historical shares remain a separate requirement; their absence still explicitly reports **Historical shares unavailable**. Eligibility basis and calculation version 2 participate in client identities and server cache keys/provider identities, including the existing database uniqueness constraint.

## Responsive editing and saving

Both the chart journal and `/journal` Quick Capture keep an immediate in-memory draft, patch the latest field values and save automatically after **1,200 ms of inactivity**. One coordinator permits one server write at a time. Edits during a request remain visible and wait for their own quiet period; responses merge only server revision metadata. **Saved** means the current draft has been acknowledged. Failed writes pause automatic retries and retain the draft until explicit retry or reload.

The chart workspace does not subscribe to text edits: only editor/status subscribers update. Quick Capture fields likewise subscribe separately from the chart and entry list. Tiptap transaction rendering is disabled while its editable DOM remains immediate. Full Entry retains explicit Save Entry; it shares the same draft, revision tokens and write queue. Explicit Save, Save & next, chart-review export and navigation flush the latest draft immediately. Pending image uploads are serialized with text saves, updating the revision after each successful upload and retaining failed attachments.

Recovery uses [asynchronous IndexedDB transactions](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB), checkpointed after **300 ms** quiet or at most **2 seconds** of continuous editing. Image assets are separate from text records and written only when changed; references remain available after a save without copying images again. Records are scoped by editor, entity and browser tab. Reload prefers that tab's pending work, otherwise the latest available draft. A live tab ownership lock separates duplicated tabs whose sessionStorage was copied. Saving or discarding never removes another tab's pending record. Legacy localStorage drafts are removed only after an IndexedDB transaction completes; failed migration leaves them available for recovery/export.

Blur and hidden/pagehide events request checkpoints, and unsaved-change protection remains active. These are supplementary safeguards: [pagehide is not guaranteed during browser shutdown](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event), so regular checkpoints do the durable work. Local-backup failures and server-save failures are displayed separately. Recovery export intentionally remains available without requiring a successful server save.

Automatic candle-history loading remains unchanged. No PostgreSQL migration or separate worker deployment is needed.

## Validation for this batch

Targeted validation covers 74 unit/database cases (including the shared save queue, IndexedDB rollback, tab ownership, notional histories, legacy options, cache identities and IE's January 6 reference), plus 42 existing workstation/history/shortcut regressions. Authenticated browser checks use the disposable local PostgreSQL database, with market feeds and TradingView's external widget stubbed. They cover actual server saves, slow responses, navigation, attachments, manual Full Entry saves, failed-save recovery, duplicated tabs, conflicts and creation/refresh without duplicate entries. Preview checks cover migration failure, section attachment recovery, exported review preservation, max notional on mobile and replay masking.

In local Chromium development profiling, 136 chart-journal inputs with six large screenshots and 135 Quick Capture inputs with three large pending screenshots produced zero full-draft serializations and zero chart DOM mutations during typing. Input-to-next-paint p95 was 19.4 ms and 17.2 ms respectively; these are local measurements, not a guarantee for every device. Laptop and mobile layouts were visually inspected, and Quick Capture's mobile grid overflow was corrected. Targeted lint/type checks, repository safety and a production webpack build are included in delivery validation.
