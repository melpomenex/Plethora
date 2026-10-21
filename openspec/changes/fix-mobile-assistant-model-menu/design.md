## Context

See `proposal.md` — Why for the reported failure. The current model menu is rendered inside the Assistant panel's compact header (`AssistantPanel.tsx:3507`) as an absolutely positioned `w-72` panel (`AssistantPanel.tsx:3671`). Its nearest clipping ancestor is the panel root, which is `overflow-hidden` (`AssistantPanel.tsx:3502`), and the mobile sheet at the partial detent is only about half the viewport tall. The menu has no maximum height and no scroll container, while the provider list contains OpenAI, Anthropic, Gemini, Ollama, OpenRouter, DeepSeek, and optionally Apple Foundation Models, each with model details and capability badges.

`AssistantPanel` is shared by desktop sidebars and the mobile host. Only the host passes `mobilePresentation`; the host owns the sheet detent, handle, close control, and keyboard/viewport sizing, and its conversation wrapper is also `overflow-hidden`. The existing composer menu (`MobileComposerMenu.tsx`) establishes the mobile precedent for a bounded, in-flow menu: it shrinks the conversation and scrolls internally instead of floating outside the sheet.

Constraints:

- The mobile sheet can be at `partial` or `expanded`, can change detent while a menu is open, and is laid out with dynamic viewport variables and a keyboard inset.
- The sheet's transform creates a containing block for `position: fixed` descendants, so a fixed menu rendered inside the sheet would still be clipped by the sheet; escaping it would require a body portal.
- The expanded sheet owns focus containment (`useDialogFocus`), so a portal outside the panel would not be reachable by Tab without additional focus-management work.
- Existing behavior to preserve: provider choice persists through `assistant-llm-provider`, unconfigured providers route to AI settings, the draft and conversation survive menus, and desktop keeps its anchored menu layout.
- The mobile capability requires 48 CSS-pixel targets on coarse pointers and localized labels in `en`, `de`, `es`, `fr`, `ja`, and `zh`.

## Goals / Non-Goals

**Goals:**

- Make every provider reachable and selectable on phones without clipping, off-screen drawing, or page scrolling.
- Keep the fix inside the Assistant sheet and its existing focus/overlay ownership.
- Unify desktop and mobile provider-card markup so state, labels, and semantics cannot drift.
- Add behavior and real-browser coverage that would fail against today's unbounded absolute menu.

**Non-Goals:**

- Redesigning the desktop Assistant header or its anchored menu.
- Changing provider routing, model capability detection, API-key storage, or AI settings.
- Adding a new dialog/sheet primitive, portal layer, or dependency.
- Reworking the sheet detents, gesture recognition, or keyboard-inset behavior.

## Decisions

### 1. Present the mobile picker as an in-sheet body view

On mobile, opening the model control renders the picker as an in-flow `flex-1 min-h-0` sibling below the compact header. While it is open, the context banner, conversation, and composer are hidden with conditional `hidden` classes (kept mounted), so the picker receives the remaining sheet body and owns a `flex-1 min-h-0 overflow-y-auto overscroll-contain` provider list. The header, source chip, expand/collapse control, and close control stay in place.

This makes containment structural: the picker cannot exceed the sheet because flex sizing allocates it the sheet's remaining height, and the list scrolls inside that box. It works at either detent and through detent changes without measuring the viewport, and it stays inside the expanded sheet's focus containment.

Alternatives considered:

- **Body-portal popover with viewport clamping (the `Menu` approach):** fixes clipping but floats over the reader, requires a second positioning system, and leaves focus containment for the expanded sheet. It also treats the picker as a transient menu even though it is the sheet's primary navigation choice.
- **Absolute menu with `max-height`/`overflow-y-auto`:** still clipped by the panel's `overflow-hidden`; sizing it against the viewport ignores the sheet detent and header height.
- **New modal bottom sheet over the Assistant sheet:** adds overlay-priority and focus-trap complexity for a choice that only needs the existing sheet body.

### 2. Expand a partial sheet when the picker opens

When the model control opens the picker while the sheet is at `partial`, call the existing `mobileSheet.onToggleDetent()` (guarded by `detent === "partial"`) to move to `expanded`. No new host contract is needed. If the user later collapses the sheet, the body view and list flex down and remain scrollable, satisfying the short-sheet case.

