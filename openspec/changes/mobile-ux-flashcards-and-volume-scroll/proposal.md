## Why

On mobile, two distinct UX gaps make the app frustrating to use on a phone:

1. **AI Flashcard Studio bottom button is unreachable.** When the Flashcard Studio modal opens (via any "Create Flashcard" action), its footer action button draws *under* the fixed mobile bottom navigation bar, so users cannot tap the primary action (Send / Save Selected). The modal (`z-[120]`) shares a stacking context with the bottom nav (`z-index: 1000`) because it renders inline (no portal), and the nav wins — painting over the button the user needs.
2. **Volume rocker doesn't scroll long review content.** Hardware volume buttons already scroll content in four other surfaces (QueueScrollPage, RSSScrollMode, EPUBViewer, DocumentViewer), but the dedicated review session — where users read long Extracts and flip cards — was never wired up. Users expect the rocker to scroll the text they're reading instead of changing system volume.

## What Changes

**Flashcard Studio mobile layout fix:**
- Raise the Flashcard Studio modal backdrop/panel above the mobile bottom navigation (and the existing `--overlay-backdrop-z`/`--overlay-sheet-z` ladder) so its footer button is tappable on mobile.
- Account for the bottom nav height in the modal's footer bottom padding (consume the existing `--shell-mobile-nav-height` variable, mirroring other mobile sheets), so the action button clears the nav even if the nav remains visible.
- Move the modal's nested overlays (Image Registry, Keyboard Shortcuts) up proportionally so they remain stacked above the backdrop.
- No desktop behavior change (desktop nav height resolves to `0px` and the modal is centered with `sm:` spacing).

**Volume-rocker scrolling in the review session:**
- Wire the existing `handleVolumeRockerNavigation` helper + `volumeRockerScroll` setting into the review session component (`ReviewSession.tsx`), honoring the user's chosen mode (`page` = move between cards / `scroll` = scroll the current card or extract content / `none` = disabled, system default).
- Reuse the existing Settings toggle ("Volume Rocker Scroll") — no new setting or Tauri capability is required, since the Android WebView already delivers `VolumeUp`/`VolumeDown` as keyboard events.

## Capabilities

### New Capabilities
- `mobile-flashcard-studio-layout`: Correct mobile layering and bottom-safe inset for the AI Flashcard Studio modal so its primary action is reachable above the bottom navigation.
- `review-volume-rocker-scrolling`: Hardware volume buttons navigate/scroll review-session content (cards and Extracts) per the existing volume-rocker setting.

### Modified Capabilities
<!-- None — no existing spec requirements are changing. Both fixes introduce new capability specs. -->

## Impact

**Affected code:**
- `src/components/review/FlashcardStudioModal.tsx` — backdrop z-index, inner panel height/footer padding, nested overlay z-indexes.
- `src/components/review/ReviewSession.tsx` — extend the `handleKeyPress` effect to call `handleVolumeRockerNavigation`; add `volumeRockerScroll` to dependencies.
- Possibly `src/components/review/ExtractScrollItem.tsx` / `ZenReviewMode.tsx` — if the scroll target or Zen surface needs the same wiring for completeness.

**Reused infrastructure (no new dependencies):**
- `src/utils/volumeRockerNavigation.ts` (existing helper + tests).
- `src/stores/settingsStore.ts` — `interface.volumeRockerScroll` setting + Zustand persist (already shipped).
- `src/index.css` — `--shell-mobile-nav-height` CSS variable (already defined and consumed by other mobile sheets).
- `src/styles/mobile.css` — `--overlay-backdrop-z` / `--overlay-sheet-z` z-index ladder.

**APIs / dependencies / systems:** None added. No Tauri config or capability changes (Android WebView already routes volume keys to `KeyboardEvent`; `os:default` already granted). No migrations. No breaking changes.

**Platforms:** The layout fix is mobile-shell-only (phone/tablet presentation); desktop is visually unchanged. Volume-rocker scrolling is only active on platforms that emit `VolumeUp`/`VolumeDown` keys (Android/iOS WebView) and otherwise no-ops.
