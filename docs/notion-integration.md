# Notion publishing and template-driven reviews

This release adds a server-held Notion connection, template-driven journal layout, and explicit single-review publishing. It is not background two-way content synchronization. Release prerequisites and outstanding validation gaps are recorded below.

## Layout and saved data

The registered New page template (`1fd6f185-199d-81c0-b0cb-cfef4190fc8d`) is authoritative, under the Trades data source (`1fd6f185-199d-8111-8f46-000b0bf768d4`). The earlier linked standalone template copy is not used. Existing chart/analysis/Takeaways identities have explicit source-block bindings, including the paragraph-based analysis labels. Additional headings and toggles use `notion:<source-block-UUID>` identities. Rename/reorder preserves identity; delete/recreate does not merge unrelated content.

Opening/focusing the workstation and the visible 60-second refresh check the cached layout. Manual refresh is also available. An active journal field defers adoption until focus leaves the editor. Invalid/empty/unavailable templates retain the last valid definition. Removed sections remain editable in Review details and assignable through Evidence. Template refresh never publishes changes to Notion pages.

Previous review fields are no longer repeated in the sidebar. Setup, execution, deeper notes, custom fields, preset creation and preserved original material remain in Review details. Tags and preset selection remain in the review controls. Legacy scalar notes and workstation JSON are both read through the existing save coordinator. Trade properties, shared Takeaways and Peers tools retain their application roles.

Document schema remains 1. Optional `dynamicSections` and `layout` extend the existing Notion review document. Image bytes are stored once; chart-section `evidenceIds` and additional-section references remain intact. Portable exports include archived/legacy material; live publishing explicitly lists omitted material rather than assigning it to an unrelated section.

The read-only production audit found 12 real saved trade-review records plus three seeded demo records. SHLS and TATT have legacy mistake/improvement text; LPTH has legacy notes. There are 22 Evidence images, 20 assigned and two unassigned IE images. No image depends on the removed Previous review fields accordion. These production records are not copied into test fixtures or rewritten by the migration.

## Publishing protocol

`GET/POST /api/workstation/notion/template` reads/refreshes section definitions. `GET /api/workstation/notion/publications?groupKey=…` returns saved progress; POST accepts `preview` with a saved revision, then `publish` or `resume` with a job ID. All routes require the existing application session; POST additionally requires the same origin. The browser cannot supply a token, destination page ID, arbitrary Notion URL, or unsaved review body.

Preview freezes the saved review and template, resolves property/relation mappings and lists section/image placement and omissions. Confirmation rechecks the saved review and live template/schema. Only an explicitly confirmed job may write to Notion, and `NOTION_PUBLISH_ENABLED=1` is additionally required. Browser-test mode rejects live publishing regardless of that flag.

New pages use the registered template once. The job persists a unique creation title before sending the request and reconciles a lost response by that title and connection creator identity. It never adopts a manually created page or blindly repeats an unconfirmed page/section/content append. A template-readiness conflict is resumable; the app does not reapply the template or erase page content.

App-owned, linked callout containers are inserted immediately after their mapped section anchor (inside toggle sections). Rich paragraphs, emphasis and nested lists are translated to Notion blocks; images retain their original capture/import/replay context. Nested content is appended in bounded batches, reconciling the existing prefix after interruption. Each image upload is keyed by content hash and reused in every assigned section. Notion-managed file storage is used; no public image hosting is added.

Updates compare fingerprints of app-managed sections/properties and preserve other content. A replacement section is written before archiving its old app-owned container. Human changes cause a conflict, not an automatic overwrite. Resolve the discrepancy in Notion and explicitly resume. If an existing published page lacks an anchor for a newly introduced/recreated template section, publishing pauses for a reviewed page-layout migration; it does not guess a destination or reapply the template. Existing pages are not automatically rebuilt to match later template structures.

Entry/Exit are actual average execution prices. S/L is planned stop. Entry Date is the interpreted execution range in America/New_York; unresolved timestamps block publishing. Formulas/rollups and unrelated properties are never written. Missing/ambiguous related-page matches and undefined select options block publication.

Each browser-driven step has a time budget, a durable fenced job lease and a global publisher lease. A separate UTC-based request gate coordinates the connection's request pacing and Retry-After cooldown. Closing/navigating away cancels client continuation, not an already accepted server step; reopening inspects/resumes the same job. There is no independent Worker or external queue.

Completed jobs release their temporary image-byte copies while retaining captions, content hashes and upload/block bindings. Original review Evidence and Notion images are unchanged. Unfinished jobs retain the frozen bytes needed for recovery.

## Database and operational safety

