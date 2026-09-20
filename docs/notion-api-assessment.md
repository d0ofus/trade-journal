# Notion API publishing assessment

Assessed 2026-09-20. This release does **not** connect to Notion or publish pages. The app still offers CSV and page/portable ZIP exports. Feasibility is confirmed from the public API documentation; compatibility with the owner's actual database, template and related databases is **not verified**.

## Recommended follow-up

Start with an explicit, one-way **Publish/update in Notion** action against a saved review revision. Do not start with background two-way synchronization.

- Authentication: use a server-held internal connection with only the required read/insert/update capabilities and explicitly granted access to the journal database, template and related databases. Keep its token in deployment secrets, never browser storage, logs or Git. Internal connections have their own permissions and newly created connections cannot access pages until shared. [Internal connections](https://developers.notion.com/guides/get-started/internal-connections)
- Templates: inspect the target data source and template ID, then create a page from that template. Creation returns before template content is ready: confirm the expected block structure with bounded polling or a webhook before placing review content. Map stable `ReviewSectionKey` values to resolved destination blocks using their parent hierarchy; repeated headings such as “+ ve” are not unique. Save the mapping and do not reapply templates on every update. [Creating pages from templates](https://developers.notion.com/guides/data-apis/creating-pages-from-templates)
- Images: upload each saved PNG once to Notion-managed storage, then reuse the upload in image blocks under every assigned section. No public image hosting is needed. Complete the upload/initial attachment within the documented lifetime and retain the upload/block mapping for retry and reuse. Preserve captions, symbols, group, price basis, capture time and any replay cutoff. [Uploading small files](https://developers.notion.com/guides/data-apis/uploading-small-files)
- Properties: inspect real property IDs and types before mapping values. Resolve relations to actual related-page IDs and grant access to the related databases. Populate editable formula inputs; formula and rollup results are not directly writable. Preserve unrelated Notion properties. [Page property restrictions](https://developers.notion.com/reference/page-property-values)

The publisher should own only clearly identified blocks/properties. Persist trade-to-page, section-to-block, asset-to-upload mappings, the last published review revision and remote content fingerprints. Reconcile partial work before retrying; don't create a second page or image because a request timed out. Detect conflicting Notion edits before replacing app-managed content, and offer a recoverable conflict state. Use a bounded request queue, pagination, retry/backoff and visible progress. These are proposed application safeguards, not capabilities already implemented here.

## Prerequisites and acceptance gates

1. Read-only inspection of the real database/data source, its template, related databases and one representative populated journal page.
2. Confirm a property/section mapping and image placement specification with the owner, including unsupported blocks and formula inputs.
3. Separately approve a test-page publish; verify formatting, multi-section image reuse, relation values, update conflicts and interrupted-request recovery.
4. Design durable publication state and any associated database migration in that separate integration plan. No such migration or secret is introduced by this chart/journal release.
