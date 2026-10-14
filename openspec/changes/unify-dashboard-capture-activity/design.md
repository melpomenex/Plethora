## Context

See [proposal.md](proposal.md) for motivation and [the behavior contract](specs/dashboard-shared-captures/spec.md) for acceptance criteria. The screenshot is a reference for the existing Capture Activity section, not a redesign brief.

The implemented `add-capture-link-shelf` surface already provides six previews, metadata-only persisted queries, reader-by-ID navigation, a browser-source Library filter, and independent analytics/list state. Reuse it. Neither that capability nor `dashboard-capture-activity` has been archived into `openspec/specs/`; this change adds the share-channel contract alongside them without editing their artifacts.

Verified constraints in the current source:

- `useCaptureActivity` always calls `getBrowserCaptureDocuments` and subscribes only to `browser-sync://document-saved`.
- `BrowserCaptureDocument.sourceUrl` is required; normalization rejects absent URLs, and the tile unconditionally constructs a URL to obtain a host.
- `capture_repository.rs` prefilters only extension records. Both its preview query and the Library listing reuse browser-specific eligibility.
- `processSharedBatch` attributes only text documents when `batch.id` exists, hardcodes the iOS origin there, and does not attribute URL/file imports. `useExternalOpen` also invokes this router, so its use alone cannot establish share ingress.
- `SharedBatch` normalization retains ID/timestamp/items but loses source-app/origin information. `mapManifestToProvenance` already provides an additive share metadata shape.
- Capture analytics has a single exclusive source classifier; its browser-provenance precedence must remain stable. A document can acquire evidence of a later mobile share without losing its original browser capture identity.
- `isNativeMobile()` uses native OS-plugin information, while shell/viewport helpers describe presentation. Native tablets must keep the mobile capture channel at wide widths.

## Goals / Non-Goals

**Goals:** reuse the existing capture list and reader/Library behavior; establish durable share evidence before announcing completion; use the same source eligibility in previews and Library; keep queries independent of document content and collection caches; preserve established browser attribution when deduplication reuses a document.

**Non-Goals:** a separate capture-event timeline, reordering old documents when re-shared, new capture types, changing native staging/claim/retry protocols, reconstructing unmarked historical shares, changing analytics into platform-only counts, PWA share expansion, or a Dashboard visual redesign.

## Decisions

### 1. Resolve the list source from runtime, separately from layout

Choose `share-target` when `isNativeMobile()` is true and `browser-extension` otherwise. Native iOS/iPadOS and Android therefore share one content mode; desktop and existing web presentation retain browser mode. Keep width/container rules solely for layout. Pass the selected source through the capture hook, shelf copy, and View all navigation using the narrow listing type `"browser-extension" | "share-target"`, separate from the four-source analytics type.

Alternative: use `useMobileShell()` or a width breakpoint. Rejected because a small desktop window would query shares and an expanded iPad would query the extension.

### 2. Make share origin explicit at ingress and apply it to every persisted result

Add optional native origin/source-app fields to the normalized batch contract, preserving older payloads. Supply a share-ingress context from `useShareTarget` to `processSharedBatch`; legacy native payloads can obtain their origin from the known receiving runtime. `useExternalOpen` supplies no share context. Existing PWA handling remains outside the native-mobile attribution change.

At the native staged-batch conversion boundary, retain source-app information when supplied; extend native batch serialization additively where needed. Do not change Swift staging formats, native queue directories, or claim semantics.

Refactor the text-only metadata block into one result-attribution helper, invoked for URL imports, specialized X/video routes, every returned file document, notes, and deduplicated results. Build provenance per item/document so one URL in a mixed batch cannot become the original URL of an unrelated file. Preserve document content and existing metadata with a narrow persisted metadata update. Warm-start batches qualify without an ID; retain received time and available batch/source-app fields rather than manufacturing unavailable information.

Await `persistWebArticleFailure` when it produces a saved URL placeholder, then attribute that document and include its ID in capture invalidation. Keep extraction failure feedback and retry behavior; a saved placeholder is discoverable but is not reported as successful content extraction. A failure with no saved record produces no preview.

Await provenance writes before completion events, success feedback, or successful staged-batch acknowledgement. Metadata write failures enter the existing recoverable-failure path. Make the helper idempotent for repeated document IDs/batch deliveries, retain saved IDs during recoverable annotation retries, and do not recreate a successfully saved document solely to retry its metadata write.

Alternative: infer origin from share-themed tags or stamp every call to the router. Rejected because tags are editable and the router also handles desktop external-open.

### 3. Keep original capture classification and share associations distinct

Retain `classify_capture` for exclusive analytics buckets and the existing browser eligibility/URL precedence. Introduce a reusable share-list eligibility predicate accepting current native share-origin markers and existing persisted non-null share-provenance records. It also accepts an additive share record on a document whose explicit original capture source remains the browser extension.

For a deduplicated browser document, keep its original browser `captureProvenance`; add share evidence rather than overwriting it. If browser identity exists only in the legacy `metadata.source` marker, preserve that established identity in explicit browser provenance before adding the share record, since the current classifier gives a share record precedence over the legacy marker. Do not promote contradictory metadata with an explicit native-share origin into browser evidence.

This allows a previously browser-captured document to qualify once in each appropriate source view after a genuine mobile re-share. It still counts once in the existing analytics under classifier precedence, and keeps `date_added`. Other re-shares likewise update attribution without changing the original timestamp or creating duplicate previews.

Alternative: replace the original source on every capture, or add a capture-event table. Replacement loses desktop capture identity; an event table adds migration and recency semantics unnecessary for a saved-document list.

### 4. Generalize the metadata query and keep the browser contract compatible

