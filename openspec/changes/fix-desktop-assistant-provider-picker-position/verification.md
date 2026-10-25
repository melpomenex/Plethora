## Regression evidence

- Reproduced in the real `AssistantPanel` through `assistant-controls-harness.html?picker&width=420&theme=legal-pad` at 1280×720 in system Chromium.
- Before the fix: model trigger y=46..72; menu y=-146.5..272.5; picker content began at y=-133.5. The heading and initial choices were clipped above the window. Screenshot: `.playwright/provider-picker-before.png`.
- The new production-layout containment test failed with `Received: -133.5` for a minimum y of -1 before implementation. The former desktop harness used a separate explicit `top-9` wrapper and missed this case.
- After the fix, the representative 1280×720 right-panel menu spans y=80..499, below the model trigger and inside the panel. Screenshot: `.playwright/provider-picker-after.png`.

## Implementation

- A dedicated wrapper anchors the desktop menu below its model control, independently of the toolbar's mode buttons.
- `useAssistantModelMenuBounds` measures the visible panel/viewport intersection, converts viewport bounds into local units, constrains the menu's width/height, and refreshes on resize. Observers and listeners exist only while open and are released on close.
- Geometry transitions are disabled on the menu so resizing cannot interpolate it temporarily outside the panel. The existing entrance animation is retained.
- Active-row reveal changes the provider list's own scroll offset. Focus restoration uses `preventScroll`, preserving surrounding reader/page/panel positions.
- The mobile fixture retains the in-sheet list. Desktop browser coverage uses the actual production panel and includes a reader scroller with a nonzero initial offset.

## Automated validation

- Focused picker and observer-lifecycle tests: **25 passed across 3 files**.
- Broader AssistantPanel suites plus observer lifecycle: **108 passed across 16 files**, using `npx vitest run src/components/assistant/__tests__/AssistantPanel*.test.tsx src/components/assistant/__tests__/useAssistantModelMenuBounds.test.tsx`.
- **40 browser cases verified**: the combined run passed 39 cases; the remaining case passed a focused rerun after stabilizing screenshot capture as described below.
- `npx tsc --noEmit`: **passed**.
- `npx vite build`: **passed**. Existing build warnings about transcription circular chunks, browser-externalized Node modules in sql.js, and large chunks remain outside this change.
- `npm run bench:check`: **passed**, all **67 benchmark comparisons** and the bundle gate. Stale-baseline warnings indicate faster unrelated results; no baselines or budgets were changed.
- Fresh production bundle checked with `npm run check:bundle`: **passed**, entry 5 KB, one PDF worker, total 26.9 MB.
- `openspec validate fix-desktop-assistant-provider-picker-position --strict`: **passed**.
- `git diff --check`: **passed**.

### Browser coverage and environment

The final browser run covers the real desktop picker and adjacent Assistant controls: left/right panels, 320px/420px panel widths, 1280×720/1024×600 windows, 70%/100%/150% scaling, active providers near both ends, first/last row reachability, draft and scroll continuity, keyboard dismissal, and resizing while open (including a 900×360 window). It also includes the existing mobile partial/expanded, landscape, 200% text, source-menu, and mode-control cases.

The repository's pinned Playwright Chromium download was absent. Tests used the existing `/usr/bin/chromium` with a temporary Playwright configuration at `/tmp/plethora-picker-playwright.config.cjs`, preserving the repository config. Command:

```sh
npx playwright test assistant-model-picker.visual.spec.ts assistant-controls.visual.spec.ts --config /tmp/plethora-picker-playwright.config.cjs
```

The combined run's right-panel 420px / 1024×600 / 70% case passed its containment, row-reachability, and scroll-preservation assertions but timed out inside `page.screenshot`. Desktop capture now disables decorative animations. Its focused rerun passed, including dismissal and focus/draft checks:

```sh
npx playwright test assistant-model-picker.visual.spec.ts --config /tmp/plethora-picker-playwright.config.cjs --output .playwright/recheck --grep 'right 420px 1024x600 scale 0.7$'
```

Scale tests combine CSS scaling with a compensated fixture height so it models the available layout space instead of producing artificial page scrolling. These test coordinate conversion and constrained layout; they do not exercise the native WebView zoom API.

Native Windows/macOS/Linux WebView spot checks remain **pending**; no native application was launched or installed during this change. The screenshot report came from a desktop app, so platform verification is useful even though the production React/CSS regression is reproduced and covered in Chromium.

Local unit-test setup initially lacked the lockfile's `agent-base@7.1.4`; the exact locked package was restored under ignored `node_modules` without manifest or lockfile changes.

### Structural review

Ripwire reports unchanged public contracts for `AssistantPanel` and `AssistantModelPicker`, with no incompatible callers and no uncovered impacted symbols in the selected test gate. It selected the AssistantPanel suites that were run above. Its gate reports test execution as unknown because it cannot observe Vitest runs.

The quality report flags recent churn in the existing large `AssistantPanel` function, plus minor complexity/size growth. The churn finding is expected for a correction in the recently changed toolbar; it has not been suppressed or represented as a passing quality gate. The new geometry lifecycle is isolated in a small hook and covered by component and real-browser tests.
