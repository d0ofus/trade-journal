# Peer comparisons and private Evidence storage

## Rollout status

This implementation passed isolated Preview validation and was deployed at `13963f3`. The user then explicitly authorized the full production cutover: production uploads and all 52 existing-image migrations have passed original-byte and content-preservation checks. Maintenance activation follows hosted complete-backup verification. A full-data backup check found and corrected a pre-existing validator mismatch for supported account timestamp-confirmation values; no timestamp records were altered. Actual private R2 transfers, authenticated Preview/Neon saves, recovery/retention, complete backup/restore and the approved synthetic Notion create/update remain covered by the earlier validation. The pre-existing drawing-visibility changes are preserved. See the validation record for exact scopes, historical approval gates and retained private test artifacts.

Use the Cloudflare deployment guidance to isolate this application: dedicated private buckets and bucket-scoped credentials, no changes to `chart-screener-artifacts`, the older standalone-journal `R2_*` configuration, other applications, or Workers. No new Worker is needed.

## User-facing behavior

- Comparison opens at `1d` with the focused chart's visible calendar range. **Match workspace** explicitly copies its timeframe/view. Existing modal dimensions, chart heights, grid proportions and responsive breakpoints are retained; controls use floating popovers.
- Select a ready plot and open **Drawings**. Shared tools/rendering support comparison-only drawings, raw-price anchors, ticker-specific split verification, snapping, notes/pins, locking, visibility and modal-local undo/redo. Annotations persist per trade/ticker across virtualized mounting, groups and intervals; they never enter workspace drawings.
- **Arrange** supplies drag handles and accessible move/hide/restore/reset controls. Hidden cards consume no slot; ordering/hiding are saved per trade/group. Search filters without rewriting order, and reordering is disabled during search. New members append alphabetically.
- **Attach visible charts** previews the included/excluded tickers and output dimensions. It composes the pinned primary and fully visible, ready peer plots, omitting offscreen/partial/loading/error plots. It preserves their relative layout and annotations, adds compact ticker labels and a shared context/credit footer, and excludes modal controls. Individual and paired captures remain available.
- High/Standard resolution is calculated for the complete composition. Replay candles/ranges/indicators/drawings are frozen before rendering. Pin notes honor the existing capture preference.
- Image imports continue in the background after confirmation, allowing text edits. Evidence shows pending recovery; the original and selected destination remain on the originating device if uploading/saving fails.

## Storage contract

| Guard | Limit |
| --- | ---: |
| Evidence records per review | 30 |
| Unique original bytes per review | 50,000,000 |
| One original PNG | 20,000,000 bytes |
| Decoded/generated pixels | 16,000,000 |
| Metadata-only review request | 4,000,000 bytes |

Original byte counts use hashes, not base64 size or repeated section assignments. The server validates all asset metadata and quotas; no quality reduction or account-wide upload stop is automatic.

Schema version remains 1. `evidenceProtocol: 2` identifies reference-aware reviews. Each Evidence record retains its ID/caption/context and stores an immutable asset reference; drawings, comparison state and section assignments remain in PostgreSQL. Legacy inline PNGs are still readable. Old browser tabs cannot save a document that drops the new protocol/reference information.

The additive `20260924000000_private_evidence_assets` migration adds assets, upload sessions, reference pins, maintenance snapshots and backup sessions. It introduces no candle/image-chunk tables. Peer OHLCV remains transient, with the existing eight-symbol/two-request limits and shared provider priority.

### Upload protocol

Authenticated `/api/closed-trades/:groupKey/evidence` handles creation, status, finalization, cancellation and access. Responses contain metadata or short-lived signed links, never buffered originals.

