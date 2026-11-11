# Drawings on the separate index pane

Text note (`N`), Horizontal ray (`R`) and Horizontal line (`H`) work on the lower
SPY/QQQ pane through the existing toolbar. Click inside the index plot to place
one. Notes, labels, styling, coordinates, locking, visibility, deletion and
undo/redo use the ordinary drawing controls. Text boxes can be dragged and resized.

Each index drawing records its symbol and chart scope. Switching to another
index, hiding the index or returning to overlay mode hides the drawing without
deleting it. Restoring the matching separate pane restores its drawings. The
existing **All trade charts** scope applies only to panes showing that index.
Other drawing tools remain available on the stock chart.

## Coordinates and persistence

Optional `Drawing.target = { kind: "benchmark", symbol: "SPY" | "QQQ" }` identifies
index drawings; absent metadata retains stock-chart behavior. Targeted drawings
are validated only for the three supported tools. The HTTP endpoint, document
schema version 1 and database schema remain unchanged.

Stored anchors use raw index prices. Rendering and coordinate edits use that
index's split metadata, independently of the stock's adjustment. Missing matching
data disables coordinate editing and placement; other saved properties remain
available. The drawing list and properties identify the index explicitly.

Each pane uses its own price scale, native plot bounds and clipping. Hit regions,
note anchors and handles include the measured separator offset. Index dragging
stays on that surface when the pointer crosses into the stock pane. Magnet mode
uses index OHLC values and the common timeline. Before Trade and replay retain
their completed-candle and drawing-availability limits.

New captures freeze both drawing groups, clone their price scales and measure the
captured pane geometry before painting annotations. Older PNG assets are unchanged.
The clone scales the measured time-axis height as well as its fonts and restores
the frozen primary-pane height, avoiding padding-related offsets at different DPRs.
No database migration, separate worker or new endpoint is required.

## Verification

Focused tests cover document compatibility, HTTP save/load validation, pane hit
geometry, supported targets, symbol filtering, split projection and historical
visibility. Browser tests cover the three tools, scope and mode changes, editing,
locking, hiding, deletion, undo/redo, reload, cross-pane dragging, separator resizing,
fullscreen, historical modes and live/capture alignment in both themes at DPR 1,
1.25 and 2. Browser verification uses synthetic preview data; application API calls
are blocked, and HTTP persistence tests use in-memory mocks.

Local validation on 10 November 2026 passed 14 focused unit/HTTP checks, all 71
existing workstation checks and 32 distinct browser scenarios across targeted
runs. The affected capture scenarios were rerun after the axis-height correction;
all 12 passed, including the saved journal snapshot. Exported dark/light PNGs were
visually inspected. Two older capture tests now inspect the generated PNG Blob
instead of Chromium's intermittently locked Windows download file, retaining
their image-content assertions.

Workstation TypeScript, affected-file ESLint, repository safety and the production
build passed. No production data, external publication or deployment was changed.