Add a typed `get_capture_documents(source, limit?, offset?)` command and a shared repository listing implementation. Reject unsupported source values. Retain `get_browser_capture_documents` as a compatible wrapper invoking the browser branch and returning its existing non-null URL shape.

The generalized page returns `items`, `total_count`, `limit`, and `offset`; each item carries `document_id`, `title`, `file_type`, `date_added`, nullable `source_url`, and nullable existing cover fields. Defaults and clamps stay six items, 1–100 limit, and nonnegative offset. Use `date_added DESC, id DESC` across all collections and dates. Apply live-document, valid-timestamp, and source eligibility before counting/offset/limit, with guarded JSON parsing so malformed rows cannot consume page slots.

Project a whitelist of metadata needed for origin and URL resolution; do not transfer article HTML, structured content, transcripts, image arrays, or document bodies. Reuse existing browser URL precedence. For shares, try valid candidates from share/capture metadata, stored URL/original URL, article provenance, and an HTTP(S) file path; absence or an invalid candidate does not exclude the document. Local paths, `note://`, and unsupported schemes never become external actions. Do not issue remote enrichment requests.

Add generalized frontend `CaptureDocument`/`CapturePage` normalization that accepts an absent source URL while still requiring a usable ID/date. Preserve the old browser API's stricter normalization. Extend persisted Library source selection through the document command/API/hook and equivalent browser-backend filtering. Both list and Library use the same source predicates; missing/unsupported filter values must not silently widen an explicit source request to the entire library.

Alternative: filter the in-memory store or only widen the existing browser query. Client filtering misses unloaded collections; widening a browser-only command would break its meaning and still exclude files/text unless its URL requirement changed.

### 5. Reuse previews with source-aware copy and optional external actions

Rename/generalize the shelf internally to capture saves and pass a source/copy configuration. Keep Capture Activity placement, existing themes, covers, type fallbacks, container-driven grid/phone-list rules, reader-by-ID action, and independent analytics presentation.

Use these mobile English defaults through i18n:

| Element | Mobile copy |
| --- | --- |
| List heading | Recently shared to Plethora |
| Library action | View all shared items |
| Empty heading | Shared items will appear here |
| Empty guidance | Use Share in another app and choose Plethora to save a link, file, or text. |
| Library chip | Shared to Plethora |

Desktop keeps its current browser-save strings. General loading/retry/open-saved/type/date labels can reuse suitable existing keys. Translate new source/state labels across all supported locales and avoid browser-specific accessible names in mobile mode.

Only compute a host or render Open original when a validated web URL exists. Otherwise use the localized share/type label in metadata and the current type fallback artwork. Source-app bundle identifiers remain provenance, not raw user-facing names. The primary action remains prominent for every item. Preserve sibling buttons and explicit focus states; use the existing touch target policy, including at least 44pt on iOS and 48dp on Android, while preserving usable safe-area navigation and enlarged text.

Pass the selected source through `initialCaptureSource`, `libraryScope: "all"`, and the existing navigation request token. Extend the Library chip and clear-filter accessible name for share mode; clear conflicting tab-local search/filter constraints when reusing a tab. Do not change the active global collection.

Alternative: add a separate mobile card. Rejected because it would duplicate loading, error, cover, navigation, and accessibility behavior.

### 6. Refresh from completed persistence

Add a lightweight application-level capture invalidation event after native share results and provenance finish persisting, carrying source and affected document IDs only. Use a frontend event mechanism accessible to the router and Dashboard; share delivery events remain ingress signals. Keep the existing native browser-save subscription.

Parameterize `useCaptureActivity` by source and memoize source-specific loaders. Subscribe while active, coalesce completion bursts using the existing refresh delay, and reload list plus analytics together with independent request state. Keep activation refresh as the authoritative fallback. Invalidate request generations on source changes/deactivation, dispose delayed work/listeners, retain visible data during refresh failures, and avoid extra capture toasts or focus movement.

Alternative: refresh on raw share delivery or watch the entire document store. Delivery races persistence, and general store changes cause unrelated refetches while failing to establish durable source attribution.

## Risks / Trade-offs

- **Historical shares lack source evidence** → Recognize all supported persisted markers, but leave genuinely unmarked old documents as ordinary imports. Avoid guessing from titles, URLs, tags, or file paths.
- **Dual-channel deduplicated documents confuse totals** → Lists represent source evidence; existing analytics retains one exclusive original-source bucket per document. Keep the 30-day all-source window visibly labeled and test the distinction.
- **Metadata merging erases imported content or origin** → Use narrow updates against the latest persisted metadata, preserve known fields, and test new, duplicate, and partial-failure imports.
- **Extra metadata writes or large capture populations increase cost** → Query metadata only, coalesce refreshes, keep bounded results, inspect query projections, and run the required local performance/bundle gate during implementation.
- **Platform detection regresses on tablets or browser fixtures** → Use existing native-runtime detection and test wide iPad/Android and narrow desktop independently from visual layout.
- **Native evidence is unavailable on a Linux development host** → Automated ingress/query/UI tests provide local coverage; record actual simulator/device checks separately and report missing hardware verification explicitly.

## Migration Plan

1. Add source-aware queries/types while retaining the browser-only wrapper and ordinary Library defaults.
2. Add explicit native share context, provenance persistence, and completed-capture invalidation; retain backward-compatible payload normalization.
3. Connect platform-aware Dashboard/list/Library presentation and localization, then run focused regression and local performance/bundle checks.
4. Verify real iOS/Android share handoffs for warm and cold starts, plus a desktop extension save. Run strict OpenSpec validation before marking implementation complete.

No schema migration or speculative backfill is needed. Rolling back the UI/source-selection code leaves additive share metadata readable by the existing classifier and browser-only callers available.
