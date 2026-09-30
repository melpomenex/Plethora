## 1. Card source fallback navigation

- [x] 1.1 Add a final rung to `resolveCardSource` in `src/utils/cardSourceNavigation.ts`: when no earlier rung resolved and `item.document_id` is present, verify the document still exists with `findDocument` and return a `coarse` resolution carrying that `documentId` with no `location`; leave the existing `no-source` return in place for cards with no `document_id` at all
- [x] 1.2 Confirm `openCardSource`'s existing "no locator at all → open at the document's stored reading position" branch (`:519-528`) is now reachable without modification, and that the review-return context is still passed through
- [x] 1.3 Extend `src/utils/__tests__/cardSourceNavigation.test.ts` with a card carrying only `document_id`: assert a `coarse` resolution with that `documentId` and no location, and assert the pre-existing `no-source` assertion still holds for a card with no `document_id`, no `extract_id` and no `source_reference`
- [x] 1.4 Add a test that a card whose `document_id` row is gone still resolves to `unavailable` / `document-missing` rather than the new coarse rung
- [ ] 1.5 *(needs the running app — not verifiable in this environment; resolution and navigation are covered by `cardSourceNavigation.test.ts` and `cardSourceOutcome.test.ts`, but the click-through against real data is not)* Verify by hand in the app: open a whole-document-generated card, activate "View source", and confirm the document opens at its stored reading position (or at the start) with no error panel

## 2. Source messaging and cross-surface consistency

- [x] 2.1 Reword the `no-source` string in all six locales so it states the card has no source, and reserve the "the original document no longer exists" wording for `document-missing`; confirm the `stale` string still reads correctly for a passage that no longer matches
- [x] 2.2 Update `presentResolution` in `src/components/review/CardSourceContext.tsx` so each resolution reason maps to its own message, and so no `document-missing` wording can be reached from `no-source`
- [x] 2.3 Export a single source-availability predicate from beside `CardSourceProbe` in `src/utils/cardSourceNavigation.ts`, matching the rule `get_card_source_context` already uses (`document_id` present ⇒ a source context exists)
- [x] 2.4 Replace `hasSource` at `src/components/review/CardContextMenu.tsx:121` with that predicate, and confirm the menu now shows "View source" for a card that has only a `document_id`
- [x] 2.5 Route the `V` keyboard shortcut in `ReviewSession.tsx` and `ZenReviewMode.tsx` through the same predicate so the shortcut is never bound to a card that cannot use it
- [x] 2.6 Add a test that a document-only card presents the same "View source" availability in the strip, the context menu, and the keyboard path
- [x] 2.7 Run the i18n placeholder-parity test and confirm the new and reworded keys are present in `en`, `de`, `es`, `fr`, `ja`, `zh`

## 3. Schedule navigation chrome

- [x] 3.1 Remove the `hidden xs:inline` wrapper from the three view-switcher labels at `src/components/mobile/MobileQueueView.tsx:602, 619, 631` so they render at every width; give each label `min-w-0 truncate` so a 320 px viewport still fits, and confirm the 44 px touch targets from `src/styles/mobile.css` are preserved
- [x] 3.2 Add a labelled back control to `src/components/schedule/ScheduleWorkspaceHeader.tsx` that returns the queue to its **default** mode, and keep it visually distinct from the existing date-filter `X`
- [x] 3.3 Confirm the desktop queue's existing Reading/Schedule/Review control row still works and is not duplicated by the new back control in schedule mode
- [x] 3.4 Thread an `onExit` prop from `ScheduleView` through `MobileScheduleView` so the phone shell can wire the header's back control to the queue's default mode
- [x] 3.5 Verify the back control is keyboard reachable with a visible focus state and an accessible name, and that clearing a date scope does not leave the Schedule workspace
- [x] 3.6 Add the new labels to all six locales and run the i18n placeholder-parity test

## 4. SponsorBlock settings in the live store

