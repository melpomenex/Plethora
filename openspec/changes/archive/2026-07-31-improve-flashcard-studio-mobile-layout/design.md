## Context

`FlashcardStudioModal.tsx` is a 5,666-line component that renders the entire AI Flashcard Studio. It has **no JavaScript-level awareness of the mobile shell** — every responsive decision is made with Tailwind `sm:` / `lg:` utility classes on a single shared render tree. That worked while the mobile form was "the desktop layout, narrower," but it is exactly why the mobile layout has degraded: each control band was authored for a wide row and simply wraps into 2–3 stacked rows on a phone.

Current mobile vertical budget, derived from the class stack on a 390×844 CSS-pixel viewport:

| Band | Source | ≈ Height |
|---|---|---|
| Header (title + subtitle, then a wrapped row of 4 view tabs + New Session + provider) | L4660–4793 | 170px |
| Context bar (document, deck, tags, AI occlude images, image library) | L4796–4880 | 158px |
| Context Control accordion | L4883–4911 | 84px |
| Chat / Draft Cards toggle | L4914–4946 | 46px |
| **Chrome subtotal** | | **≈458px (54%)** |
| Composer (3-row textarea + cost estimator + nav inset) | L5033–5082 | ≈236px |
| **Message list** | L4958–5030 | **≈150px (18%)** |

Relevant constraints:

- The modal renders inline at `z-[9990]`, not through a portal. `MobileContextMenuSheet` portals to `document.body` at `z-[9999]`, so sheets land above the Studio without any z-index work.
- The modal registers a **document-level** `keydown` handler for Escape (L3360) that closes the Studio.
- `DocumentSelector` (L2664), `DeckSelector` (L2769), and `ContextControlPanel` (L1033) are already fully prop-driven — they hold no ambient dependency on their position in the tree.
- The file already exports pure helpers (`normalizeContextSelection`, `DEFAULT_CONTEXT_SELECTION`) consumed by `flashcardStudioSessions.ts` and three Vitest suites, so exporting testable logic from it is an established pattern.
- The project's testing convention is Vitest for logic plus manual verification for UI.

## Goals / Non-Goals

**Goals:**

- Reduce mobile configuration chrome from ≈458px to ≤210px (25% of usable height), giving the message list ≥45%.
- Keep every desktop control reachable on mobile — this is a relocation, not a feature reduction.
- Make the Studio's configuration state readable at a glance without opening anything.
- Leave the desktop layout byte-for-byte equivalent in behavior.
- Add no new runtime dependencies.

**Non-Goals:**

- Refactoring the Studio's state management, provider integration, or card-generation logic.
- Redesigning the Draft Cards panel's internals (it only gains the space the chip bar frees).
- Changing the Context Control panel's own UI — it is relocated into a sheet, not rewritten.
- Fixing the modal's z-index/bottom-nav reachability, which the pending `mobile-ux-flashcards-and-volume-scroll` change owns separately.
- Tablet-specific layouts. Tablets follow the existing `lg` breakpoint decision made by `useMobileShell()`.

## Decisions

### 1. Branch on `useMobileShell()` in JS rather than duplicating markup at two breakpoints

The tempting approach — render both the chip bar and the inline bar, hiding one with `lg:hidden` / `hidden lg:flex` — is what the file already does for `mobileActivePanel`, and it does not scale here. The controls involved (`DocumentSelector`, `DeckSelector`, `ContextControlPanel`) each own internal open/search/draft state; mounting two instances means two independent states, and a user who filters the document list on one breakpoint sees a stale list after rotating. It also doubles the DOM for the heaviest part of the modal.

**Decision:** introduce `const isMobileShell = useMobileShell()` and branch once, rendering *either* the chip bar *or* the inline context bar. This makes the modal the first consumer of the app's presentation context, which is the correct direction of travel for the file.

*Alternative considered:* CSS-only `container-query` restyling of the existing bar. Rejected — the problem is that five controls need to become one row plus a sheet; no amount of restyling collapses a control into a summary chip.

### 2. One `activeSheet` discriminated union, not four booleans

The spec requires that opening a second chip replaces the first sheet. Four independent `isXOpen` booleans make that an invariant to maintain by hand at every call site.

