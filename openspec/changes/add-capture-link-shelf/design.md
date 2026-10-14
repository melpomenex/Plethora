## Context

See `proposal.md` for motivation. The supplied screenshot is the visual reference for the existing Dashboard layout and warm dark theme.

- `CaptureActivityCard.tsx` is presentational; `DashboardTab.tsx` owns an independent fetch lifecycle. `get_capture_activity` returns snake-case aggregate fields normalized to camel case in `src/api/capture-activity.ts`. Its SQL reads only `date_added` and metadata for nonarchived documents in the reporting window.
- Extension documents already carry browser provenance and persisted `cover_image_url`/`cover_image_source`. Ordinary imports can use the first captured image; the dashboard cannot assume this is always a good hero image. Missing or unsuitable imagery must look intentional.
- `browser-sync://document-saved` already exists. `documentStore.ts` debounces its own document reload; the Dashboard currently refreshes capture analytics only on tab activation.
- `DocumentsView.tsx` has file-type/category/search filters, but no browser-source entry point. `DocumentsTab.tsx` does not currently accept a capture filter. Collection filtering is delegated to the backend, so filtering an already scoped or partial client cache would omit captures.
- `openDocumentAtLocation` reuses reader tabs but its cache-miss fallback reloads the document list. New shelf records may be outside that list. Opening must support a direct document-by-ID lookup.
- The successful YouTube import early return in `handle_import_request` must be checked for persisted browser provenance; an event alone is not evidence that a record will pass the source classifier.
- `DESIGN.md` defines a theme-driven Material instrument with tonal state layers, Phosphor icons, at least 40px control targets, and motion tokens. Preserve that world and the Dashboard's existing section order. This is a scoped extension, not a redesign of the surrounding screen.

## Goals / Non-Goals

**Goals:**

- Make a saved link recognizable at a glance and readable with one activation.
- Keep the dashboard request bounded, independent of document bodies, collection-scoped caches, and image discovery services.
- Give the shelf and its Library destination identical source eligibility and ordering.
- Define the edge states and interaction details precisely enough that the builder can implement without inventing UX.

**Non-Goals:**

- An import event log, pending extension queue, or separate browser-save manager.
- Showing standalone flashcards, extracts, or image-registry assets as links. A qualifying parent library document can appear once.
- Altering the existing counts, duplicate-save rules, reader behavior, collections, or extension transport.
- Fetching metadata or generating covers at dashboard render time; adding AI imagery, a favicon service, or an animation dependency.
- Repairing historical records whose origin is unknowable. Do not infer extension provenance from a URL, semantic tag, or save event.

## Decisions

### D1. A reading shelf inside the existing Capture Activity section

Composition, from top to bottom:

1. Existing **Capture Activity** header.
2. **Recently saved from your browser**, paired with **View all browser saves**.
3. Up to six compact landscape tiles, newest first.
4. A smaller **Last 30 days** reporting row with the sparkline and the existing four source counts.
5. The existing needs-review entry, when nonzero.

At the Dashboard's approximately 56rem content width, use three columns and two rows; at intermediate widths use two columns. On phones use a vertical list with a small landscape thumbnail to the left of the title/metadata. Use the section's available width, not the overall desktop window, to choose columns. One or two saves use natural tile widths and do not stretch into oversized feature cards. No carousel, hover popover, or masonry layout is needed.

Tiles contain a fixed 16:9 media region, an always-visible type label, up to two title lines, and a domain/time row. Titles live below the image; arbitrary artwork cannot compromise contrast. Full titles and absolute save times remain available through accessible text and a semantic `time` element. Use a content-type label such as Article, Video, or PDF instead of repeating Browser Extension on every tile.

**Alternative considered:** a richer hover popup over the current counts. Rejected because saved content should be visible before hover and reachable on touch. A full activity feed was also rejected because it would dominate a dashboard intended to move the user into reading/review.

### D2. Clear primary and secondary actions, with purposeful feedback

The image/title region is a native button labeled **Open {title} in Plethora**. Its footprint provides a large target. A sibling **Open original** control occupies a reserved footer area; never nest interactive controls or make the whole tile an outer button. Primary activation opens/focuses the persisted document by ID. External opening validates HTTP(S) and uses `openExternal`, without triggering the reader action.

Hover and `focus-within` increase the tonal state layer and outline contrast; a reserved **Read in Plethora** affordance becomes prominent. A restrained image-only scale of at most 1.02 can be used under `(hover: hover) and (pointer: fine)` if it passes the existing motion policy; the tile and surrounding layout do not move. Use existing duration/easing tokens. Under reduced motion all states are immediate and image scaling is disabled. No shadow lift, glow, autoplay, or animation on initial load.

The original-page action has a visible external-link icon and a meaningful label. Its emphasis can increase on hover/focus, but it remains available and discoverable at rest; on touch the label is always visible. Targets are at least 40px, increased to 44px on phone presentation. Keyboard focus has an explicit primary ring; Enter/Space activate buttons. Domains, metadata, and title truncation must tolerate localization and 200% text scaling.