1. Preserve the original and destination in IndexedDB; create an owner/trade-bound upload session.
2. Transfer one PNG directly to R2 with a five-minute signed PUT bound to the expected byte count and `If-None-Match: *`. At most two client transfers run simultaneously.
3. Finalization leases the session, checks actual byte count, fully decodes PNG within 16 MP, hashes the exact bytes, and generates a bounded thumbnail. It writes immutable final keys that browser PUT links cannot address.
4. Under the trade review lock, recheck stale status and lease ownership, deduplicate by trade/hash, and finalize the asset. An uncertain PUT/finalization can be reconciled instead of uploading a second original.
5. Merge only the reference into the latest review and save with the existing coordinator/CAS checks. A failed save retains its local recovery draft and pending original.

New original bytes never fall back to Neon when R2 fails. Demo images use IndexedDB; existing local inline documents externalize on save. Demo reset does not remove application recovery records. Private in-memory blobs are bounded (100 MB / 64 entries), URLs are revoked when unused, and sign-out clears private memory caches. Thumbnails load lazily; viewers, downloads, exports and Notion request originals. Both the direct PNG decoder and Next.js now use patched Sharp `0.35.4`; the full dependency audit is clean as recorded in the validation notes.

### Bucket setup (separately authorized)

Create `trade-journal-evidence-production` and `trade-journal-evidence-nonproduction` with Standard storage and the Oceania location hint. A location hint is not a residency guarantee. Keep `r2.dev` and custom-domain public access disabled. Do not apply lifecycle deletion to originals/thumbnails; reference-aware application maintenance owns retention.

Create separate S3-compatible Object Read & Write credentials restricted to each bucket. Store these only in the matching Vercel environment:

```text
EVIDENCE_R2_ACCOUNT_ID
EVIDENCE_R2_BUCKET
EVIDENCE_R2_ACCESS_KEY_ID
EVIDENCE_R2_SECRET_ACCESS_KEY
EVIDENCE_R2_WRITES_ENABLED=0
EVIDENCE_R2_MAINTENANCE_ENABLED=0
```

The server rejects the standalone-journal bucket and `chart-screener-artifacts`, rejects a production-suffixed bucket outside Production, and requires a production-suffixed bucket in Production. Never set a `NEXT_PUBLIC_` secret. A separate, optional read-only account metrics token belongs in `EVIDENCE_R2_METRICS_TOKEN`; account-wide monitoring is intentionally broader than object credentials but cannot authorize image writes.

Apply CORS only to the new buckets, substituting exact approved app origins. Do not use `*`, a generic `*.vercel.app`, or production origins in non-production configuration:

```json
[
  {
    "AllowedOrigins": ["https://YOUR-APP-ORIGIN"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["content-type", "if-none-match"],
    "ExposeHeaders": ["etag", "content-length"],
    "MaxAgeSeconds": 300
  }
]
```

Add loopback origins only to the non-production bucket when explicitly testing locally. Presigned links use the R2 S3 endpoint, not public bucket domains. Verify the actual browser preflight, signed Content-Length, private access denial and expired-link behavior before enabling writes.

### Retention and cost visibility

The existing authenticated Vercel cron mechanism adds daily `/api/cron/evidence-maintenance`, enabled only by `EVIDENCE_R2_MAINTENANCE_ENABLED=1` and protected by `CRON_SECRET`. Work is bounded and retries on subsequent runs:

- Abandoned uploads expire after 24 hours of inactivity. Cancelled links outlive their five-minute signature before physical cleanup.
- Finalized assets wait at least seven days after their last review/publication/backup reference disappears. Trade locks, finalization leases and backup/GC coordination prevent reattachment/deletion races.
- Unfinished publication jobs retain originals. Preview pins expire; confirming a valid preview renews durable publication pins. Completed publication alone never deletes evidence.
- Active complete backups pin their originals for 24 hours. Expired backup parts and redundant upload copies are cleaned independently.

