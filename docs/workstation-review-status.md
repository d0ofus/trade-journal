# Trade review status

Every trade-list dot reflects that trade's review: green means Reviewed, amber means In progress, and red means Not reviewed. Labels and tooltips explain the status. A dashed outline identifies unsaved changes; save errors retain the draft indicator. Unreadable status metadata is neutral and labeled Unavailable.

The first deliberate journal text, tag, review-field or evidence edit changes Not reviewed to In progress. Completion remains manual. Explicit status changes take precedence, and editing a Reviewed trade does not reopen it. Chart operations, template selection/synchronization, viewing and draft recovery do not automatically start a review. Existing records are not reclassified.

`review.status` in the existing saved document is authoritative. Missing legacy status defaults to Not reviewed. No schema migration or separate status column is used. The server projects status metadata inside PostgreSQL, so full review documents and images are not downloaded for the trade list.

Authenticated `POST /api/workstation/review-statuses` accepts `{ groupKeys: string[] }` (up to 500 keys) and returns `{ statuses: Array<{ groupKey, status, revision, updatedAt }> }`, with `Cache-Control: no-store`. It performs no writes and omits nonexistent trades. The initial page supplies summaries; later refreshes run on window focus or cross-tab save notifications. Successful saves update the local summary immediately. Revision and update-time comparisons reject older responses.

Summary refreshes do not replace active editor documents or trigger chart-provider requests. Existing optimistic concurrency, autosave, recovery and navigation protections continue to apply. When a refresh fails, previously confirmed saved summaries are retained; trades without a known summary remain Unavailable.

Release coverage includes eight authenticated browser checks for per-trade summaries, automatic initiation, manual overrides, failed saves, recovery without initiation, cross-tab conflicts, unreadable metadata, focus refresh and delayed responses. Existing regressions also cover journal persistence, evidence capture and export, chart sessions, filters, saved views and mocked Notion publishing. Database and unit checks cover authorization, payload bounds, malformed legacy documents, absence of writes and stale revision rejection. All writes in these tests target disposable local fixtures; external publishing is mocked.