**Alternative considered:** making the card open the website. Rejected because the user already saved the item to read in Plethora. A separate original-page action removes ambiguity.

### D3. Reuse stored imagery and make the fallback a designed state

Cover precedence: an allowed persisted `coverImageUrl`, then a supported YouTube thumbnail resolved by the existing video-ID helper, then a source/type fallback. Check schemes through the existing image resolution/sanitization path; use only supported remote HTTP(S), permitted local assets, and permitted image data URLs. Reuse existing document-cover utilities where practical without importing the full DocumentsView module.

A fallback uses a theme surface-container tone, a large Phosphor document/type icon, and a domain initial or short host label. It is decorative (`aria-hidden`), because title/domain already carry meaning. It occupies the same dimensions as a loaded image. Image failure changes only that tile to its fallback; do not repeatedly retry during render. Real images use `object-fit: cover`, explicit aspect ratio, lazy loading, asynchronous decode, empty alt text when redundant, and `referrerPolicy="no-referrer"` for remote images.

Reuse covers as captured today. Do not introduce a blocking Open Graph fetch or a background request for every dashboard visit. If a cover is an obvious tiny image or fails to load, use the fallback; improving hero selection for all import paths is a separate follow-up. The concept preview must include a missing-cover example so fallback quality is reviewable.

**Alternative considered:** third-party favicon/preview enrichment. Rejected because a simple local fallback is more dependable offline and adds no service dependency.

### D4. A bounded browser-capture metadata command, separate from analytics

Add `get_browser_capture_documents` with `limit` (default 6, clamped to 1–100) and `offset` (default 0, nonnegative). Return a page with `items`, `total_count`, `limit`, and `offset`; normalize it to typed camel-case frontend data. Each item has:

| Wire field | Meaning |
| --- | --- |
| `document_id` | Persisted library document ID |
| `title` | Stored title; frontend provides a localized fallback |
| `file_type` | Reader/type affordance |
| `source_url` | Validated original HTTP(S) URL |
| `date_added` | Original save timestamp, RFC 3339 |
| `cover_image_url` | Nullable persisted cover |
| `cover_image_source` | Nullable provenance for cover handling |

Eligibility is one live document per persisted ID: nonarchived, nondismissed, classified as browser extension by the same precedence as `classify_capture`, and with a valid HTTP(S) source URL. Use stored original capture/page URL if available, then `metadata.originalUrl`, `metadata.url`, article-provenance original URL, and finally an HTTP(S) `file_path`; resolve the first **valid** candidate rather than allowing a malformed earlier candidate to mask a good fallback. Read actual provenance field names before coding. Derive displayed host from the validated URL, stripping only a leading `www.`. Exclude raw cards/extracts/assets; do not deduplicate unrelated library IDs by hostname.

Sort by `date_added DESC, id DESC`. Use all dates and all collections; the shelf is a latest-saves view, independent of the 30-day analytics. Re-saving a deduplicated existing document does not change its original save time or create a second tile. Explicitly label the analytics window to avoid interpreting a lifetime shelf as the same population as its source count.

Select only identity, display metadata, and the minimal provenance needed to determine eligibility. Apply eligibility before counting/pagination; malformed metadata and invalid URLs must not underfill a page that has enough eligible records. Use guarded JSON expressions (`json_valid` before extraction) if filtering in SQL, with parity tests against the existing Rust classifier. Reuse a common source/URL predicate for page and count queries, and verify query plans against the existing indexes before adding any. No document content, HTML, transcript, extracts, or per-tile network metadata calls cross this boundary.

`get_capture_activity` stays unchanged. Dashboard requests both endpoints independently so either subsection can render when the other fails. The Library's source-filtered list uses the same eligibility, order, and pagination; keep its existing selection, reader, search, and management affordances rather than introducing another list implementation. Source filtering must precede pagination, and any additional Library filters must be applied to the filtered data set rather than the first page only. Extend the existing document listing query's filter options as needed, sharing the predicate with this metadata command.

Implementation verification found that typed native metadata serializes an absent `shareProvenance` as JSON null. Treat null as absent in the shared classifier so older extension source markers remain eligible; actual non-null share provenance keeps its existing priority. The aggregation contract is unchanged, while affected source attribution becomes accurate. The existing Library loads a complete summary list and virtualizes it rather than paging this list endpoint; apply the persisted source predicate to that complete list, so additional filters cannot miss records beyond a loaded page.

**Alternative considered:** filtering `documentStore.documents` for six items. Rejected because that cache can be partial or scoped to another collection, and it needlessly couples a small dashboard surface to full document hydration. Extending the analytics response was rejected because shelf failures should not suppress useful counts.

### D5. Filtered Library entry and robust document opening