Alternative: keep the partial detent and let the list occupy only the ~two-row remainder; that technically scrolls but makes the primary picker tedious and hides most providers. Expanding is consistent with the sheet's existing user-controlled expand action.

### 3. Extract one provider list/card component for both presentations

Create `AssistantModelPicker` (and a `ProviderOption` card) under `src/components/assistant/`. It receives the derived provider metadata, configured-provider list, effective provider, status function, select handler, and settings handler. Desktop keeps its current absolute wrapper and header; mobile adds the picker header (`AI Engine Center`, settings gear, close) and uses the same card list. The list itself gets a `max-h`/scroll guard on desktop as a defensive bound; desktop layout otherwise stays unchanged.

Rationale: the existing card markup is ~90 lines in the middle of the panel. Duplicating it for mobile would let status badges, capability labels, and selection logic drift. Extraction also makes the card testable and lets the visual harness render the real component without booting the whole Assistant. On open, the list scrolls the active provider into view (`block: "nearest"`), so a short desktop menu or a long phone list cannot hide the currently selected engine.

### 4. Use native buttons with explicit selected state

Render each provider card as a `button type="button"` inside a labelled group. Its accessible name includes provider, configured model, and status; `aria-pressed` reflects the active provider. Not-configured rows remain buttons whose activation opens AI settings, with an accessible name that says setup is required. Active, disabled, key-alert, and setup badges stay visible. On coarse pointers the row supplies at least a 48px minimum height, and focus uses the existing `md-state`/primary ring convention.

Alternative: `role="radio"`/`aria-checked` for configured providers and separate buttons for setup rows. That produces mixed semantics in one list; `aria-pressed` keeps every row an ordinary button while still exposing which engine is active.

### 5. Own dismissal and focus inside the picker

While open, the picker registers an overlay dismissal at priority 70 (above the sheet's 60) so Back closes the picker first, and handles Escape locally. Opening focuses the picker heading or the first provider; closing by selection, close action, or dismissal restores focus to the model control. Hiding the conversation and composer uses classes rather than unmounting, so the draft, textarea state, attachments, messages, and scroll position remain intact.

The host's existing `useDialogFocus` continues to own sheet-level Back/Escape and focus containment; no host change is required. The `data-gesture-lock`/handle gesture and the list's `overscroll-contain` keep list scrolling from dragging the sheet.

### 6. Localize the picker labels

Add `assistant.modelPicker.*` keys for the title, close/settings action labels, statuses, active state, setup hint, and capability badges in all six locale files (reusing `llmProvider.*` keys where they already match). Brand names and model identifiers remain untranslated. This also removes the current hardcoded English from the shared desktop cards.

## Risks / Trade-offs

- **Auto-expansion surprises a user who deliberately chose the partial detent** → Only expand when the picker opens from `partial`; the existing collapse control and handle remain available, and the detent is otherwise unchanged.
- **Hiding the composer while the picker is open loses input focus or an in-progress IME composition** → Hide by class without unmounting, keep the draft in panel state, and restore focus to the model control on close; test draft retention.
- **A tall row or 200% text can make one provider taller than the picker** → The list is the scroll container, so an individual row can still scroll into view; the card uses wrapping rather than fixed-height text. The visual harness covers 200% text.
- **`hidden` as a Tailwind class could be overridden by a display utility** → Use conditional classes on the body containers rather than the `hidden` attribute, or use an explicit style; verify in the browser harness.
- **Desktop behavior changes indirectly through shared cards/localization** → Keep the desktop wrapper, anchor, width, and selection flow unchanged; the only shared changes are button semantics, localized labels, and a bounded scroll list.
- **Accessible names may become too verbose for provider rows** → Compose names from provider + model + status, leave capability badges decorative, and keep the setup instruction in the name only for unconfigured rows.
- **Visual harness maintenance** → Render the extracted picker in a fixed sheet shell with a deterministic provider fixture instead of booting stores and the full Assistant panel; keep the existing persistence test for the integration path.

## Migration Plan

No data or API migration. The change is a frontend presentation and semantics update with no persisted format changes; rollback is reverting the component extraction and picker rendering. Existing `assistant-llm-provider` persistence and AI settings handoff remain the only state contracts.

## Open Questions

None.
