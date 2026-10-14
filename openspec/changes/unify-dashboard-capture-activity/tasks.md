## 1. Source contracts and eligibility

- [x] 1.1 Add the narrow browser-extension/share-target listing source type and a runtime source selector using native platform detection; verify native iOS/Android select shares at phone/tablet widths and desktop/web retain browser mode at narrow/wide widths.
- [x] 1.2 Add shared persisted share eligibility and optional original-URL resolution alongside the existing browser predicate; verify native/TypeScript parity for iOS/Android markers, legacy share records, null/malformed metadata, unsupported URL schemes, valid URL fallback, and unrelated manual/RSS records.
- [x] 1.3 Define the deduplicated-document attribution merge that retains content, original timestamps, and established browser provenance, including legacy browser markers; verify a browser document re-shared on mobile qualifies once in both appropriate views while exclusive analytics still counts one document.

## 2. Durable share ingestion

- [x] 2.1 Preserve optional native origin/source-app fields through share normalization and staged-batch adapters, adding native serialization fields only where needed; verify old payloads, staged iOS payloads, and warm Android payloads without batch IDs normalize compatibly with available provenance retained.
- [x] 2.2 Pass explicit native share-ingress context from `useShareTarget` into the shared import router while leaving desktop external-open without share context; verify external-open/manual imports do not gain share attribution and Android/iOS obtain the correct origin.
- [x] 2.3 Replace staged-text-only attribution with an awaited per-result metadata helper for URL, specialized X/video, file, text, and deduplicated imports; verify routing tests cover each path, mixed batches, per-item URL associations, content/metadata preservation, and no-ID warm shares.
- [x] 2.4 Await and attribute saved URL failure placeholders; verify extraction failure can leave a discoverable shared placeholder with existing retry feedback, while a failure producing no saved document emits no successful capture invalidation.
- [x] 2.5 Make provenance-write failures recoverable before success feedback or staged acknowledgement, and retain saved IDs for annotation retries without recreating documents; verify ordering/failure tests delay completion until attribution succeeds and retries remain idempotent.

## 3. Persisted capture queries and API

- [x] 3.1 Implement/register source-selected `get_capture_documents` with metadata-only projection, eligible total, six-item default, bounded limit/offset, and stable newest-first ordering; verify repository tests cover local files/text without URLs, old dates, multiple collections, tied timestamps, archived/dismissed exclusion, malformed rows before pagination, and invalid source rejection.
- [x] 3.2 Keep `get_browser_capture_documents` as a compatible browser-only wrapper; verify existing browser repository/API tests still enforce valid HTTP(S) URLs and unchanged browser eligibility, response fields, ordering, and bounds.
- [x] 3.3 Add generalized typed capture-page normalization with nullable source URLs while retaining strict browser normalization; verify API tests preserve valid no-URL records, sanitize invalid web URLs, reject unusable IDs/dates, deduplicate IDs, and normalize page bounds/counts.
- [x] 3.4 Extend the persisted document-list command, API, and browser-backend source filtering to support share-target with the same eligibility; verify both source views include records beyond an unfiltered first page and explicit unsupported sources cannot silently return the whole library.

## 4. Dashboard previews and Library navigation

- [x] 4.1 Generalize the capture shelf/card/tile props to source-aware capture data and conditionally render domain/original-page controls only for valid web URLs; verify component tests render a URL article, local PDF, image/audio item, and text note, including missing/broken cover fallback and independent accessible primary/external actions.
- [x] 4.2 Connect platform-selected capture loading and reader-by-ID navigation in Dashboard; verify an uncached cross-collection share opens, an existing reader is focused, deleted records recover without an empty reader, and a narrow desktop retains extension captures.
- [x] 4.3 Extend View all source options through `DocumentsTab`, `DocumentsView`, and `useLibraryDocuments`, including removable share-source chips and tab-local filter replacement; verify all-library newest-first listing, further filtering beyond six previews, clearing the chip, reusable-tab navigation, and unchanged active collection/ordinary tabs.
- [x] 4.4 Add mobile share heading, View all, empty-state guidance, and accessible source labels to all supported locales; verify no browser-extension instructions appear in native mobile states and a second locale, long content, and 200% text scaling remain readable without clipped actions.

## 5. Capture completion and refresh

- [x] 5.1 Emit a lightweight capture invalidation after native share document/provenance persistence, including saved placeholders and successful items in partially failed batches; verify completion observers run after durable attribution and raw payload delivery or unsaved failures do not emit completion.
- [x] 5.2 Parameterize capture query loaders and extend the hook's active subscriptions while retaining browser-save events and activation refresh; verify fake-timer/lifecycle tests cover source selection, coalesced bursts, inactive Dashboard activation, listener/timer cleanup, stale-response rejection, and preserved content/focus on independent query failures.

## 6. Integrated verification

- [x] 6.1 Run focused native repository/classification and Vitest ingress/API/component/navigation/lifecycle regressions plus frontend type/build checks; verify changed behavior passes and record any unrelated existing failures in change-local validation notes.
- [x] 6.2 Verify actual iOS and Android share handoffs on available simulator/emulator/device environments for warm/cold starts, URL/file/text/mixed inputs, duplicate saves, and Dashboard return; verify previews and matching View all results, and record environment evidence or unavailable native coverage explicitly.
- [ ] 6.3 Verify a desktop extension save, then batch visual/accessibility checks across native phone/tablet and wide/narrow desktop presentations with light/dark themes, enlarged text, touch/keyboard, reduced motion, no-URL previews, and empty/error states; run the Impeccable detector on changed UI targets, fix findings in one batch, and confirm with at most one further pass. (Detector and narrow/tablet responsive previews completed; a live extension instance, native devices, and full presentation matrix were unavailable.)
- [ ] 6.4 Run the local `npm run bench:check` performance/bundle gate and strict OpenSpec validation; verify passing output and document any intentional baseline or bundle-budget changes in the same change, following repository benchmark rules for any new suites. (Strict validation passed; performance gate returned 14 cross-project baseline failures, documented in `validation.md`.)
