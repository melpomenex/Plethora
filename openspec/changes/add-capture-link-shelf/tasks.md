## 1. Persisted source query

- [x] 1.1 Add a shared browser-capture eligibility/source-URL predicate using the existing provenance precedence and valid HTTP(S) candidates; verify classifier parity for conflicting markers, malformed JSON, legacy source markers, and URL fallback cases in native unit tests.
- [x] 1.2 Implement and register the bounded metadata-only `get_browser_capture_documents` command with eligible total count, page-size/offset bounds, and stable newest-first ordering; verify database tests cover cross-collection records, old saves, archived/dismissed exclusion, ties, invalid rows before pagination, and default six-item pages.
- [x] 1.3 Inspect normal, fallback, duplicate, and successful YouTube extension document-save paths and fix demonstrated provenance omissions before success events; verify native tests show those persisted documents are eligible without changing media metadata or deduplication.
- [x] 1.4 Add typed API page/item normalization in `src/api/capture-activity.ts`, preserving the existing aggregate wrapper; verify Vitest tests cover valid payloads, missing/null fields, malformed entries, nonfinite counts, invalid dates, unsupported URL schemes, and bounded inputs.

## 2. Saved-link previews

- [x] 2.1 Implement a focused capture-document tile with independent native primary/original actions, a fixed cover footprint, source/type fallback, title/domain/time metadata, and image-error handling; verify rendered interaction tests cover image failure, missing cover, independent action dispatch, and accessible button names.
- [x] 2.2 Compose the six-item shelf inside `CaptureActivityCard`, retaining compact 30-day analytics and needs-review access; verify component tests cover mixed capture sources, saves older than the window, one/two/six items, and independent shelf/analytics states.
- [x] 2.3 Implement container-aware desktop columns and the phone thumbnail list with theme-role hover/focus states, reserved action space, touch-visible controls, and reduced motion; verify desktop/phone renders have usable targets, no hover-only actions, and no layout movement on interaction.
- [x] 2.4 Add localization keys and locale-aware relative/absolute save times with accessible full titles/timestamps; verify a second locale and long titles/domains at 200% text scale preserve readable text and usable actions.

## 3. Reader and Library navigation

- [x] 3.1 Connect primary preview activation to the existing reader-tab reuse behavior and a direct document-by-ID cache-miss lookup; verify interaction tests open an uncached cross-collection record, focus an existing reader, and recover from a deleted document without creating an empty tab or reloading the whole library.
- [x] 3.2 Connect the original-page action to the existing external-opening helper with HTTP(S) validation and localized failure feedback; verify tests reject unsupported schemes and show that secondary activation does not trigger primary navigation.
- [x] 3.3 Add tab-local initial browser-source/all-library/added-descending options through `DocumentsTab` and `DocumentsView`, with a removable Browser Extension chip and visible All library scope; verify the shelf's View all action applies them and leaves the globally active collection and ordinary Library tabs unchanged.
- [x] 3.4 Extend the Library's persisted listing/filter path to share capture eligibility and filter before pagination, retaining search and existing document management behavior; verify tests find an eligible record beyond the first unfiltered page, apply additional filters across the data set, clear the source chip, and replace conflicting filters when reusing a tab.

## 4. Refresh and resilience

- [x] 4.1 Add independent shelf state/fetching to `DashboardTab` and refresh both shelf/analytics on activation; verify lifecycle tests show neither request blocks or suppresses the other's successful result.
- [x] 4.2 Subscribe to successful browser-document save events while active, coalesce bursts, clean up listeners/timers, and prevent obsolete response writes; verify fake-timer/race tests cover active saves, inactive activation, event bursts, asynchronous listener cleanup, and out-of-order requests.
- [x] 4.3 Implement stable initial skeletons, source-specific empty copy, inline retry, stale-card preservation on refresh failure, and polite updates without duplicate save toasts; verify tests retain focused previews during refresh and independently recover shelf/analytics failures.

## 5. Integrated validation

- [x] 5.1 Run focused native/API/component/navigation/lifecycle tests and normal frontend build/type checks; verify all pass and record any unrelated pre-existing failures explicitly.
- [x] 5.2 Run one batched visual/accessibility pass at a wide Dashboard content width, a narrow desktop pane, and phone width in light/dark themes, including keyboard, touch, reduced motion, image failure, long content, and 200% text; fix discovered issues in one batch and confirm in at most one additional pass.
- [ ] 5.3 Smoke-test a real extension page save and supported video save while the Dashboard is open, then open each in Plethora, open its original, and use View all; verify the destination/filter/scope, provenance, refresh, and offline fallback behavior match the spec.
- [ ] 5.4 Run the required local `npm run bench:check` including the bundle gate; verify no unintentional regression and document the reason for any intentional baseline/budget adjustment in the same change, then run `openspec validate add-capture-link-shelf --strict`.
