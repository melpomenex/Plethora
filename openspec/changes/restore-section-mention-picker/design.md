## Context

See `proposal.md` — Why for the user-visible problem. The constraints that shape the implementation:

- `SectionMentionPopup` is already shared by the Assistant, Document Q&A, and Flashcard Studio, so the fix belongs in that component plus a small host-side anchor, not in three bespoke popups.
- The regression is a containment bug, not a data bug: the popup renders `absolute bottom-full` (`src/components/common/SectionMentionPopup.tsx`), while its host composer became a scroll container — `[data-assistant-composer]` is `max-h-[65%] overflow-y-auto` (`src/components/assistant/AssistantPanel.tsx`) after the "Answer from" work, and `.qa-composer-wrap--empty` / `.qa-composer-wrap--conversation` are `overflow-y: auto` (`src/components/tabs/documentQaWorkspace.css`). `overflow` clips absolutely positioned descendants whose containing block is inside the clip, so the popup exists in the DOM but paints nowhere. jsdom does not implement ancestor clipping, which is why the existing `#` tests pass.
- The popup currently receives both `tree` and `flat` but ignores the tree (`tree: _tree`) and lists every node of `flat`; its expand chevron only toggles an arrow, never hides children. Keyboard selection is also computed separately in each host (`getFilteredAssistantSections` in the Assistant, an equivalent filter in Document Q&A and Studio) with scoring that can diverge from the popup's own ordering.
- `useDocumentSections` already produces the canonical `tree` / `flat` with `children`, `level`, `breadcrumb`, `content`, and `estimateTokens`, and both the Assistant and Document Q&A already memoize that hook. No new data source is needed.
- `filtered` is sliced to 100 before `useVirtual = filtered.length > 100`, so virtualization is currently unreachable.

## Goals / Non-Goals

**Goals:**

- Make the picker always visible and hit-testable regardless of which scroll/overflow containers the composer lives in, including the mobile Assistant sheet and the Studio dialog.
- Make a bare `#` a browsable document outline with true expand/collapse and token costs.
- Keep display order and keyboard selection order identical across every host by deriving them from one place.
- Keep the input focused throughout; keyboard and pointer both operate the picker.

**Non-Goals:**

- Changing section extraction, section resolution, token budgeting, or the submitted `#{…}` token format.
- Changing what a section-scoped request sends to the model (existing contracts already require section-only context).
- Adding new section sources (e.g. cross-document outlines) or changing `useDocumentSections`.
- Reworking the composer layout or the "Answer from" control.

## Decisions

### D1 — Portal the picker into `document.body` and position it from the input's visual rect

Render `SectionMentionPopup` through `createPortal(document.body)` with `position: fixed`, measured from the text input (new anchor ref passed by each host). A shared `useAnchoredFloatingLayer` hook computes:

- horizontal span: the input's left edge and width, clamped to the panel/sheet bounds and viewport with an 8 px gutter; width capped at 420 px and floored at 300 px (or the input width when narrower);
- vertical placement: bottom of the input top minus 8 px; if the available space above is under ~160 px, flip below the input;
- max height: `min(320px, available space − 8px)`, with the result list scrolling internally;
- z-index: `var(--md-z-menu)` (above `--md-z-dialog`, so the picker still works inside the Studio modal); the Studio overrides this to `9991` because its modal root is a fixed `9990` stacking context;
- updates from `ResizeObserver` on the input and panel, `window.resize`, and capture-phase `scroll`, writing `top/left/width/maxHeight` directly to the popup element rather than through React state (same pattern as `useAssistantModelMenuBounds`).

Why not restructure the composers to move overflow onto an inner wrapper? That requires per-surface DOM surgery, breaks Document Q&A's full-height centered empty state (where `bottom-full` on the composer would put the popup off-screen), and silently regresses if any future ancestor becomes scrollable. The portal is the only fix that is independent of the host's scroll topology; the existing measured-menu hooks prove the pattern works with the app's zoom and sheet behavior.

### D2 — One picker model, consumed by both rendering and keyboard handling

Extract `src/components/common/sectionPickerModel.ts` with pure functions and a `useSectionPicker` hook:

