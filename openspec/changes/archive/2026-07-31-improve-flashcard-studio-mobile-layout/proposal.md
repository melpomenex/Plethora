## Why

On a phone, the AI Flashcard Studio spends roughly **55% of the viewport on chrome before a single message is visible**. Four full-width control bands stack above the conversation — the header (title + 4 view-mode tabs + New Session + provider select), the context bar (document selector, deck selector, deck tags, "AI occlude images", "Open image library"), the Context Control accordion, and the Chat/Draft Cards panel toggle. Measured against the current Tailwind class stack on an 844px-tall viewport that is ≈460px of chrome; with the composer (3-row textarea + cost estimator + bottom-nav inset ≈235px) consuming the rest, the message list is left with **~150px — under 20% of the screen**, or about two chat bubbles.

These controls are *configuration*, not *conversation*. They are set once at the start of a session and rarely touched again, yet they hold prime vertical real estate permanently. The result is that the Studio's primary surface — the chat — is the smallest thing on screen.

## What Changes

The Studio's mobile presentation is restructured around a **single context chip bar backed by a bottom sheet**. Desktop (`lg:` and up) keeps its current layout unchanged.

- **Collapse four control bands into one scrollable chip bar.** Document, deck, deck tags, selected images, and Context Control state each become a compact chip showing their *current value* (e.g. `📄 Neuroplasticity`, `📁 Deck`, `🖼 2`, `✂ 139 tok`). The bar is one row, horizontally scrollable, and never wraps.
- **Tapping a chip opens a bottom sheet** containing that control's full UI (document picker, deck picker + create, image library + AI occlusion, Context Control panel). The sheet reuses the existing `MobileContextMenuSheet` presentation — scrim-to-dismiss, Escape, body-scroll lock, safe-area padding — so behavior matches the rest of the app's mobile menus.
- **Move secondary view modes into an overflow menu.** The 4-way `Chat / Templates / Sessions / Extracts` segmented control collapses on mobile to a `⋯` button opening a sheet; `Chat` remains the default and is no longer a tab the user must find.
- **Merge the header's second row into the header's first row.** New Session (`+`) and the provider selector become icon-level affordances beside the close button; the provider's current name moves into the chip bar. The `Create, refine, and organize your learning cards` subtitle is dropped on mobile.
- **Chat/Draft Cards panel toggle becomes a compact segmented control** in the header row rather than a full-height 46px band with its own border.
- **Composer reclaims its own space**: the textarea starts at 2 rows on mobile (growing on input) and the cost estimator collapses to a single inline line.
- **Guarantee a floor for the conversation.** The message list is specified to receive at least 45% of the modal's usable height on a phone-sized viewport at rest.

No behavior, provider, generation, or persistence logic changes — every control keeps its existing handler, state, and semantics. This is a presentation-layer change to where those controls live on small screens.

## Capabilities

### New Capabilities
- `flashcard-studio-mobile-controls`: Consolidated mobile presentation of the AI Flashcard Studio's configuration controls — a single-row context chip bar summarizing current state, bottom sheets for editing each control, an overflow menu for secondary view modes, and a guaranteed minimum share of the viewport for the conversation. Covers chip labeling/truncation, sheet open/dismiss behavior, parity with the desktop control set, and the desktop layout remaining unchanged.

### Modified Capabilities
<!-- None. No existing spec in openspec/specs/ describes the Studio's mobile layout.
     The pending (unarchived) change `mobile-ux-flashcards-and-volume-scroll` proposes a
     `mobile-flashcard-studio-layout` capability, but it governs a distinct concern —
     z-index stacking above the bottom nav and footer safe-area padding so the primary
     action is *reachable*. This change governs vertical *density* and control placement.
     The two are complementary and touch different lines; neither invalidates the other. -->

## Impact

**Affected code:**
- `src/components/review/FlashcardStudioModal.tsx` (5,666 lines) — the entire change is scoped here plus new extracted components:
  - Header block (~L4660–4793) — collapse two rows to one; overflow menu for view modes.
  - Context Bar (~L4796–4880) — replaced on mobile by the chip bar; desktop markup retained behind `lg:`.
  - Context Control Panel wrapper (~L4883–4911) — moves into a sheet on mobile.
  - Mobile Panel Toggle (~L4914–4946) — becomes a compact segmented control in the header.
  - Composer (~L5033–5082) — mobile row count + inline cost estimator.
  - Existing in-file components reused as sheet bodies without modification: `ContextControlPanel` (L1033), `DocumentSelector` (L2664), `DeckSelector` (L2769).
  - Existing state reused: `mobileActivePanel` (L2969), `viewMode`, `contextSelection`, `selectedImageAssetIds`.

**Reused infrastructure (no new dependencies):**
- `src/components/common/MobileContextMenuSheet.tsx` — bottom-sheet presentation, scrim dismissal, scroll lock.
- `src/hooks/useMobileShell.ts` — the modal currently has **no** JS-level mobile awareness (it branches purely on Tailwind `sm:`/`lg:` classes); this change introduces `useMobileShell()` so sheet-vs-inline rendering is decided in one place rather than by duplicating markup at two breakpoints.
- `src/index.css` — `--shell-mobile-nav-height` (L662, L685) and safe-area vars, already consumed by the composer.
- `src/hooks/useVisualViewport.ts` — `--app-keyboard-height` for keyboard-aware sheet sizing.

**i18n:** New chip and sheet labels must be added to all six locales — `src/lib/i18n/locales/{en,de,es,fr,ja,zh}.ts` under the existing `flashcardStudio.*` namespace.

**Not affected:** Rust/Tauri backend, database, sync, AI provider integration, card generation, and the desktop (`lg:`) layout. No migrations, no new packages, no breaking changes.

**Testing:** Vitest coverage for chip label derivation and truncation; manual verification on a phone-sized viewport (portrait and landscape) and on tablet at the `lg` boundary, per the project's manual-UI-testing convention.
