# Drawing visibility and external evidence

The later [chart/journal interaction release](chart-interaction-journal.md) supersedes this release's replay attachment restriction: journal and evidence editing are now available during replay, while stale trades remain read-only.

## Behavior

- Selected drawings have a Hide/Show action in the bottom properties banner. This saves the existing per-drawing visibility flag and participates in undo/redo; the banner stays available for showing the drawing again.
- The Drawings panel's Hide all switch is a temporary rendering filter across the workspace, fullscreen, and new captures. It does not rewrite drawings, preferences, saved views, or execution markers. Switching trades, reloading, or choosing a drawing tool restores the normal visibility filter.
- Measurement properties and tool defaults expose Values (signed price change), Percent, Interval (elapsed calendar time), and Number of bars (inclusive candle count). Missing flags are enabled. Notes remain visible independently; an empty label is not rendered.
- Dragging measurement strokes, extensions, or labels translates both anchors. Endpoint handles resize individual anchors. Translation preserves logical bar spacing and displayed price difference across market gaps; elapsed time and percentage may change. OHLC snapping uses the first anchor as a shared reference. Locked drawings cannot move. A completed drag is one undo step; Escape, pointer cancellation, context changes, and hiding all cancel unfinished movement.
- Journal sections retain their current-chart button, inline previews, and Detach, without repeated file lists or inline filenames. Evidence shows the name, source, and assignments, with multi-section checkbox controls. Detaching the last section leaves an Unassigned image; deleting the image removes all references.
- Every journal section has an Attach image dialog for a file or a screenshot pasted into its dedicated paste area. Normal text pasting is unchanged. PNG, JPEG, and WebP are decoded and normalized to PNG with an explicit preview. Unsupported or corrupt files, inputs above 4,000,000 bytes, decoded images above 16,000,000 pixels, and oversized review packages are rejected without silently resizing the image.
- The existing 30-image and 4,000,000-byte JSON review-package limits still apply (including base64 overhead). A failed save preserves the existing recovery draft; retrying the same prepared image does not duplicate its asset. Closing the dialog or changing review context cancels pending import work. Stale trades and replay cannot mutate attachments.

## Compatibility

Document schema remains 1. The optional drawing booleans are `showValues`, `showPercent`, `showInterval`, and `showBars`. Optional evidence `origin` is `upload` or `clipboard`; absence preserves existing workspace/peer behavior. Imported images have no invented chart timeframe or timestamp-interpretation warning.

Section references still use the existing stable section keys. Notion and portable exports place an image in every assigned section but include its PNG bytes once. The review subscription treats assignment changes as structural while keeping prose-only editing isolated from chart rendering.

No API endpoints, Prisma migrations, Workers, providers, or production credentials are added or changed. Existing saved images are not rewritten.

## Validation

Use Node 22. The focused checks are:

- `npm run test:workstation`
- `npm run test:workstation:providers`
- Isolated PostgreSQL Vitest suites: trade-workstation, backup-restore, workstation-backup, notion-import, peers, journal/autosave, and journal/recovery. Set both database URLs to a test-only target and `ALLOW_TEST_DATABASE_MUTATIONS=1`; never target production.
- Preview Playwright suites: drawing-tools, evidence-import, chart-controls, peer-comparison, and journal-recovery, using the local synthetic preview server with outbound provider HTTP blocked.
- `npx tsc -p tsconfig.build.json --noEmit`, `npm run check:workstation:validation`, relevant ESLint, repository safety, and `npm run build`.

The authenticated browser suite includes `tests/workstation-auth/evidence-import.spec.ts`, and the existing peer-capture test now assigns sections in Evidence. This suite needs the dedicated local authenticated server and synthetic account. Its launch was previously blocked by the execution environment; it must not be described as validated by the database endpoint tests, which mock authentication. No production login or deployment is part of this change.

Verified locally on 2026-09-20: 58 workstation unit tests, 117 mocked provider/API tests, 56 focused database/backup/recovery/export tests, and the combined 26-test preview browser run passed. Application and focused TypeScript checks, relevant ESLint, the current-file repository-safety scan, and the production build also passed. Both database URLs used for database checks/build pointed to isolated local PostgreSQL, not Neon. Embedded Evidence thumbnails use plain lazy-loaded images, avoiding optimizer warnings that print inline PNG data in development logs.

The separate historical-object safety scan reported **162 pre-existing review items** across reachable and dangling Git objects. This feature work did not create commits or rewrite history. Those findings need separate review before claiming a clean history scan; current-file safety passed with zero findings.