- `buildOutlineRows(tree, expandedIds)` — depth-first visible rows (`{node, depth, hasChildren, expanded}`), and `filterSectionRows(flat, query, selectionEntry)` — the current scoring, moved out of the component and hosts.
- `useSectionPicker({tree, flat, query, selectionEntry, open})` — owns `expandedIds` and `activeIndex`, returns `rows`, `activeRow`, `setActiveIndex`, `expandActive`, `collapseActive`, and an `activeDescendantId`.
- Hosts stop maintaining `sectionCursorIndex` and stop duplicating filter scoring; they call `nextActive()` / `selectActive()` from the hook in their textarea keydown handlers. The popup becomes presentational: it renders `rows`, highlights `activeIndex`, and calls `onSelect`, `onToggleExpand`, `onClearQuery`.

This is the only way to guarantee the Enter key selects the row the user sees. Alternative considered: keep host-local filtering and pass it into the popup — rejected because three copies already drift (the Assistant's scorer ignores the popup's selection-entry priority).

### D3 — Outline-first presentation, flat search only when filtering

With an empty query, rows come from `tree` roots only; a row with children shows a disclosure control and a "N subsections" indicator. Expanding inserts its children immediately below it; collapsing hides the whole descendant chain. Search (`#foo`) switches to `filterSectionRows`, which searches all depths by title/breadcrumb/content and keeps the live selection entry first; results stay capped at 100. The header shows the document title when available plus `top-level · total` counts; the footer states that selecting a section scopes the answer to that section alone and lists the key bindings. Initial expansion is none, so a book opens as its table of contents rather than a wall of headings.

### D4 — Selection and scope feedback stay host-owned

Token insertion, `selectedSectionNodes` / `selectedSections`, and send-time resolution stay exactly as they are. The hook only supplies the chosen node; each host inserts its existing token and card. The token badge uses `estimateTokens(node.content)` (already used by the card and popup); a node with no resolved content shows `-- tokens` rather than a fabricated estimate. The combined scope is the sum of the selected nodes' estimates, shown by the existing selected-section cards.

### D5 — Arm the index on `#`, not only on focus

The Assistant currently sets `sectionsArmed` only on textarea focus. Set it whenever `handleInputChange` finds a hash trigger (covering paste, dictation insertion, restored drafts, and programmatic input), and keep the existing loading/empty distinction. Non-document contexts (`extractId`, video, web, general) pass a specific `unavailableReason` so the picker explains the limitation; extracts get copy that points at opening the full document.

### D6 — Browser geometry test as the regression lock

Add a Playwright case using the existing harnesses (extended with a structured multi-heading fixture) that, after typing `#`:

1. asserts the listbox is visible and has a non-zero box;
2. asserts `document.elementFromPoint(centerX, centerY)` is inside the listbox (this fails when an ancestor clips it);
3. asserts the listbox rect lies within the assistant panel/sheet rect and the viewport;
4. runs at desktop panel width and mobile viewport, and repeats for Document Q&A.

Unit/integration tests cover outline rows, expansion, filter ordering, ARIA ids, token insertion, and section-only prompt context; they cannot replace the geometry check because jsdom has no layout.

## Risks / Trade-offs

- **[Portal stacking/regression inside dialogs and sheets]** → Use `--md-z-menu`, recompute on resize/detent changes, and verify the Studio dialog and mobile sheet explicitly in the Playwright pass; keep the popup in the React tree so events still bubble.
- **[Anchor drift while an ancestor scrolls]** → Listen to capture-phase scroll, `ResizeObserver`, and window resize; update styles directly to avoid re-render churn. Add the layout-change scenario to the browser test.
- **[Clicking a row blurs the textarea]** → `preventDefault()` on pointer-down for rows and disclosure controls, and refocus the input after selection (already the Assistant's behavior).
- **[Huge outlines become slow]** → Outline starts collapsed, rows are virtualized once the visible row count exceeds ~60, search results remain capped at 100, and scoring stays memoized. Fix the unreachable `useVirtual` condition while touching this code.
- **[Escape handled twice in the Studio dialog]** → The textarea keydown handles and consumes Escape before the dialog sees it; add a Studio keyboard test for the overlap.
- **[Accessibility drift between combobox and listbox semantics]** → Focus stays in the textarea; expose `role="listbox"`, `role="option"`, `aria-activedescendant`, and announce breadcrumb + token cost in each option. No pointer-only disclosure action.

## Migration Plan

No data or API migration. The change is a UI-layer replacement; reverting the picker component and host anchor wiring restores the previous (clipped) behavior without touching stored drafts or section tokens.

## Open Questions

None — the picker's placement, outline model, and scope messaging are fully determined by the specs.
