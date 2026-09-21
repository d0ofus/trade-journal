# Fullscreen journal, capture quality and Notion refinements

## Behaviour

- Fullscreen charts have a Journal toggle. Desktop uses a temporary, resizable right sidebar; mobile uses the journal presentation with the chart inert behind it. A stable portal moves the existing editor, retaining its state and save coordinator. Closing returns focus to the toggle; leaving fullscreen restores the normal/Focus arrangement. Sidebar size and visibility are not saved preferences.
- New attachments and PNG exports default to High quality: at least 1920 output pixels wide and a scale of at least 2× or native DPR, whichever is higher. For composites the minimum applies to the entire output. Standard uses native resolution. Controls show approximate dimensions before capture; chart-library even-pixel rounding can add a few pixels.
- Capture clones use the live plot dimensions, logical date window, price range, fonts and volume styling. Rendering uses the chart's measured bitmap density, which can differ from reported browser DPR under zoom/emulation. Composition copies native bitmaps 1:1; PNG encoding is lossless. Series, drawings and replay context are frozen before asynchronous work.
- Captures above 16 megapixels fail explicitly. Attachments retain the 30-image/4 MB package limits, including base64/JSON overhead. No automatic quality reduction is performed. Select Standard, use a smaller layout, or download/remove older attachments when needed.
- Image previews start in Fit mode without enlarging small images. Dimensions, 100% inspection and downloads remain available. Existing Evidence assets and assignments are never regenerated or replaced.
- Fresh Notion publication previews use ticker-only titles and numeric Entry/Exit rounded half-up to two decimals with decimal arithmetic. Preview labels show two decimals; Notion controls number-property trailing-zero presentation. Full-precision app calculations, per-trade mappings and unique creation markers are unchanged. Previously frozen jobs keep their stored plans.
- Executed-trade reviews initialize blank Type of Review to Taken Trade on load, with optional schema-v1 `executedTradeDefaults: 1` metadata persisted by the next normal save. Nonempty choices and deliberate clearing are retained. Standalone journals do not opt in. Relations still require an unambiguous accessible Notion page.

## Image investigation and rollout boundaries

The prior read-only audit found all six ULTA Notion downloads byte-identical to saved app PNGs. The affected 5-minute image was only 1018 × 536. The upload path did not compress it; the capture sizing/rendering and preview enlargement accounted for the loss of apparent detail. Existing images need manual recapture to benefit.

The current ULTA job's review-type and Entry Date conflicts are separate. This change does not resume, reconcile or overwrite that job/page. No new public endpoint, PostgreSQL migration or Worker change is needed.

## Validation

Focused unit/provider and isolated PostgreSQL tests cover defaults, clearing/reload, numeric rounding, frozen jobs, identical-ticker trade separation, upload-byte preservation, references and exports. Browser scenarios cover desktop/mobile fullscreen, preserved editor identity, resizing and focus, DPR 1/1.25/2/3, PNG dimensions and byte-identical downloads, image viewing, themes, comparisons, replay and Evidence workflows. The authenticated scenario is `tests/workstation-auth/fullscreen-journal.spec.ts` and uses only the disposable local Notion test database.

Local preview browser validation is separate from a deployed preview. Authenticated browser validation remains unverified: the test-server launch was rejected by the execution environment. The new live synthetic Notion publish/download verification and deployed preview validation have not been run for this release. On 21 September 2026, the user explicitly waived these remaining release gates and requested committing and pushing to GitHub main. No additional tests or synthetic Notion publication were run for that delivery. A later live synthetic publication still requires approval; do not use the conflicted ULTA page as a test target.

Validated locally on 21 September 2026: 98 focused unit/database tests, 118 provider regressions, 65 workstation tests, and 46 browser scenarios across the final feature run (35), layout regressions (8) and annotation/comparison regressions (3). Focused-validation and application/build TypeScript, changed-file ESLint, repository safety (zero findings), and the optimized production build passed. Generated desktop/mobile screenshots and multi-chart PNGs were visually inspected. Authentication-required browser scenarios are present but not counted as passed.