Per-review usage warns at 80%. Settings distinguishes Neon payloads, R2 originals, thumbnails and pending reservations. Optional account-wide readings include other apps and carry a timestamp/stale indicator. Incomplete provider counters are marked unavailable, never converted into a false zero; a failed refresh retains the last valid reading. Approximate 8/9/10 GB warnings are advisory. Standard storage estimates are explicitly separate from Workers, operations, other storage classes and taxes; they are not invoices.

## Migration and rollback

Reference-aware readers and the additive migration must precede enabling writes. Once writes are enabled, subsequent review saves copy/verify legacy inline originals before replacing only their image fields. No downloaded originals are reinserted into autosaves.

An operator can inspect untouched reviews using:

```text
npx tsx scripts/migrate-evidence-to-r2.ts
npx tsx scripts/migrate-evidence-to-r2.ts --after=<last-trade-key>
```

Applying requires a separately approved target, `EVIDENCE_LEGACY_MIGRATION_APPROVED=1`, enabled storage writes, and `--apply`. The script is batched/resumable. CAS checks prevent overwriting concurrent edits. Evidence IDs, section assignments, image hashes, legacy snapshots and scalar journal fields are retained; standalone journals are outside this migration.

Before production: take and restore-test a complete database/image backup; audit counts, assignments, hashes, unassigned images and legacy scalar fields. During rollback, disable new uploads if needed but retain reference-aware readers and asset tables. Never deploy old code that cannot read migrated reviews. Do not drop tables/buckets or undo completed migrations destructively.

## Notion, exports and complete backups

New Notion snapshots hold immutable asset references/pins, not image bytes. Legacy frozen jobs remain readable. Fresh previews require legacy images to finish migration. Publishing reads and verifies the original server-side and preserves the existing base64-based Notion content hash, so already-uploaded assets can be reused. The actual bot workspace file allowance is checked; an image that exceeds it is blocked, not omitted/compressed.

Portable/Notion file exports include each original once with every section assignment and its original caption. Metadata-only JSON or Neon backups are explicitly incomplete for R2 evidence.

**Complete database + images backup** freezes a consistent database snapshot, saves bounded metadata parts to private R2, and transfers those parts/originals directly to the browser with checksums. Downloaded ZIP parts are self-contained together: keep *all* parts, not just the manifest. Original images are not represented solely by expiring links. Large backups may require allowing multiple downloads. Failed preparation must be restarted; incomplete bundles must not be treated as complete. Standalone external screenshot backup requirements remain unchanged and are disclosed.

Verify downloaded parts without mutation:

```text
npx tsx scripts/restore-complete-evidence-backup.ts part-001.zip part-002.zip
```

Restore requires all checksum-verified parts, an empty local `*_restore_test` PostgreSQL database with the migrations applied, matching `DATABASE_URL`/`DIRECT_URL`, `ALLOW_TEST_DATABASE_MUTATIONS=1`, `EVIDENCE_RESTORE_APPROVED=1`, non-production bucket credentials, and `--apply`. The tool refuses production buckets/databases and refuses to replace differing immutable objects. Object restoration is idempotent; database writes are transactional. It does not erase an existing database to make room.

## Validation and release gates

See [validation record](private-evidence-validation.md). Actual non-production R2/CORS, deployed authenticated Preview and approved Notion create/update checks have passed in addition to local tests. They do not establish live Alpaca entitlement. Production credentials/CORS and the replacement metrics token have passed read-only checks and a fresh preservation audit/backup was restore-verified; actual deployed-secret execution and production uploads remain controlled rollout checks. The code/schema release is authorized; enabling R2 writes, maintenance and legacy-image migration still requires explicit cutover approval. Subsequent journal edits require another fresh backup before migrating originals. Keep Preview environment secrets in Vercel; ignored local validation secrets do not replace them. Confirm account-wide monitoring after the authorized production deployment and maintenance activation.

Primary references: [R2 signed URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [account metrics](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/metrics/methods/list/), [Notion files](https://developers.notion.com/guides/data-apis/working-with-files-and-media).
