## 1. Extract shared studio components

- [x] 1.1 Create `src/components/review/studio/` and move `ContextControlPanel` (currently `FlashcardStudioModal.tsx` L1033) into `studio/ContextControlPanel.tsx` verbatim, exporting it and its props interface
- [x] 1.2 Move `DocumentSelector` (L2664) into `studio/DocumentSelector.tsx` verbatim, exporting it and its props interface
- [x] 1.3 Move `DeckSelector` (L2769) into `studio/DeckSelector.tsx` verbatim, exporting it and its props interface
- [x] 1.4 Import the three components back into `FlashcardStudioModal.tsx`; keep `normalizeContextSelection`, `DEFAULT_CONTEXT_SELECTION`, and the `ChatMessage` / `ContextSelection` / `DraftCard` exports resolvable from `FlashcardStudioModal.tsx` for existing importers (implemented as re-exports from `studio/contextSelection.ts` — moving them was required to avoid a runtime circular import, see design deviation note)
- [x] 1.5 Run `npx tsc --noEmit` and the existing Vitest suites (`FlashcardStudioContext`, `flashcardStudioSessions`, `flashcardStudioSessions.integration`) — all must pass with no edits to the test files

## 2. Chip model

- [x] 2.1 Define `StudioChip` (`{ id, icon, label, fullLabel, active, hidden }`) and `StudioSheet` (`"document" | "deck" | "images" | "context" | "views" | "provider"`) in `studio/studioChips.ts`
- [x] 2.2 Implement and export the pure `buildStudioChips(state) → StudioChip[]` taking selected document, deck, deck tags, image counts, context selection, token counts, and provider name
- [x] 2.3 Encode the visibility rules: hide the image chip when the registry is empty and nothing is selected; hide the deck-tag chip when the deck has no tags; render the document chip in an unset state when no document is selected
- [x] 2.4 Encode label rules: truncate to the chip's max width with an ellipsis while preserving the untruncated value in `fullLabel`; show the token count on the context chip; show the selected-image count on the image chip
- [x] 2.5 Write `studio/__tests__/studioChips.test.ts` covering unset document, long-title truncation, hidden image chip, hidden tag chip, non-default context marked `active`, and image count formatting

## 3. Bottom sheet infrastructure