- [x] 4.1 Add a top-level `sponsorBlock: SponsorBlockSettings` category to the live `Settings` interface and `defaultSettings` in `src/stores/settingsStore.ts`, lifting the shape from `src/types/settings.ts:342-359` and its defaults from `src/config/defaultSettings.ts:251-267`; `enabled` defaults to `true` to preserve current behaviour
- [x] 4.2 Bump the persist `version` from 13 to 14 and add a `migrate` step that fills SponsorBlock defaults whenever the key is absent on a stored blob, following the v7→v8 precedent at `settingsStore.ts:1507-1516`; confirm a corrupt blob still loads
- [x] 4.3 Remove the SponsorBlock parts from the parallel `Settings` type, its `config/defaultSettings.ts` entry, and `settingsValidation.ts`'s `SponsorBlockSettingsSchema`, so there is only one source of truth
- [x] 4.4 Add a SponsorBlock section to `src/components/settings/IntegrationSettings.tsx` following the `RSSSettings.tsx:44-53` pattern — `updateSettingsCategory` plus a `defaultSettings` fallback — with the enable switch, an auto-skip switch, a notifications switch, and a per-category toggle for every category the service is actually asked for. **Deviation from the original task text:** seven categories, not eight — `filler` appears in the dead parallel `SponsorBlockSettings` type but is in neither the TS `SponsorBlockCategory` union nor the Rust `categories=` query string, so a toggle for it would have been a dead control. Category keys are the API's own wire names so filtering is a direct lookup with no translation table.
- [x] 4.5 Remember that `updateSettingsCategory` shallow-merges one level: replace the nested `categories` object wholesale in the panel's update path, and confirm toggling one category leaves the other seven untouched
- [x] 4.6 Use `src/components/common/Switch.tsx` for every toggle so `touchTarget` gives a ≥44 px hit area, and label each category with the existing `getCategoryDisplayName` copy
- [x] 4.7 State in the panel copy that the category setting governs playback skipping only and not download pre-cutting
- [x] 4.8 Add the new strings to all six locales, run the i18n placeholder-parity test, and add a store test covering the 13→14 migration and per-category isolation

## 5. SponsorBlock gating, caching, and cleanup

- [x] 5.1 Gate the segment fetch in `src/components/viewer/YouTubeViewer.tsx:534-543` on `enabled` so no request is made and no video id leaves the device when SponsorBlock is off
- [x] 5.2 Gate the skip loop at `src/components/viewer/YouTubeViewer.tsx:790-866` on `enabled && autoSkip`, and filter the segment list by the enabled categories before the loop runs
- [x] 5.3 Confirm the existing per-segment undo (`handleUndoSkip`, `:219-233`) still suppresses a re-skip when `autoSkip` is on, and that the skip notification respects the notifications setting
- [x] 5.4 Apply the same gating and category filtering to `src/components/viewer/LocalVideoPlayer.tsx:202-235` and `src/components/viewer/AudiobookViewer.tsx:557-580`, which carry the same ungated loops
- [x] 5.5 Add a timeout to `fetchSponsorBlockSegments` in `src/api/sponsorblock.ts` using `AbortSignal.timeout`, matching `src/api/youtube.ts:239`, and confirm a slow or unreachable service leaves playback unaffected and surfaces no media error
- [x] 5.6 Add an in-memory segment cache in `src/api/sponsorblock.ts` keyed by video id, with a TTL from `cacheDuration`, a bounded entry count, and one shared in-flight promise per id so three components mounting at once produce one request
- [x] 5.7 Cache a failed or empty result for the session so it is not retried, and confirm setting the cache duration to zero restores per-playback requests
- [x] 5.8 Fix the doubled `/api` path in `submitSegment` and `voteOnSegment` (`src/api/sponsorblock.ts:213, 244`) and add a test asserting the request URL contains a single `/api/skipSegments`
- [x] 5.9 Delete `src/components/media/SponsorBlockIntegration.tsx` and confirm no import of `SponsorBlockIntegration` remains anywhere in the repo
- [x] 5.10 Replace the per-call `reqwest::Client` in `src-tauri/src/sponsorblock.rs:54` with a shared `Lazy<reqwest::Client>` following `src-tauri/src/twitter.rs:54`. **Deviation:** the `incrementum` data directory constant at `:187` is left alone — `incrementum` is still the repo-wide on-disk convention (`browser_sync_server.rs:5087`, `epub_server.rs:217`), so renaming it in this one module would orphan every user's existing pre-cut metadata and make the module inconsistent with every other path that stores state.
- [x] 5.11 Add tests for the category filter, the cache hit/miss/TTL behaviour, the timeout path, and the disabled path making no request

## 6. Mobile queue viewport safety

