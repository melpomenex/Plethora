## Context

This change fixes two independent mobile UX problems in one proposal (per user request to roll them into a single mobile-UX change).

**Problem A — Flashcard Studio layering.** `FlashcardStudioModal` renders as a hand-rolled `fixed inset-0` overlay. It does **not** use a React portal, so it lives inside the same stacking context (`.adaptive-shell-root`, itself `position: fixed`) as the mobile bottom navigation. The modal backdrop uses `z-[120]`; the bottom nav (`.mobile-bottom-nav` in `src/styles/mobile.css`) uses `z-index: 1000`. Same stacking context + `1000 > 120` → the nav paints over the modal's footer, hiding the primary Send / Save Selected button on mobile.

Two related facts make a clean fix possible:
- The codebase already defines `--shell-mobile-nav-height` (`calc(58px + env(safe-area-inset-bottom))` on phone/tablet, `0px` on desktop) in `src/index.css`, and other mobile sheets already consume it for bottom padding.
- A z-index ladder exists for overlays: `--overlay-backdrop-z: 1050`, `--overlay-sheet-z: 1051`. The Flashcard Studio modal currently bypasses this ladder with a hardcoded `z-[120]`.

The modal also has two nested overlays (Image Registry `z-[125]`, Keyboard Shortcuts `z-[130]`) that sit above its own backdrop by design.

**Problem B — Volume-rocker scrolling.** A complete, tested volume-rocker subsystem already ships in the app:
- `src/utils/volumeRockerNavigation.ts` — `handleVolumeRockerNavigation(event, mode, callbacks)` consumes `VolumeUp`/`VolumeDown` keys.
- `settingsStore.ts` — `interface.volumeRockerScroll` (`"none" | "page" | "scroll"`, default `"none"`), persisted via Zustand `persist`.
- Settings UI toggle ("Volume Rocker Scroll") already exists at `SettingsPage.tsx`.
- Wired into 4 surfaces: `QueueScrollPage`, `RSSScrollMode`, `EPUBViewer`, `DocumentViewer`.

The dedicated review session (`ReviewSession.tsx`) was never wired up. It has a `handleKeyPress` effect (window `keydown` listener) with an input/focus guard and key bindings (Space, Cmd+Enter, 1-4, etc.) but no volume handling. The scrollable content there is: the session root (`containerRef`, `overflow-y-auto` on mobile) and, when an Extract is shown, `ExtractScrollItem`'s `data-extract-scroll="true"` container (`max-h-[60vh] overflow-y-auto`).

**Constraints / stakeholders:** Mobile-shell users (phone/tablet presentation). Desktop must be visually unchanged. No new Tauri capabilities (Android WebView already routes volume keys to `KeyboardEvent`; `os:default` already granted).

## Goals / Non-Goals

**Goals:**
- Flashcard Studio primary action button is fully tappable on mobile (not occluded by the bottom nav).
- The fix is robust to both z-index ordering and physical layout (button clears the nav bar even if the nav remains rendered).
- Volume-rocker navigation works inside the review session, honoring the existing setting and its three modes, with no double-handling or interference with existing review shortcuts.
- No new dependencies, no Tauri config changes, no migrations, no desktop regressions.

**Non-Goals:**
- Re-architecting the modal to use a portal or a shared Modal/Sheet primitive.
- Redesigning the mobile bottom nav or its z-index ladder globally.
- Adding new settings (the existing toggle is reused).
- Wiring volume-rocker into every remaining surface (e.g. Zen mode, ReviewQueueView list) — only the primary review session is in scope; others can follow the same pattern later if desired.
- iOS/Android OS-level volume-key capture via a global-shortcut plugin (unnecessary; WebView key events suffice).

## Decisions

### A1. Fix the z-index conflict by raising the modal above the nav ladder

**Decision:** Change the Flashcard Studio backdrop from hardcoded `z-[120]` to a value above both the bottom nav (`1000`) and the overlay ladder (`1050`/`1051`). Use a single Tailwind arbitrary value (e.g. `z-[1100]`) so the whole modal — backdrop, panel, nested Image Registry/Shortcuts overlays — clears the nav and the generic overlay ladder.

**Rationale:** This is the direct root cause (same stacking context, lower z-index). Raising the modal is one line per overlay and immediately fixes occlusion on *every* mobile screen that hosts the modal (ReviewHome, DocumentViewer, QueueScrollPage, ExtractsList), without touching the globally-used bottom nav z-index (which other overlays rely on).

**Alternatives considered:**
- *Hide the bottom nav when the modal opens* (the `hidden` prop already exists on `MobileNavigation`). Rejected as the primary fix: it requires lifting open-state out of 5 independent host components into the shell, or adding a global "modal-open" signal — more invasive and doesn't fix the secondary inset problem (see A2). Could be a future enhancement.
- *Render the modal in a portal to `document.body`.* Rejected: would move it out of the `.adaptive-shell-root` stacking context and "fix" the z-index comparison, but it risks regressions in the modal's existing positioning, event handling (`onPasteCapture`, `onClick` backdrop dismiss), and CSS variable inheritance (`--shell-safe-*` are scoped to `.adaptive-shell-root`). Too risky for a focused mobile fix.

### A2. Also account for nav height in footer bottom padding

**Decision:** In addition to A1, change the two footer containers' bottom padding from `pb-[max(1rem,env(safe-area-inset-bottom))]` to include `--shell-mobile-nav-height`, e.g. `pb-[calc(max(1rem,env(safe-area-inset-bottom))+var(--shell-mobile-nav-height,0px))]`. This mirrors how other mobile sheets consume the variable.