**View all browser saves** opens/focuses a Documents tab with explicit tab data for browser-extension source, all-library scope, and added-descending order. `DocumentsTab` passes the initial source/scope options to `DocumentsView`; the backend listing receives them. Show a removable **Browser Extension** chip and an **All library** scope indication. This is a tab-local view; do not change the user's globally active collection or persist the source filter in other Library tabs. Clearing the source chip leaves the tab's explicit all-library scope visible and restores an ordinary unfiltered Library list there.

Do not fake provenance filtering with a tag search. Reusing an already open Library tab must apply the requested filter and clear incompatible stale filters so the destination matches the shelf. Ordinary Library entry remains unaffected.

For primary tile activation, reuse `openDocumentAtLocation` after ensuring the specific ID is available through a direct `getDocument(id)` path; avoid replacing a collection's entire store list just to seed one viewer. If necessary, extend the helper's cache-miss path to fetch by ID and then build the same viewer payload, retaining open-tab reuse. A missing/deleted document produces a localized notice and a shelf refresh, with no empty reader tab. External-opening errors produce ordinary localized feedback.

**Alternative considered:** an unfiltered **Open Library** link. Rejected because it makes the user rediscover the saves and can land in the wrong collection.

### D6. Event refresh that preserves context and contains failures

`DashboardTab` owns separate shelf and analytics states. Load both on every activation. While active in Tauri, subscribe to `browser-sync://document-saved` and debounce refresh by roughly the existing 500ms convention; refresh the shelf and analytics together without duplicate notifications. On inactive tabs, defer work to the next activation. Dispose listeners/timers on unmount and account for asynchronous listener registration completing after cleanup. Use request generations or cancellation so an older fetch cannot overwrite a newer result.

Initial shelf loading shows a fixed-footprint skeleton in the selected layout. Refresh retains cards and keyboard focus, with a quiet refreshing status. Announce meaningful save updates politely without moving focus or presenting every item as a toast. A refresh failure retains stale cards with a small retry notice; an initial failure shows an inline shelf-only error and retry. Analytics has its own failure/retry treatment.

If extension saves are empty, show **Your browser saves will appear here** and **Save a page with the Plethora extension, then come back to read it.** Do not imply there are no captures when share/manual counts are nonzero. Use an existing browser-extension setup/settings route for a setup action only if it is available on that platform. Zero captures in the reporting window do not hide older shelf items. Successful retries restore content without a full Dashboard remount.

**Alternative considered:** polling and wholesale skeleton replacement. Rejected because an existing save event is available and content disappearance interrupts reading and keyboard navigation.

### D7. Provenance and validation remain grounded in the existing product

Verify normal page, fallback, duplicate, and successful YouTube document-save paths persist extension provenance before their save event is emitted. For any demonstrated omission, stamp the same metadata/provenance used by the existing extension path and preserve media/import metadata. Do not redesign YouTube import or infer provenance for old records with no trustworthy marker.

Use i18n keys for shelf titles, action names, type/fallback labels, state copy, and accessible labels. The existing `formatRelativeTime` returns English literals; use locale-aware relative formatting (for example the app's locale with `Intl.RelativeTimeFormat`) rather than copying that limitation. Absolute tooltips use locale-aware date formatting.

Validate with query/provenance tests, API normalization, real interaction tests, and one batched desktop/phone/light/dark visual inspection followed by at most one confirmation round. Run the required local `npm run bench:check` and normal build/type checks during implementation; update performance baselines only for an intentional measured change with a reason. The planning change itself uses OpenSpec validation rather than application benchmarks.

## Risks / Trade-offs

- **Captured covers can be irrelevant or unavailable** → keep the fallback attractive; never hide a readable save behind cover loading or failure.
- **Source filtering diverges from aggregate classification** → reuse classifier semantics and test malformed JSON, competing provenance markers, legacy metadata.source, and native save paths.
- **Historical YouTube saves lack provenance** → fix proven forward-path omissions and display records with trustworthy existing markers; broader historical inference stays out of scope.
- **An all-library entry can surprise users working in a collection** → label scope in the destination and keep it local to that tab.
- **The filtered Library touches a large existing component** → add a narrow initial-source/scope contract and shared backend predicate; preserve existing ordinary entry and management actions.
- **Remote images may contact their origin** → follow existing cover-loading policy, omit referrer headers, perform no extra preview lookup, and keep a complete offline fallback.
- **Active-save bursts can reorder focused content** → debounce, key by document ID, retain focus, and never animate the list into a new order.

## Migration Plan

No database migration or historical backfill is expected. Land the command and normalization first, then the shelf and its Library destination, then event refresh and validation. Older or incomplete API payloads normalize to an empty shelf rather than breaking analytics. Rollback removes the new surface/command/filter plumbing while leaving stored documents, covers, provenance, and existing capture analytics intact.

## Review Artifact

The standalone concept preview at `../../../.lavish/capture-link-shelf.html` uses illustrative content and the application's theme roles, with the supplied warm dark theme as its first view. It demonstrates covers, a missing-cover tile, hover/focus actions, phone reflow, light-theme compatibility, and shelf loading/empty/error states. Preview actions simulate navigation and clearly identify it as a concept; this file is not product implementation.
