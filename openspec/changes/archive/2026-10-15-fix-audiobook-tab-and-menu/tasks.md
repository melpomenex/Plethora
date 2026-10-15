## 1. Fix Audiobooks Shelf classification

- [x] 1.1 In `src/components/tabs/AudiobooksTab.tsx`, update the `audiobooks` filter so a document tagged `"podcast"` (case-insensitive) is excluded even when `fileType === "audio"` or an `"audio"` tag is present.
- [x] 1.2 Search for any other views/stores that independently derive "is this document an audiobook" from `fileType === "audio"` or a loose `"audio"` tag match (e.g. dashboard widgets, continue-reading, search/command center) and apply the same `"podcast"` exclusion if found. (Audited via subagent: no other site does tag-based audiobook classification; all other `fileType === "audio"` hits are intentionally podcast-inclusive — audio/epub pairing, transcript search, transcription queue, file sync — so no further changes needed.)
- [x] 1.3 Add/update a test (e.g. in `src/components/schedule/__tests__/` sibling location or a new `AudiobooksTab` test) covering: a podcast-tagged audio document is excluded; a plain `fileType: "audio"` document with no podcast tag is included; a document with an explicit `"audiobook"` tag is included. (Extracted the predicate to `src/components/tabs/audiobookClassification.ts` and added `src/components/tabs/__tests__/audiobookClassification.test.ts`.)

## 2. Add Audiobooks entry to mobile More menu

- [x] 2.1 In `src/components/mobile/MobileNavigation.tsx`, import `AudiobooksTab` from `../tabs/TabRegistry` and add a `Headphones` icon import from `@phosphor-icons/react`.
- [x] 2.2 Add an `audiobook` entry to `allNavItems` (after `podcast`) using `tabType: "audiobook"`, `tabContent: AudiobooksTab`, and the existing `toolbar.audiobooks` i18n key for its label, mirroring the shape of the existing `podcast` entry.
- [x] 2.3 Verify the entry is picked up by the `moreItems` derivation (items in `allNavItems` not in `primaryNavItems`) with no further wiring needed, and that tapping it opens/focuses the Audiobooks Shelf tab and closes the menu. (Confirmed `moreItems`/`openTab` are generic over `NavItem`, no additional wiring required; verified visually in-browser below.)

## 3. Verify

- [x] 3.1 Run the existing test suite (`npm test` or the project's configured runner) and confirm no regressions. (`npx vitest run`: 1260 passed, 4 pre-existing failures unrelated to this change — WorkspaceSwitcher, notebooklm integration, fileSyncRegistration, EPUBViewer — none touch AudiobooksTab or MobileNavigation.)
- [x] 3.2 Manually verify in the running app (desktop and/or mobile viewport): import or seed a podcast episode and an audiobook, confirm the podcast no longer appears in the Audiobooks Shelf, and confirm the mobile More menu now opens the Audiobooks Shelf via the new entry. (Verified in mobile viewport via browser dev server: seeded a podcast-tagged doc + a real audiobook doc directly in IndexedDB — shelf shows "Total Books: 1" and only "Test Real Audiobook" renders, podcast excluded. Also confirmed the More menu's new "Audiobooks" item opens/activates the Audiobooks Shelf tab.)