**Rationale:** Defense in depth. If a future change re-introduces occlusion (e.g. the nav z-index is bumped again, or the modal is re-layered), the action button still physically sits above where the nav renders. On desktop `--shell-mobile-nav-height` is `0px`, so no visual change there. Combined with A1 it makes the fix resilient.

**Alternatives considered:**
- *Shrink the inner panel height by the nav height* (`h-[calc(100dvh-var(--shell-mobile-nav-height,0px))]`). Rejected as primary because it changes the modal's visual height on mobile and complicates the centered desktop layout; the padding approach (A2) is less invasive. Could be combined if testing shows the panel still clips.

### A3. Move nested overlays up proportionally

**Decision:** Bump the Image Registry (`z-[125]` → e.g. `z-[1200]`) and Keyboard Shortcuts (`z-[130]` → e.g. `z-[1300]`) overlays so they remain above the new backdrop z-index. Keep their relative ordering (Shortcuts above Image Registry above backdrop).

**Rationale:** These are designed to sit above the modal. If only the backdrop moves up, they'd render beneath it. Minimal, proportional bumps preserve intent.

### B1. Wire volume-rocker into ReviewSession's existing keydown handler

**Decision:** In `ReviewSession.tsx`, inside the `handleKeyPress` effect, call `handleVolumeRockerNavigation(event, mode, callbacks)` immediately after the existing input/focus guard and *before* the rest of the key handling. Read `mode` from `useSettingsStore(s => s.settings.interface.volumeRockerScroll) ?? "none"`. If the helper consumes the event (returns true / calls `stopPropagation`), the existing key bindings are skipped. Add the mode to the effect's dependency array.

**Rationale:** This is the exact pattern already used by `QueueScrollPage.tsx:2187`, `DocumentViewer.tsx:3142`, `EPUBViewer.tsx:2006`, `RSSScrollMode.tsx:678`. Placing the call after the input guard means volume keys still work while a user is focused in an input/textarea inside the session (consistent with how other surfaces behave), and placing it before the rating shortcuts guarantees no conflict with `1`–`4` rating keys (which are different keys anyway).

**Callbacks by mode:**
- `page`: `pageUp` → previous card (`goToIndex(currentIndex - 1)` or equivalent prev handler); `pageDown` → next card. Non-repeat only (helper enforces this).
- `scroll`: `scrollUp`/`scrollDown` → smooth `scrollBy` on the active scroll element. The scroll target resolution mirrors `QueueScrollPage`: prefer the inner Extract content (`[data-extract-scroll="true"]`) when present, else fall back to `containerRef.current`.

**Alternatives considered:**
- *Wire it into `ExtractScrollItem.tsx` instead.* Rejected as primary: `ExtractScrollItem` and `ReviewSession` both attach window-level `keydown` listeners, so wiring both risks double-handling. `ReviewSession` is the natural owner because it knows session state (whether the answer is shown, current index). `ExtractScrollItem`'s own `keydown` (for `C`/`Q`/rate keys) is left untouched.
- *Add a dedicated window listener separate from `handleKeyPress`.* Rejected: redundant; the existing listener is the right insertion point and keeps cleanup in one place.

### B2. Resolve the scroll target the same way QueueScrollPage does

**Decision:** Extract/inline a small `getScrollableContentElement()` helper (mirroring `QueueScrollPage.tsx`) that returns `[data-extract-scroll="true"]` if present, else `containerRef.current`. Use `scrollable.scrollBy({ top: ±180, behavior: "smooth" })` (same delta as the reference implementation) for consistency.

**Rationale:** Consistency with the battle-tested reference implementation; the `data-extract-scroll="true"` attribute is already emitted by `ExtractScrollItem` precisely as a stable hook.

## Risks / Trade-offs

- **[Z-index arms race]** Raising the modal to `z-[1100]` could later collide with another overlay that picks a nearby value. → Mitigation: pick a value clearly above the ladder (`1100` > `1051`) and document it inline; prefer consuming `--overlay-*` variables in future work.
- **[Desktop regression]** Any change to footer padding or panel height could shift desktop layout. → Mitigation: both changes are gated on `--shell-mobile-nav-height`, which is `0px` on desktop; verify desktop visually after implementation.
- **[Double-handling volume keys]** If both `ReviewSession` and a nested `ExtractScrollItem` were wired, the key could be handled twice. → Mitigation: only wire `ReviewSession` (B1); leave `ExtractScrollItem`'s listener as-is. The helper calls `stopPropagation`, so the first listener to receive the event wins.
- **[Conflicts with existing review shortcuts]** Volume keys (`VolumeUp`/`VolumeDown`) don't collide with `Space`, `1`–`4`, or `Cmd+…` bindings. → Mitigation: insertion order (volume handler first) guarantees no interference; verify rating keys still work.
- **[Setting default is `"none"`]** Users won't see volume scrolling until they enable it. → Acceptable: matches existing behavior on the 4 already-wired surfaces; the setting is documented and discoverable in Settings.
- **[Mode `page` semantics in review]** "Page" meaning "next/prev card" is a sensible mapping for review, but differs slightly from "page up/down in a document." → Mitigation: documented in the setting description; behavior is intuitive (volume down → next card).

## Migration Plan

None required. No data model, persistence, or API changes. The change is pure frontend (CSS classes + one keydown handler extension) and takes effect on next app load. Rollback is reverting the commit.

## Open Questions

- Exact z-index value for the raised modal (`1100` proposed) — confirm it clears any other overlay rendered by host pages (e.g. `ItemDetailsPopover`, command palette). Implementation should grep for `z-[1` values above `1000` before finalizing.
- Whether to also shrink the modal panel height by `--shell-mobile-nav-height` (A2 alternative) in addition to the footer padding — decide during implementation based on visual testing of whether the panel bottom clips.