- [x] 6.1 Repair `src/hooks/useSwipeGestures.ts` by holding gesture state in refs read through the handlers. **Also found and fixed here:** the hook read its element from a plain `ref` in the binding effect, but `SwipeableItem` populated that ref in its own `useEffect`, which React runs *after* the hook's — so the effect saw `null`, returned early, and never re-ran. No touch listener was ever attached, meaning phone swipe-to-suspend/delete was inert. The hook now takes a callback ref and holds the element in state so the effect re-runs on attach; the two `PodcastManager` panels that passed `elementRef` as a `ref` prop lost their now-invalid casts., so `handleTouchMove` and `handleTouchEnd` no longer close over `state` and the binding effect's dependencies stay stable; the snap-back's rAF id must remain owned by the ref the cleanup cancels
- [x] 6.2 Add a unit test for the snap-back lifecycle proving the animation is not cancelled by its own state update and that the offset reaches exactly zero, plus a test that the first `touchmove` of a gesture is not dropped
- [x] 6.3 Clamp the live drag offset in `handleTouchMove` to the action-reveal width so a fast flick cannot paint a row off-screen mid-drag
- [x] 6.4 Confirm `SwipeableItem` still triggers its left and right actions at the existing threshold after 6.1–6.3, and that `reset` still lands the row undisplaced
- [x] 6.5 Render the session queue list as a viewport-anchored sheet on phone — following `FSRSInspector.tsx:259-267` with `fixed right-0 top-0 bottom-0` and safe-area padding — gated on the same `isMobile` signal `src/components/tabs/QueueTab.tsx` uses, and keep the existing desktop dropdown
- [x] 6.6 Add `Escape` to close the queue list alongside the existing outside-click handler at `ReviewSession.tsx:503-525`, and confirm dismissal works from both positions in the phone sheet
- [x] 6.7 Bound the zen progress dots at `src/components/review/ZenReviewMode.tsx:703` with `flex-wrap` and a `max-w` so a long session's indicator stays on screen and still communicates progress
- [x] 6.8 Add `min-w-0` to the desktop queue scroller at `src/components/review/ReviewQueueView.tsx:1276` and confirm opening and closing the always-on `w-80` inspector causes no horizontal overflow
- [ ] 6.9 *(needs a real phone or device emulator — the classes and gesture lifecycle are unit-tested, the rendered geometry is not)* Verify at a 320 px and a 360 px viewport: open the session queue list, confirm the whole panel is on screen; flick a queue row left and release, confirm the row animates back fully into view; rotate the device with the list open, confirm it repositions

## 7. Dead code and undefined classes

- [x] 7.1 Remove the dead legacy "Source jump" button and its handler at `src/routes/review.tsx:398-443`, which dispatch `plethora:source-jump` with no listener anywhere in the repo
- [x] 7.2 Remove the never-populated `source_anchor?` field from `src/api/review.ts:321-327` and confirm no call site reads it
- [x] 7.3 Replace the undefined utility classes: the `pb-safe` on `ScheduleView.tsx:410`, the `scrollbar-hide` at `MobileQueueView.tsx:646` and `ScheduleWorkloadBand.tsx:190`, and confirm no `xs:`-prefixed utility remains in `src/`
- [x] 7.4 Swept all 45 touched files for class names with no matching rule. The three named classes are gone. **Out-of-scope finding, not fixed here:** `.animate-in` is defined (`src/index.css:1035`) but `.fade-in`, `.fade-in-0`, `.zoom-in-95` and `.slide-in-from-top-*` are not, and `tailwindcss-animate` is not a dependency — so those entry animations generate nothing. They are pre-existing in the touched files (not introduced by this change) and fixing them means adding new keyframes, which is animation polish rather than a reported bug. Worth its own change.

## 8. Verification

- [x] 8.1 Run the full test suite and typecheck
- [ ] 8.2 *(partly automated: `cardSourceNavigation.test.ts` covers whole-document, section-scoped, deleted-document and no-source cards; the real-data pass is not)* Exercise the card-source fixes against real data: a whole-document card, a section-scoped card, a card whose document was deleted, and a manually created card with no source
- [ ] 8.3 *(partly automated: `settingsStore.test.ts` covers persistence across rehydrate and per-category isolation; `useSponsorBlock.test.ts` covers the gates; the three players on a device are not)* Confirm the SponsorBlock settings survive an app restart, and that toggling a category changes which segments skip in all three players
- [ ] 8.4 *(automated equivalent: `YouTubeViewer.test.tsx` asserts no request is issued when SponsorBlock is disabled, and that turning it off mid-session stops requests; `sponsorblock.test.ts` covers the cache TTL and the no-retry path. The browser network panel was not used.)* Confirm with the network panel that disabling SponsorBlock issues no request to the SponsorBlock service, and that replaying a video within the cache duration issues no second request
- [x] 8.5 Update `docs/USER_HANDBOOK.md` and its five translations for the SponsorBlock settings, the new source-navigation fallback wording, and the Schedule back control
- [x] 8.6 Note in `openspec/changes/reimplement-incrementum-features/specs/settings-management/spec.md` and its `tasks.md:200` that the SponsorBlock settings requirement is satisfied by this change rather than duplicating it
