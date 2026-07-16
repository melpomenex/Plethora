## Why

The Audiobooks Shelf currently shows imported podcast episodes alongside real audiobooks because podcast documents are tagged `["podcast", "audio"]` and the shelf's filter matches on the generic `"audio"` tag. This pollutes the shelf with content that belongs in the Podcasts view and confuses listening stats/counts. Separately, the mobile "More" menu (the toolbar overflow sheet used to reach secondary sections like RSS, Newsletters, Analytics, Podcasts) has no entry for Audiobooks, so on mobile/PWA there is no way to reach the Audiobooks Shelf at all.

## What Changes

- Fix the audiobook-membership filter (`AudiobooksTab`) so documents tagged `"podcast"` are excluded even though they also carry the `"audio"` tag — a document is an audiobook only if it has `fileType === "audio"` (or an explicit `"audiobook"` tag) and is **not** tagged `"podcast"`.
- Apply the same exclusion anywhere else in the app that infers "is this an audiobook" purely from `fileType === "audio"` / a loose `"audio"` tag check, if such logic exists outside `AudiobooksTab`.
- Add an "Audiobooks" entry to the mobile "More" menu (`MobileNavigation`'s `allNavItems`), mirroring the existing "Podcasts" entry, so the Audiobooks Shelf tab is reachable from the toolbar overflow menu on mobile/PWA.

## Capabilities

### New Capabilities
- `audiobook-shelf-classification`: Defines which documents qualify as "audiobooks" for the Audiobooks Shelf tab, ensuring podcast episodes are excluded even though they share the `"audio"` tag.
- `mobile-more-menu-audiobooks`: Defines that the mobile "More" menu (toolbar overflow sheet) includes an entry to open the Audiobooks Shelf tab.

### Modified Capabilities
(none — no existing `openspec/specs/` capability currently governs this behavior)

## Impact

- `src/components/tabs/AudiobooksTab.tsx` — audiobook membership filter (`audiobooks` useMemo).
- `src/components/mobile/MobileNavigation.tsx` — `allNavItems` list and any related i18n label.
- `src/lib/i18n/locales/*.ts` — new nav label key(s) for "Audiobooks" in the More menu (mirroring existing `podcastManager.podcasts` usage) if a new key is needed, or reuse `toolbar.audiobooks`.
- No database schema or backend command changes — the underlying tag data (`["podcast", "audio"]`) from `src/lib/browser-backend.ts` and `src-tauri/src/commands/audiobook.rs` is left as-is; only client-side classification logic changes.
