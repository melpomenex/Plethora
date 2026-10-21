## 1. Shared provider picker

- [x] 1.1 Extract the current provider cards (`AssistantPanel.tsx:3691-3793`) into `src/components/assistant/AssistantModelPicker.tsx` with a shared provider-option card, status/capability badges, and the existing select/settings handlers; verify the desktop "AI Engine Center" still opens, lists every provider, and `npx vitest run src/components/assistant/__tests__/AssistantPanelProviderPersistence.test.tsx` passes.
- [x] 1.2 Convert provider rows from clickable `div`s to native buttons with accessible names (provider, configured model, status), `aria-pressed` for the active provider, visible focus, and a 48px coarse-pointer minimum; verify keyboard activation changes the provider and a setup row still opens AI settings without changing the active provider.
- [x] 1.3 Give the shared provider list a bounded scroll region and keep the desktop wrapper's anchored position, width, and layout otherwise unchanged; verify a short desktop viewport can scroll to the final provider and no selected provider is clipped.

## 2. Mobile in-sheet picker

- [x] 2.1 Render the picker on the mobile presentation as an in-flow `flex-1 min-h-0` body view below the compact header, with a `flex-1 min-h-0 overflow-y-auto overscroll-contain` provider list; hide the context banner, conversation, and composer with conditional classes while open so the picker owns the remaining sheet height. Verify in the browser harness that nothing extends outside the sheet.
- [x] 2.2 Expand a `partial` sheet to `expanded` through the existing `mobileSheet.onToggleDetent()` when the picker opens; verify a partial sheet expands on open, a user-collapsed sheet still shows a scrollable contained list, and desktop never enters this path.
- [x] 2.3 Add picker dismissal and focus ownership: register Back at priority 70 (above the sheet's 60), close on Escape, focus the picker/heading on open, restore focus to the model control on close, and preserve the draft and conversation. Verify with `requestOverlayBack` that the first Back closes only the picker and the second closes the sheet.
- [x] 2.4 Add `assistant.modelPicker.*` strings for the title, close/settings actions, statuses, active state, setup guidance, and capability badges in `en`, `de`, `es`, `fr`, `ja`, and `zh`, reusing existing `llmProvider.*` keys where they match; verify `npx vitest run src/lib/i18n/__tests__/i18n-completeness.test.ts` passes and a non-English render contains no hardcoded English picker labels.

## 3. Regression coverage

- [x] 3.1 Add `src/components/assistant/__tests__/AssistantPanelMobileModelPicker.test.tsx` covering open/close, the provider list container, selection of a configured provider, settings handoff for an unconfigured provider, Back priority, Escape, focus return, and draft retention; verify with `npx vitest run src/components/assistant/__tests__/AssistantPanelMobileModelPicker.test.tsx`.
- [x] 3.2 Add a `src/visual/assistantModelPickerHarness.tsx` and `assistant-model-picker.visual.spec.ts` that render the real picker in a fixed sheet shell with eight providers; verify containment, no horizontal page scroll, visible close/settings actions, and reachability/activation of the final provider at 320×568, 360×844, 390×844, 430×932, landscape 844×390, and text enlarged to 200%.
- [x] 3.3 Run the focused picker tests, all `AssistantPanel*` tests, and `npx playwright test src/visual/assistant-model-picker.visual.spec.ts`; record commands, browser/engine, and any device gaps in `verification.md`.

## 4. Integrated verification

- [x] 4.1 Review phone and desktop screenshots together, confirm active/disabled/key-alert/setup states remain distinguishable and the draft/conversation survive every dismissal path; fix observed defects in one batch and record a confirmation pass.
- [x] 4.2 Run ESLint on changed TypeScript/TSX files, the Impeccable detector on the changed UI targets, and `npm run bench:check`; record results and any pre-existing failures without changing unrelated budgets or benchmarks.
- [x] 4.3 Exercise the Assistant on an available iOS/Android WebView: open at partial and expanded, scroll to and select the final provider, use Back/Escape, and collapse the sheet while the picker is open; record engine/device evidence or the unavailable-device gap in `verification.md`.
