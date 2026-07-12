# Implementation Tasks

## 1. Pre-implementation verification

- [ ] 1.1 Grep the codebase for z-index values above `1000` (e.g. `z-[1`, `z-index: 1`) to confirm the proposed backdrop value (`z-[1100]`) clears every overlay a host page could render alongside the Flashcard Studio (command palette, `ItemDetailsPopover`, toasts, etc.). Adjust the chosen value upward if needed.
- [ ] 1.2 Confirm `--shell-mobile-nav-height` is the correct/only variable for the nav offset and that it resolves to `0px` on desktop (re-read `src/index.css` around `.adaptive-shell-root` and the `data-presentation="phone|tablet"` overrides).

## 2. Flashcard Studio mobile layout fix

- [ ] 2.1 In `src/components/review/FlashcardStudioModal.tsx`, raise the root backdrop z-index from `z-[120]` to a value above the bottom nav (`1000`) and the overlay ladder (`1050`/`1051`) — e.g. `z-[1100]` (use the value finalized in 1.1).
- [ ] 2.2 Bump the nested Image Registry overlay z-index proportionally (e.g. `z-[125]` → `z-[1200]`) so it stays above the new backdrop.
- [ ] 2.3 Bump the nested Keyboard Shortcuts overlay z-index proportionally (e.g. `z-[130]` → `z-[1300]`), preserving its order above the Image Registry.
- [ ] 2.4 Update the two footer containers' bottom padding to include `--shell-mobile-nav-height`: change `pb-[max(1rem,env(safe-area-inset-bottom))]` → `pb-[calc(max(1rem,env(safe-area-inset-bottom))+var(--shell-mobile-nav-height,0px))]` at both footer locations (Send footer ~line 4486, Save Selected footer ~line 4879).
- [ ] 2.5 Verify the header top inset (`pt-[max(1rem,env(safe-area-inset-top))]`) is still appropriate; leave unchanged unless mobile visual testing shows clipping at the top.

## 3. Volume-rocker scrolling in the review session

- [ ] 3.1 In `src/components/review/ReviewSession.tsx`, import `handleVolumeRockerNavigation` from `src/utils/volumeRockerNavigation.ts`.
- [ ] 3.2 Read the setting: subscribe to `useSettingsStore` for `settings.interface.volumeRockerScroll` (default `"none"`).
- [ ] 3.3 Add a scroll-target resolver mirroring `QueueScrollPage`: return `[data-extract-scroll="true"]` if present, else `containerRef.current`. Add an inline helper or small util.
- [ ] 3.4 In the `handleKeyPress` effect, immediately after the existing input/focus guard and before the existing key bindings, call `handleVolumeRockerNavigation(event, mode, { pageUp, pageDown, scrollUp, scrollDown })`:
  - `pageUp` → previous card; `pageDown` → next card (use the existing prev/next handlers).
  - `scrollUp`/`scrollDown` → `scrollable.scrollBy({ top: ∓180, behavior: "smooth" })` on the resolved target (delta matches the reference implementation).
- [ ] 3.5 Add `volumeRockerScroll` (and any new handler refs) to the effect's dependency array so mode changes take effect without reloading.
- [ ] 3.6 Confirm `ExtractScrollItem.tsx`'s own `keydown` listener is left untouched (do NOT also wire volume handling there) to avoid double-handling.

## 4. Testing & validation

- [ ] 4.1 Run existing unit tests for the volume-rocker helper (`src/utils/__tests__/volumeRockerNavigation.test.ts`) — expect green, no changes to the helper.
- [ ] 4.2 Run the lint/typecheck/build for the project to catch regressions in the two edited files.
- [ ] 4.3 Manual: on mobile-shell (or responsive phone width), open Flashcard Studio from each host surface (ReviewHome menu, DocumentViewer, QueueScrollPage, ExtractsList, Command Palette) and confirm the Send / Save Selected button is fully visible and tappable above the bottom nav.
- [ ] 4.4 Manual: on desktop presentation, open Flashcard Studio and confirm the layout is visually unchanged (no extra bottom offset).
- [ ] 4.5 Manual: in a review session on a device/emulator that emits `VolumeUp`/`VolumeDown`, set the toggle to `none`/`page`/`scroll` and confirm each mode behaves per spec (disabled = system default; page = prev/next card; scroll = smooth scroll of extract/session content).
- [ ] 4.6 Manual: with volume scrolling enabled, confirm existing review shortcuts still work (Space, `1`–`4`, `Cmd/Ctrl+Enter`, `Cmd/Ctrl+1-4`, `Cmd/Ctrl+E/D/S/H`, `Escape`).

## 5. Wrap-up

- [ ] 5.1 Update in-app help / Keyboard Shortcuts overlay copy if it lists volume-rocker behavior for review (only if such copy already exists for other surfaces — keep parity).
- [ ] 5.2 Run `openspec validate mobile-ux-flashcards-and-volume-scroll --strict` and resolve any reported issues.
