# Verification — fix-mobile-assistant-model-menu

Date: 2026-10-21
Environment: Linux x86_64, Node 26.8.1, Vitest, Playwright Chromium 1.62.1.
No iOS simulator or Android device was attached (`adb devices` returned an empty list); physical-device evidence is recorded as a gap below.

## Implementation reviewed

- `src/components/assistant/AssistantModelPicker.tsx`
  - Shared provider list/card used by desktop and mobile.
  - Provider rows are native buttons with provider + model + status accessible names, `aria-pressed` on configured providers, a visible active state, and a 48px minimum row height.
  - The mobile list is `flex-1 min-h-0 overflow-y-auto overscroll-contain`; the desktop list is bounded by `max-h` and scrolls.
  - Opening scrolls the selected engine into view. Mobile opening focuses the picker heading; Back registers at priority 70, Escape closes the picker, and closing restores focus to the model control unless that control is inside a hidden sheet.
- `src/components/assistant/AssistantPanel.tsx`
  - Mobile presents the picker as an in-flow sheet body below the compact header and hides the banner/conversation/composer with conditional classes, keeping them mounted.
  - Opening from the partial detent calls the existing `mobileSheet.onToggleDetent()`.
  - Desktop keeps the anchored `w-72` wrapper and uses the shared picker inside it.
  - Model-control trigger exposes `aria-haspopup`/`aria-expanded`; transient menus close with the mobile presentation.
- Locales: added `assistant.modelPicker.*` labels in `en`, `de`, `es`, `fr`, `ja`, and `zh`.
- Coverage: `src/components/assistant/__tests__/AssistantPanelMobileModelPicker.test.tsx`, `src/visual/assistantModelPickerHarness.tsx`, `public/assistant-model-picker-harness.html`, and `src/visual/assistant-model-picker.visual.spec.ts`.

## Focused unit/integration tests

Passed:

```text
npx vitest run src/components/assistant/__tests__/AssistantPanelMobileModelPicker.test.tsx
  Test Files  1 passed (1)
  Tests       10 passed (10)

npx vitest run src/components/assistant/__tests__/AssistantPanel*.test.tsx
  Test Files  15 passed (15)
  Tests       86 passed (86)

npx vitest run src/components/assistant/mobile/__tests__
  Test Files  8 passed (8)
  Tests       80 passed (80)
```

The focused suite covers the in-flow body presentation, partial-detent expansion, provider button names/statuses, selected-provider persistence, settings handoff without changing the active provider, Back closing only the picker, Escape dismissal, focus return, draft retention, closing with the mobile presentation, desktop staying anchored, and German picker labels.

### i18n completeness

`npx vitest run src/lib/i18n/__tests__/i18n-completeness.test.ts` has one failing case in this working tree: 77 unresolvable `recording.*` keys from the user's in-progress recording feature (`components/recording/*`). None of the failures are `assistant.modelPicker.*`. All locale-parity and placeholder cases pass. A direct check of the 13 new picker keys reports no missing values in any of the six locales.

## Real-browser containment and scroll checks

Passed:

```text
npx playwright test src/visual/assistant-model-picker.visual.spec.ts
  9 passed
```

Covered viewports: 320×568 (expanded and partial), 360×844, 390×844, 430×932, landscape 844×390, and 390×844 at 200% text. The short desktop pane is 360×500.

Each mobile case asserts that the picker, list, provider rows, and selected provider stay inside the sheet; no horizontal page scroll is introduced; the close and settings actions are visible; scrolling reaches the final provider; the final provider can be selected; and closing restores the reopen control. The desktop case asserts the anchored menu scrolls to the final provider in a short pane. Screenshots were written to `.playwright/results/assistant-model-picker-*.png`.

## Visual review

Phone and desktop screenshots were reviewed together. Active (green + gradient), disabled (muted), key-alert (red), and setup (amber) states remain distinguishable. The first review pass led to two corrections: small label text was raised from 8–10px to the 11–12px steps, and the picker now scrolls the active engine into view on open. A final semantics/ARIA cleanup followed; the unit suites and the visual suite were then rerun, and all counts above are from that final pass.

## Type check and lint

```text
npx tsc --noEmit -p tsconfig.json --incremental false
  passed (no output)

(The shared incremental cache reported a stale `GraphFilters.tsx` error while
another agent was editing the knowledge-graph files; forcing a fresh program
with `--incremental false` produced no errors.)

npx eslint <changed TS/TSX files>
  0 errors, 5 pre-existing warnings (fr.ts escapes at lines 634, 636, 674)
```

Impeccable detector:

```text
.agents/skills/impeccable/scripts/impeccable detect --json src/components/assistant/AssistantModelPicker.tsx src/components/assistant/AssistantPanel.tsx
```

Reported 7 advisories for the `0.6875rem` label-small step in `AssistantModelPicker.tsx` and 1 pre-existing `ai-color-palette` warning in `AssistantPanel.tsx` (line 985). The label-small size is the documented MATERIAL label-small value (`0.6875rem`); the detector does not recognize the arbitrary-value form. No blocking findings.

## Performance gate

```text
npm run bench:check
  14 failing benchmarks
```

All failures are in unrelated suites (precision scheduler, Anki import, audio edition, reader speech index, timeline, article import, tabs DOM, source-plan page context, assistant-video playback). No benchmark imports `AssistantPanel` or `AssistantModelPicker`; the two assistant benchmarks import only `routing`/`citationView`/`sourcePlan` and `videoContextPlanner`. The command therefore stopped before the bundle-budget step. No baselines or budgets were changed.

## Device evidence

No Android device was connected and no iOS simulator/device is available on this Linux host. The physical-device pass (partial/expanded open, scroll to the final provider, Back/Escape, collapse while open) remains an explicit gap for a follow-up on device. The Playwright viewport matrix and the 200% text case provide the available browser evidence.
