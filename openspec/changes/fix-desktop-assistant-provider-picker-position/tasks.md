## 1. Reproduce the production positioning failure

- [x] 1.1 Update the desktop browser harness to render the real Assistant toolbar/menu positioning boundary with deterministic provider state rather than its separate `top-9` approximation. Verify a browser assertion for menu placement below the trigger fails against the current production layout and capture its bounds/screenshot.
- [x] 1.2 Add regression cases for left/right panels, 320px and 420px panel widths, 1280×720 and 1024×600 windows, wrapped toolbar controls, and supported desktop interface zoom levels. Verify the cases assert unclipped heading/management controls and containment within both panel and viewport, and record any environment limits.

## 2. Correct desktop menu anchoring and bounds

- [x] 2.1 Give the desktop trigger/menu a dedicated positioned wrapper, independent of the mode-control flex row, and explicitly anchor the menu below the trigger with the existing gap and panel-side alignment. Verify the failing production-layout browser case from 1.1 passes.
- [x] 2.2 Constrain the whole menu width and height to available visible panel space, keep its heading fixed, and let only the provider list scroll. Refresh available-space bounds while open on panel, toolbar, and viewport resizing; clean up observers/listeners on close. Verify browser cases reach the first and final provider, remain contained after resizing, and introduce no horizontal page overflow.
- [x] 2.3 Scope automatic active-provider reveal to the list's scroll offset and prevent focus restoration from scrolling ancestors where necessary. Verify an active row near either end becomes visible while document, reader, and panel scroll offsets remain unchanged through opening, list scrolling, and dismissal.

## 3. Preserve provider interaction and mobile behavior

- [x] 3.1 Extend focused component tests for configured-provider selection, unconfigured-provider/settings navigation, Escape and outside dismissal, focus restoration, and draft/conversation preservation. Verify with `npx vitest run src/components/assistant/__tests__/AssistantPanelMobileModelPicker.test.tsx src/components/assistant/__tests__/AssistantPanelProviderPersistence.test.tsx` and any new focused test file.
- [x] 3.2 Run the full picker browser matrix with `npx playwright test src/visual/assistant-model-picker.visual.spec.ts`, including the existing mobile partial/expanded, landscape, and enlarged-text cases. Verify actual row reachability and capture representative desktop before/after screenshots; record a native desktop WebView spot check or explicitly mark it pending if unavailable.

## 4. Complete integration validation

- [x] 4.1 Run `npx tsc --noEmit` and `npm run bench:check`; verify the implementation passes type checking and the required performance/bundle gates. Investigate failures and document any independently reproduced pre-existing failures without weakening budgets.
- [x] 4.2 Run `openspec validate fix-desktop-assistant-provider-picker-position --strict` and write verification evidence covering the regression reproduction, passing geometry checks, interaction checks, mobile preservation, and any remaining platform limits. Verify all implementation tasks reflect actual results before marking them complete.
