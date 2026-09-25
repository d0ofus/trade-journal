# Chart notes, captures, index display and publication captions

## Behaviour

- New text/price notes and pins start with empty saved text and focus their annotation editor. The live empty-text hint is not part of the note or a captured image.
- Text and price-note labels wrap, including explicit line breaks. Resize a selected, unlocked box using its outside-edge handle or the **Note width** field (80–800 logical pixels). Width is also a per-tool default. Resizing changes neither time nor price anchors and supports undo/redo. Peer notes use the same renderer and interaction behaviour.
- Measurements expose **Positive percentage colour** and **Negative percentage colour** both per drawing and in tool defaults. Defaults are green `#22c55e` and red `#ef4444`. Only the computed percentage changes colour; custom notes, price differences, intervals, bars and line colours remain independent. Zero or unavailable percentage retains the drawing colour.
- **Chart settings → Index transparency** controls the index candles. **Index display** (also in each chart toolbar) switches between overlay and an independently scaled lower pane inside that chart. Drag the native separator or use **Index pane height**. Display mode and pane height persist with the trade view; transparency persists with display preferences. Workspace tile count and outer dimensions do not change.
- Entering fullscreen (`F`) or Focus (`Shift+F`) preserves an already visible Journal. Hidden or obscured journals do not open unexpectedly. The existing single editor and normal-layout restoration are retained.
- Fresh Notion publication previews omit image captions entirely. Filenames, hashes, capture context and asset references remain internal. A presentation-version key allows an unchanged review to prepare the new format instead of reusing a completed older job. Publication still requires confirmation; unfinished jobs keep their frozen captions and plans. Existing Notion pages are not changed during this release.

## Capture corrections and limitations

The drawing renderer previously passed a maximum width to canvas `fillText`, which can squeeze glyphs rather than wrap them. Labels now wrap at normal font proportions. Live/capture top constraints are consistent. Workspace captures preserve the resolved chart/price-scale options, frozen ranges and pane proportions; drawing coordinates use the captured primary pane rather than the entire multi-pane chart. Peer composition scales annotations by the actual output bitmap dimensions, including even-pixel/DPR rounding.

Existing PNG assets and assignments are never rewritten. Recapture affected images to obtain the new rendering. No screenshots accompanied the latest report, so its particular images could not be compared directly; these corrections address reproducible code paths, not a verified diagnosis of those missing examples.

## Validation and release boundaries

Focused unit tests cover colour selection, legacy defaults, all measurement-label combinations, no compressed glyphs, wrapping/resizing geometry, schema validation, pane/opacity settings and capture sizing. Isolated PostgreSQL tests cover saved note widths/colours, blank new Notion captions, exact original image bytes and frozen-job compatibility. Browser tests cover immediate typing, resizing/undo/reload, peer tools, Focus/fullscreen Journal preservation and live/export alignment at DPR 1, 1.25, 2 and 3.

No schema migration, credential change, new endpoint or Worker change is required. No live Notion publication, production write, commit, push or deployment is part of this task. Local demo-browser and isolated-database validation are not live authenticated/deployed-preview validation.

Validated locally on 25 September 2026: 71 workstation tests, 65 focused unit/isolated-PostgreSQL tests, 122 provider regressions and 40 targeted browser scenarios (including corrected regression expectations). Focused TypeScript, changed-file lint, repository safety and the production build passed. The index-pane live/capture images were visually inspected. Browser regression checks also found and fixed loss of viewer keyboard focus while downloading an image; Escape remains usable after the download.