- [x] 3.1 Change `MobileContextMenuSheet`'s content max-height to the `--app-viewport-height`-based expression (verified computing to 590.8px at 390x844), AND add a `variant="menu"|"content"` prop — `mobile.css` is unlayered, so its `.mobile-context-menu-items button` reset overrides Tailwind utilities and would flatten the Studio's primary buttons (see design deviation #2)
- [x] 3.2 Verify `CardContextMenu.tsx` and `DeckItemContextMenu.tsx` still render and dismiss correctly after the height change
- [x] 3.3 Add `const [activeSheet, setActiveSheet] = useState<StudioSheet | null>(null)` to `FlashcardStudioModal.tsx`, plus a `useEffect` resetting it to `null` when `isOpen` becomes false
- [x] 3.4 Add `if (activeSheet) return;` as the first line of the Studio's document-level Escape handler (`FlashcardStudioModal.tsx:3361`) so Escape closes only the sheet, not the Studio
- [x] 3.5 Build `studio/StudioSheets.tsx` rendering the sheet for the current `activeSheet` value, wrapping the moved `DocumentSelector`, `DeckSelector`, image actions, and `ContextControlPanel` as sheet bodies with their existing props and handlers

## 4. Mobile chip bar

- [x] 4.1 Add `const isMobileShell = useMobileShell()` to `FlashcardStudioModal.tsx` (first consumer of the presentation context in this file)
- [x] 4.2 Build `studio/StudioContextChipBar.tsx` rendering `buildStudioChips` output as a single non-wrapping horizontally scrollable row, each chip a button calling `setActiveSheet`
- [x] 4.3 Give each chip an accessible name containing `fullLabel`, and a minimum 44px touch target
- [x] 4.4 Branch the context bar (L4796–4880) on `isMobileShell`: render `StudioContextChipBar` on mobile, the existing inline bar on desktop — one branch, not duplicated hidden markup
- [x] 4.5 Branch the Context Control panel block (L4883–4911) so it renders inline only on desktop; on mobile it is reached through the context chip's sheet
- [x] 4.6 Hide the chip bar when `mobileActivePanel === "drafts"` so the draft list reclaims the space
- [x] 4.7 Preserve the existing document-change side effect (resetting `contextSelection` to `DEFAULT_CONTEXT_SELECTION`) when a document is chosen from the sheet

## 5. Header consolidation

- [x] 5.1 On mobile, collapse the header (L4660–4793) to a single row: icon + title, then right-aligned controls; drop the subtitle
- [x] 5.2 Replace the four-way view-mode segmented control with a `⋯` overflow button opening the `"views"` sheet listing Templates, Sessions, and Extracts with their existing count badges
- [x] 5.3 Move the `Chat | Draft Cards` toggle from its own band (L4914–4946) into the header as a compact segmented control, keeping the draft count badge; remove the band on mobile
- [x] 5.4 Reduce New Session to an icon-only `+` button in the header row, preserving its title/shortcut hint
- [x] 5.5 Move the provider selector into the chip bar as a provider chip opening the `"provider"` sheet; keep the NotebookLM notebook selection reachable as a dependent step in that sheet, and keep sending blocked until a notebook is chosen
- [x] 5.6 Confirm the desktop header renders exactly as before (segmented control, labeled New Session, inline provider select, close button)

## 6. Composer

- [x] 6.1 Set the composer textarea to `rows={2}` on mobile with auto-grow on input; keep `rows={3}` on desktop
- [x] 6.2 Render `CostEstimator` in a single-line variant on mobile
- [x] 6.3 Leave the existing `--shell-mobile-nav-height` bottom padding untouched (owned by the `mobile-ux-flashcards-and-volume-scroll` change)

## 7. Internationalization

- [x] 7.1 Add the new chip, sheet-title, and overflow-menu strings to `src/lib/i18n/locales/en.ts` under the existing `flashcardStudio.*` namespace
- [x] 7.2 Add the same keys to `de.ts`, `es.ts`, `fr.ts`, `ja.ts`, and `zh.ts`
- [x] 7.3 Verify no chip label is hardcoded English and that the longest translated label still truncates within its chip

## 8. Verification

- [x] 8.1 `npx tsc --noEmit` clean; full Vitest suite 1683 passed / 1 skipped (256 files)
- [x] 8.2 Desktop pass at 1280x800 verified in-browser: four-way segmented control (Chat/Templates/Sessions¹/Extracts), labeled "New session", inline provider `<select>`, subtitle, inline image buttons, inline Context Control, grid `782px 400px`; chip bar and sheets both absent
- [x] 8.3 Measured at 390x844: chrome 178px = **21.1%** (target ≤25%), message list 465px = **55.0%** (target ≥45%). Baseline was ~458px / 54% chrome and ~150px / 18% message list
- [x] 8.4 Document and deck sheets verified, including inline deck creation; confirmed the `Create deck` primary button keeps `rgb(228,75,111)` inside a sheet (it would be transparent under the `menu` variant). NOT exercised: image-occlusion disabled states — the dev instance has no images and no vision-capable provider configured
- [x] 8.5 Escape closes the sheet only (Studio stayed open, body scroll lock released) — the guard from design decision #3 confirmed working; tapping a second chip replaced the first (exactly 1 dialog in the DOM). Scrim tap not exercised (shares the same `onClose`)
- [ ] 8.6 PARTIAL: sheet content max-height computes to the viewport-bounded 590.8px at 390x844 (was an unbounded `70vh`). Actual on-screen-keyboard behavior still needs a real device
- [ ] 8.7 BLOCKED in this environment: `PresentationContext` recomputes via `requestAnimationFrame`, which never fires while the automation browser pane is hidden, so the shell cannot switch live under test. Both layouts verified independently after reload. Needs a real browser resize — see the spec note about this scenario
- [ ] 8.8 NOT VERIFIED: no tablet available in this environment