**Decision:** `const [activeSheet, setActiveSheet] = useState<StudioSheet | null>(null)` where `type StudioSheet = "document" | "deck" | "images" | "context" | "views" | "provider"`. Mutual exclusion is then structural, and `activeSheet !== null` is the single signal the Escape guard needs (see #3).

### 3. Guard the Studio's Escape handler with an explicit layer check

`MobileContextMenuSheet` closes on Escape and calls `stopPropagation()`. Both its listener and the Studio's (L3360) are attached to `document` — and `stopPropagation` does **not** prevent sibling listeners on the same node from firing (that would require `stopImmediatePropagation`, and it would still be order-dependent on registration). Left alone, pressing Escape with a sheet open closes the sheet *and* the whole Studio, losing the conversation.

**Decision:** add an early return to the Studio's `handleKeyDown` — `if (activeSheet) return;` — before the existing `editingCardId` / `viewMode` / `onClose` ladder. An explicit ownership check is more robust than relying on listener ordering, and it extends the handler's existing layered-dismissal pattern rather than fighting it.

*Related:* the Studio's backdrop `onClick={onClose}` (L4645) is not a concern — sheets portal to `document.body`, so their clicks never bubble into the modal's tree. This preserves the behavior established by the `fix-flashcard-studio-click-outside-close` change.

### 4. Reuse `MobileContextMenuSheet`, and fix its height to be keyboard-aware

The shared sheet already provides scrim dismissal, Escape, body-scroll lock, safe-area padding, the drag handle, and a slide-up transition — all of the spec's dismissal requirements, and consistency with `CardContextMenu` and `DeckItemContextMenu`.

Its one gap: the content area is `max-h-[70vh]`. `vh` ignores the on-screen keyboard, so a sheet containing a text input (deck creation, context excerpt) can extend behind the keyboard. The app already solved this for `.mobile-more-sheet`, which uses `min(70vh, calc(var(--app-viewport-height, 100dvh) - ...))` fed by `useVisualViewport`.

**Decision:** change `MobileContextMenuSheet`'s content max-height to the same `--app-viewport-height`-based expression. This is a strict improvement for the two existing callers rather than a Studio-specific fork; blast radius is `CardContextMenu.tsx` and `DeckItemContextMenu.tsx`, both of which are short menus that never hit the cap today.

*Alternative considered:* a `contentClassName` prop so only the Studio opts in. Rejected — it preserves a latent bug for the other callers and adds API surface to avoid touching two files.

> **Deviation found during implementation.** Reusing the sheet as a drop-in was not sufficient. `src/styles/mobile.css` is imported from `main.tsx` **outside any cascade layer**, while Tailwind v4 (`@import "tailwindcss"`) emits utilities *inside* the `utilities` layer — and unlayered author styles beat layered ones regardless of specificity. So `.mobile-context-menu-items button { border: none; background: transparent; }` overrides **every** Tailwind background/border utility on any button inside a sheet. That reset is correct for menu rows and wrong for the Studio's pickers and primary actions, which would have rendered as flat transparent text.
>
> Resolution: `MobileContextMenuSheet` gains a `variant?: "menu" | "content"` prop. `menu` (the default) is byte-equivalent for the three existing callers; `content` swaps in a `.mobile-sheet-content` class that carries the same keyboard-aware max-height but none of the button reset. This is the API surface decision #4 set out to avoid, but the alternative was reimplementing the sheet. Verified in-browser: the `Create deck` primary button computes to `rgb(228, 75, 111)` inside a `content` sheet.

### 4b. Shared types moved out of the modal to break a circular import

`ContextControlPanel` calls `normalizeContextSelection`, which lived in `FlashcardStudioModal.tsx`. Extracting the panel while leaving the helper behind would make the modal import the panel and the panel import the modal — fine for erased types, but `normalizeContextSelection` and `DEFAULT_CONTEXT_SELECTION` are runtime values, and this project bundles everything into one chunk (`inlineDynamicImports: true`), where circular runtime imports are fragile.

**Decision:** `ContextMode`, `ContextSelection`, `DEFAULT_CONTEXT_SELECTION`, `normalizeContextSelection`, `CHARS_PER_TOKEN`, `estimateTokens`, and `formatTokenCount` move to `studio/contextSelection.ts`. `FlashcardStudioModal.tsx` **re-exports** the three public ones, so `flashcardStudioSessions.ts` and all three existing test suites compile untouched — verified, no test file was edited.

While there, `estimateContextTokens()` was added to the same module and is now called by *both* `ContextControlPanel` and the mobile context chip, so the chip's token figure and the sheet's summary line cannot drift apart.

### 5. Chip labels come from a pure, exported function

Manual UI testing is the project convention, but chip *content* — truncation, count formatting, unset states, which chips are hidden — is exactly the kind of logic that regresses silently and is cheap to pin down.

**Decision:** derive the chip model in an exported pure function, `buildStudioChips(state) → StudioChip[]`, where `StudioChip` carries `{ id, icon, label, fullLabel, active, hidden }`. It takes plain data (selected document, deck, tags, image counts, context selection, token counts) and returns the model the bar renders. Unit-tested in Vitest with no DOM, mirroring how `normalizeContextSelection` is already tested.

### 6. Extract the mobile presentation into `src/components/review/studio/`

`FlashcardStudioModal.tsx` is already past the point where adding several hundred lines is responsible.

**Decision:** create `src/components/review/studio/` and move `DocumentSelector`, `DeckSelector`, and `ContextControlPanel` there verbatim (they are prop-driven, so this is a pure move), alongside the new `StudioContextChipBar` and `StudioSheets`. `FlashcardStudioModal.tsx` re-exports nothing new for these; it imports them. The existing exported helpers (`normalizeContextSelection`, `DEFAULT_CONTEXT_SELECTION`, and the `ChatMessage` / `ContextSelection` / `DraftCard` types) stay in `FlashcardStudioModal.tsx` untouched so `flashcardStudioSessions.ts` and its three test suites keep compiling without edits.

### 7. Header composition on mobile

The header's two rows collapse into one: icon + `AI Flashcard Studio` (subtitle dropped), then, right-aligned, a compact `Chat | Drafts` segmented control, a `+` New Session icon button, a `⋯` overflow button, and `✕`. The provider name moves to the chip bar as a chip — it is configuration state, which is what the chip bar is for, and it keeps the header to four touch targets.

The `Chat / Draft Cards` toggle moving into the header is what removes the 46px band and its border entirely; the segmented control renders at ~32px inside the existing header row, so it costs nothing net.

### 8. Composer

`rows={3}` → `rows={2}` on mobile with auto-grow on input, and `CostEstimator` rendered in a single-line variant. This is ~60px returned to the message list. The existing `--shell-mobile-nav-height` bottom padding is unchanged — that is the other change's territory.

## Risks / Trade-offs

- **Configuration becomes one tap further away.** → Accepted deliberately: these controls are set once per session, while the conversation is used continuously. The chip bar keeps all state *visible* even though editing it requires a tap, so the user never loses awareness of what context will be sent.
- **Moving three components out of `FlashcardStudioModal.tsx` risks import churn.** → The move is verbatim and the components are prop-driven with no local closures over modal state. Nothing outside the modal imports them today (verified: only `ReviewHome.tsx` imports from the modal, and only `FlashcardStudioModal`). TypeScript strict mode catches any miss at build time.
- **Changing `MobileContextMenuSheet`'s max-height affects two other menus.** → Both are short item lists that never reach 70vh, so the new bound is inert for them; it only engages when the keyboard is up, where the current behavior is already wrong.
- **The Escape guard could strand a user if `activeSheet` is left stale.** → `activeSheet` is only ever set by a chip tap and cleared by the sheet's `onClose`, which the shared sheet always invokes on scrim tap, Escape, and dismissal. A `useEffect` resetting `activeSheet` to `null` when the modal closes removes the last path to a stale value.
- **Chip truncation can make two documents look identical** (e.g. two titles sharing a long prefix). → Chips carry the full value as their accessible name, and the sheet shows untruncated titles; the chip is a reminder, not the disambiguator.
- **The 45% / 25% viewport figures are asserted against a specific viewport.** → They are specified at 390×844 and verified manually there; they are design targets for a phone at rest, not runtime assertions, and small-height devices in landscape will not meet them. Landscape phones fall outside the guarantee by design.
- **Six locales need new strings.** → Missing translations fall back rather than crash, but shipping English chips into five other locales is a visible regression. All six locale files are updated in the same change.

## Migration Plan

No data migration, no persisted-state change, no version gate. The change is presentation-only and takes effect on next load.

Rollout is a single commit; rollback is a revert. The two shared-surface edits (`MobileContextMenuSheet` max-height, moving the three selector components) are the only parts touching code outside the mobile branch, and both are behavior-preserving on desktop.

Verification order: unit tests for `buildStudioChips` → desktop regression pass at `lg`+ (layout must be indistinguishable) → phone portrait pass covering each chip's sheet, the overflow menu, Escape layering, and keyboard-open sheet sizing → resize across the breakpoint with an active conversation to confirm state preservation.

## Open Questions

- Should the provider chip live in the chip bar (current decision, #7) or stay a header affordance? The spec only requires that the active provider be identifiable without interaction and changeable from that same affordance; both satisfy it. Worth a look on-device before settling.
- When NotebookLM is the selected provider, notebook selection is a second required choice. Folding it into the provider sheet as a dependent step is the assumption here; a separate chip is the alternative if that sheet feels overloaded.
- Whether the chip bar should also surface a "sections mentioned" count when `#{section}` mentions are active, or leave that entirely to the Context Control chip's token figure.
