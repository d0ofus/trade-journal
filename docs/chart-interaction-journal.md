# Chart interaction and journal usability

## Behavior

- Execution details open with quantity/price, the real diagnostic status, execution time and resolved UTC equivalent. Other fields remain under **More details**; changing execution resets the disclosure.
- Dark-theme journal text is near-white, including unfocused rich-text fields. Light-theme styles and backgrounds are unchanged.
- Chart settings independently customize rising volume, falling volume and the average-volume line with a colour and 0–100% transparency. Missing overrides retain the previous renderer/theme defaults. Explicit overrides apply to workspace, fullscreen, peers and new captures. Calculations and period settings are unchanged.
- OHLC adds signed, two-decimal change from the preceding loaded candle's close in the same timeframe/session/display basis. Missing, zero or invalid previous closes produce an em dash. The lightweight legend owns these DOM slots; pointer movement does not rerender React charts.
- A horizontal ray can be moved in both axes by its stroke or label, preserving the pointer offset. The existing whole-drawing translation handles snapping, logical bar spacing, split-adjusted coordinates, boundaries, locking, cancellation and one undo step on release. Handles remain available.
- Selecting a drawing scrolls its highlighted row only when Drawings is visible, without moving chart focus or opening/switching panels. Opening Drawings later reveals the selected row.
- **Pin** uses one anchor, configurable colour and wrapped annotation text. Notes appear on hover, keyboard focus or touch tap. Double-click or F2 opens annotation editing. Drawing defaults, hide/show, locking, dragging, undo and replay filtering remain shared with other tools.
- **Include pin notes in captures** is a shared device preference, off by default. Chart settings and capture/export dialogs expose it; direct section captures follow the same setting. Off includes only visible pin icons. On uses the live renderer's wrapped, boundary-clamped bubbles.
- **Show Executions**, **Show Evidence** and **Show Drawings** are configurable commands, initially unassigned. Existing bindings remain unchanged; editors and dialogs retain normal typing. Explicit panel commands leave Focus/fullscreen as needed.
- Focus mode has a Journal toggle, initially closed each Focus session. Its sidebar can be resized without exposing other panels. Focus-only dock moves/sizes are temporary; exiting restores the normal saved dock arrangement. Mobile uses the existing journal view.
- Section and Evidence thumbnails open a viewport-fitted image dialog. Separate download icons remain beside thumbnails and inside the viewer. It supports keyboard activation, focus trapping/restoration, Escape, and automatic closure after trade changes or image deletion.

## Replay and persistence

Replay edits the same saved review. Notes, properties, image uploads/paste, assignments, detachment, deletion, captures and exports remain available; stale trades stay read-only. Existing notes/evidence are not hidden by their creation times. A notice warns that they may contain hindsight. Replay ticks do not invalidate an unrelated pending import.

Opening peers pauses playback, which stays paused on close. The frozen replay cursor is carried through timeframe changes, linked navigation, indicators, reference markers and capture metadata. Primary/peer series filter with the shared completed-candle rule before applying Before entry, so neither mode reveals later candles. Capture handles freeze chart state at initiation, before waiting for rendering/saves; replay captures are visibly labelled and carry optional `replayAt` seconds since epoch. Leaving replay restores the normal chart view without reverting journal edits.

Document schema stays **1**. Changes are the `pin` drawing discriminator, optional evidence/peer-capture `replayAt`, and validated device preferences `volumeStyle` and `capturePinNotes`. Portable JSON retains metadata; portable/Notion page exports include replay cutoff captions and reuse stored images across assignments. Existing saved PNGs are never rewritten. No public endpoints, provider additions, database migrations or Worker changes are needed.

The separate [Notion API assessment](notion-api-assessment.md) describes a future publishing workflow; no live connection is added.

## Validation

Use Node 22, the existing synthetic preview server and a disposable, loopback-only PostgreSQL database. Never use Neon for destructive test fixtures.

- Workstation and provider test commands remain `npm run test:workstation` and `npm run test:workstation:providers`.
- `tests/workstation-preview/chart-interaction.spec.ts` covers execution disclosure, ray-body movement/locking, drawing-list navigation, pins/captures, Focus journal sizing/restoration, shortcut typing exclusions, replay editing/captures/viewer, peer timeframe cutoffs, volume preferences and journal contrast.
- Evidence import tests also exercise every destination during replay and a clipboard decode spanning replay ticks. Existing drawing, layout, shortcut, OHLC, peer, journal recovery and export regressions remain applicable.
- Isolated PostgreSQL tests cover authenticated endpoint saves (mocked session), pin/replay metadata, revision checks, recovery/backup and asset placement. These do not substitute for a real authenticated browser session.
- Run application/focused TypeScript checks, relevant ESLint, current-file repository safety and production build. A hosted preview and real authenticated browser validation are separate gates; neither a synthetic local preview nor endpoint tests establish those gates.

No commit, push or production deployment is part of this implementation request.

### Local validation record — 2026-09-20

- Passed: 65 workstation unit tests; 118 mocked provider/API tests; 72 focused persistence, backup/recovery, export and legend/preference tests. Suite counts overlap; they are not a unique-test total.
- Browser coverage: 54 distinct preview scenarios. The combined run passed 53; a development hot reload interrupted the replay case while the final selection fix was being applied. A subsequent clean run passed all seven interaction scenarios, including that replay case, repeated selection, pins, Focus layout, touch and volume controls.
- Passed: application and focused validation TypeScript, relevant ESLint, current-file repository safety (zero findings), and optimized production build. Stale generated development route types were regenerated/removed before the clean build; no source validation was excluded.
- Database tests/build used isolated local PostgreSQL, not Neon. The local preview and PostgreSQL processes were stopped afterward.
- Not run: real-login authenticated browser validation and hosted Vercel preview validation. The previously blocked authenticated-server launch was not bypassed. Mock-authenticated endpoint checks are not a substitute for that gate. No production/provider credential verification or historical Git remediation was performed.