Migration `20260920130000_notion_integration` only adds template definitions, publication records, jobs, upload mappings and transient request coordination. It does not UPDATE/DELETE reviews, images, drawings, trades or legacy journals. The first four models participate in backup, restore and freshness; transient request gates are regenerated. Old backups without the new optional tables remain valid. Keep publishing disabled during restoration and verify destination ownership before resuming restored jobs.

Credentials are server-only `NOTION_TOKEN`; never prefix it with `NEXT_PUBLIC_`. `NOTION_PUBLISH_ENABLED` defaults off. Preview/Production need their own configured environment scopes. No production secret promotion, schema change, database mutation or live test-page creation is implied by a successful local build.

## Release gates and checks

1. Grant the connection access to the related databases for Type of Review, Type of Trade, Chart Pattern, Confluences, Characteristics and News Impact. Verify their real IDs/property types; no relation property may be silently omitted.
2. Ensure the database has the agreed numeric Exit property and verify the current template/property schema. Creating that live property belongs to the approved live setup, not a read-only probe.
3. Configure the token for the approved Preview and Production environments. Keep production publishing disabled until validation finishes.
4. Run authenticated browser tests against an isolated PostgreSQL target, validate a preview, and obtain explicit approval for one live test-page publication. Verify placement, rich text, reused images, property values, updates and conflict handling. Do not use existing manually created journals as test targets.
5. Take and verify a current production backup; repeat the preservation audit. Only then push `main`. The production Vercel build applies the additive migration before promotion. No separate Worker migration/redeployment is required.

Local validation uses `trade_journal_notion_test` on `127.0.0.1:15439`, with matching `DATABASE_URL`/`DIRECT_URL` and `ALLOW_TEST_DATABASE_MUTATIONS=1`. `scripts/seed-notion-validation.ts` refuses any other target and seeds only synthetic content. Unit/database tests cover stable/archived identities, legacy notes, assignments/exports, property mapping, duplicate prevention, image reuse, cooldowns, stale trades and conflicts. The focused browser scenario is `tests/workstation-auth/notion-sections.spec.ts`.

Local validation on 21 September 2026 passed: 131 focused unit/API/database/preservation tests, 118 provider regressions, 65 workstation tests, application/build and focused-validation TypeScript checks, changed-file lint, current-tree repository safety, and the optimized production build. The repository-wide generic TypeScript command still reports existing test-typing issues outside the focused validation configuration; it is not counted as passed.

Launching the local authenticated browser server was rejected by the execution environment; **authenticated browser and deployed preview validation remain unverified**. At the initial check, relation access and numeric Exit were missing. A subsequent user-approved live test on 21 September confirmed all six related databases are accessible and Exit is numeric. The user then requested committing and pushing the release to `main`. Vercel subsequently returned HTTP 403, so production configuration, the pre-migration backup and the preservation re-audit still need verification before that push. No production migration or Worker deployment has been run at this checkpoint.

### Approved live validation

`scripts/verify-notion-live.ts` uses the real publishing implementation with a synthetic `NOTIONTEST` review in the separate local `trade_journal_notion_live_test` database on `127.0.0.1:15439`. It refuses any other database target. Never run the generic database test suites against this live-validation ledger: retain its page/upload mappings for safe resumption.

The approved test created one new app-owned Notion page from the registered template and then published a second revision to that same page. Verification passed for 32 mapped properties, all 13 section destinations, six resolved relation values, the New York execution range, and 14 image placements backed by two reusable uploads. Both downloaded PNGs matched their original bytes. Unassigned evidence and legacy notes stayed in the isolated app review. The second revision added `UPDATE VERIFIED` to Takeaways. These are synthetic fixtures, not real market data; existing journals and the production app database were not used as test targets.

The helper supports `prepare`, `step`, `verify`, `update`, and `inspect`. Only `step` writes to Notion, requiring both `ALLOW_LIVE_NOTION_TEST=1` and `NOTION_PUBLISH_ENABLED=1`, in addition to the normal local-test database guard. Load the token through the process environment, never a command-line argument or committed file. Run `step` explicitly to resume bounded progress; stop and inspect any reported conflict. Verification and preview modes need no Notion write flag. Human review of the resulting page's appearance is still required; this does not replace authenticated browser or deployed-preview validation.

Official API references: [templates and asynchronous readiness](https://developers.notion.com/guides/data-apis/creating-pages-from-templates), [append positioning and block limits](https://developers.notion.com/reference/patch-block-children), [file upload reuse](https://developers.notion.com/guides/data-apis/uploading-small-files), [rate limits and retry semantics](https://developers.notion.com/reference/request-limits).
