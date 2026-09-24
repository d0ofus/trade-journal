# Storage & Data Health

Settings has one metrics dashboard and a separate backup/download section immediately below it.

## Sources and units

- Trade activity counts authoritative execution, closed-trade and import tables. “Imports with skipped rows” follows the import batch status and `rowsSkipped` fields; it is not a count of unresolved trades.
- Workstation counts come from saved review JSON, including hidden workspace drawings and per-ticker comparison drawings. Unsaved drafts are excluded. Invalid documents and missing/cross-trade/non-ready asset references are reported, not deleted.
- Standalone journal entries/charts and the legacy drawing table remain separate. Inline image sizes measure encoded text; malformed-reference checks do not decode images.
- Legacy candle rows, compressed chunks and bars inside chunks are separate counts, not unique candles across feeds/timeframes.
- Neon measurements are physical database/relation sizes. Chart/metric cache is already included. Logical review/import/image text bytes are not additional physical storage. Freed pages can remain allocated for reuse.
- R2 original/thumbnail totals count ready immutable asset metadata, once per asset. Evidence entries and section assignments do not multiply stored bytes. Retained originals are a subset of ready assets. Active upload reservations are expected bytes, not measured objects.
- Backup-part totals use recorded part sizes, including expired sessions awaiting cleanup, without adding original references twice. These and the asset totals are not a complete R2 bucket inventory.
- Settings and backup sizes use decimal KB/MB/GB with expandable exact bytes. Dates use the browser timezone and include its timezone label.

## Refresh and failure behavior

`GET /api/settings/storage` is authenticated and read-only. Related content/asset counts share a SQL snapshot; physical sizes and backup summaries carry their own timestamps. Responses contain aggregates only and use private/no-store caching. Existing response fields remain available, with additive groups and completeness metadata.

Physical database/directory scans have a five-second PostgreSQL statement deadline and a bounded transaction. If the host cannot measure them promptly, only that group becomes unavailable; journal counts and other metrics still return. No database vacuum, cleanup or data rewrite is initiated.

Settings refreshes on entry, visibility/focus return, the manual button, backup completion and every 60 seconds while visible. Requests are deduplicated and aborted on navigation. Backup completion during an in-flight measurement queues one follow-up refresh so a pre-backup snapshot cannot leave the summary behind. Failed groups retain their last successful values/timestamps; absent readings display Unavailable. Application readings become stale after two minutes.

`POST /api/settings/storage` refreshes Cloudflare account metrics only. It does not run cleanup, migration or publication. The existing maintenance-state table holds a durable cross-instance 15-minute throttle. Provider errors/cooldowns retain the last successful snapshot. The existing daily cron uses the same refresh function. A fetch timestamp does not imply real-time provider data; account snapshots become stale after 30 minutes. Account usage includes other applications and cost displays are estimates, not invoices.

## Backup scope

The dashboard reports database-backup freshness and required R2 original counts, not proof that every image was downloaded. Database JSON verification is distinct from the complete database-and-images download, which verifies original checksums. Neither operation is a restore test. No metadata polling reads original image bytes.

## Validation

Database tests use a disposable local database, never production or a remote test schema. Coverage includes mixed legacy/R2 documents, duplicate assignments, retained assets, malformed records, upload expiry, backup signatures, failure retention and provider throttling. Authenticated browser coverage is in `tests/workstation-auth/storage-monitor.spec.ts`.

For the dedicated metrics browser database, run the existing isolated launcher with `--storage-health` after preparing that empty local test database and building the application. The launcher only selects fixed loopback test targets and disables real external-provider credentials.

This change needs no schema migration, new secrets, object migration or Worker deployment. A production release remains a separately authorized action.
