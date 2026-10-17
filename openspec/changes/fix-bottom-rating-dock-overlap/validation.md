## Implementation verification — 2026-10-17

Validation base commit: `70915a122` on `main`.

### Functional checks

- `npx vitest run src/components/mobile/__tests__/BottomControlsGeometry.test.tsx src/components/mobile/__tests__/MobileLayoutWrapper.back.test.tsx src/components/queue/__tests__/ScrollOverlayControls.test.tsx src/themes/__tests__/ratingColors.test.ts src/themes/__tests__/materialRoles.test.ts src/components/md3/__tests__/primitives.test.tsx src/components/assistant/mobile/__tests__ src/components/viewer/__tests__/DocumentViewer.ratingOrbsGating.test.tsx src/lib/feedback/__tests__/orchestrator.test.ts`: **191 tests passed, 16 files**. Includes drag-to-bottom persistence, no automatic layout haptic, visible-control geometry and cleanup, all built-in theme contrast pairs, queue-origin gating, and existing Assistant/feedback contracts.
- `npx tsc --noEmit`: **passed**.
- ESLint on all changed TypeScript/TSX files: **0 errors, 20 warnings**. All 20 warnings are pre-existing: running ESLint on the original `HEAD` versions reproduces five in `ScrollOverlayControls.tsx` and 15 in `DocumentViewer.tsx`.
- `NODE_OPTIONS=--max-old-space-size=8192 npx vite build`: **passed**.
- `node scripts/check-bundle-budget.mjs`: **passed** — entry 5 KB, one PDF worker, total 24.5 MB.
- `openspec validate fix-bottom-rating-dock-overlap --strict`: **passed**.
- `git diff --check`: **passed**.

### Browser checks and visual review

`src/visual/rating-orbs.visual.spec.ts`: **7 browser tests passed**. Run with `npx playwright test rating-orbs.visual.spec.ts --workers 1`; the verification run used a temporary config reusing the already-running Vite server on port 5199.

The development-only harness mounts the real rating overlay, theme provider, mobile Assistant host, shell viewport publisher, and geometry bridge over fixture reading content and a navigation stand-in. The inline appearance comparison uses the shared `RatingOrb` component; the real inline reader's queue-origin behavior is covered by the existing viewer tests. These checks do not require or claim a physical-device/native build.

Verified:

- 320px and 390px phones, short landscape, enlarged text and bubble/navigation sizes, safe bottom inset, hide/show transitions, initial bottom settings, and directional changes back to bottom.
- At least 8px clearance above the Assistant bubble; independently reachable rating, Assistant, drag and positioning targets. Touch targets are at least 44px.
- Assistant sheet blocks pointer and keyboard interaction with ratings; dismissal restores rating access and clearance.
- Desktop left/right/top/bottom placement, plus internally scrolling controls and a reachable placement menu in a 280px-high viewport.
- Live light (`milky-matcha`), dark (`obsidian-noir`), saturated (`biolume-abyss`) and monochrome/e-ink presentation. Orb text/icon contrast is at least 4.5:1; focus contrast is at least 3:1. Shared inline and dock Good colors match. Disabled controls remain disabled.

Screenshots were inspected in two bounded rounds. The first cold Vite compilation exceeded the initial 5-second readiness expectation on the 320px case; a 30-second startup allowance resolved that harness timing issue. The confirmation run passed all seven cases.

Generated screenshots (ignored development artifacts) include `.playwright/rating-phone-320.png`, `rating-phone-390.png`, `rating-landscape.png`, `rating-safe-area.png`, `rating-enlarged-text.png`, four `rating-desktop-*.png` views and four `rating-theme-*.png` views.

Impeccable detector: 17 advisory findings, no blocking findings. The one finding in new CSS was a fallback radius outside the documented scale; it was changed to the existing shape token with a documented `1.75rem` fallback. The remaining 16 advisories concern unchanged priority colors and text sizes elsewhere in the large reader/overlay files.

Ripwire quality delta has **0 gating findings**. It reports minor added complexity/lines and churn in existing integration points, plus false-positive dead-code rows for an event callback and a test DOM-rectangle method. Contract checks retain the Assistant host and theme application signatures; Tooltip gains an optional portal option with its existing behavior as the default. Static test-gate reach includes existing broadly shared UI paths; focused tests and browser checks exercise the changed seams.

### Performance gate exception

`npm run bench:check` completed its measurements but **exited 1** on three budget overruns. Its chained bundle check was run separately and passed.

| Benchmark | Working-copy normalized cost | Budget limit | Unchanged HEAD cost |
| --- | ---: | ---: | ---: |
| commandPalette/recent-selection-3000-docs | 0.196 | 0.1924 | 0.1539 |
| precision-scheduler/review-sequence | 18.3 | 17.37 | 15.55 |
| kp-timeline/build | 0.01406 | 0.01288 | 0.0105 |

A full comparison run used a clean `git archive HEAD` copy under `/tmp/plethora-rating-baseline`, sharing the same installed dependencies and benchmark configuration. That unchanged run also **exited 1**, with five different failures: Anki conversion, audio-edition recent passage, speech-index build/locate, and tab switching. The working-copy timeline build measurement reported ±40.63% relative margin of error; the HEAD measurement reported ±33.33%.

An esbuild import-map check of the three measured hot-path modules (`homeModel.ts`, `precisionScheduler.ts`, and `startupAnimation/timeline.ts`) found five bundled source inputs, all byte-identical to `HEAD`. This supports treating these gate results as environment/benchmark instability, rather than evidence that the rating UI changed those computations. The performance gate remains red; no performance or bundle baselines were modified.

Raw local logs: `/tmp/rating-orbs-tests.log`, `/tmp/rating-orbs-browser.log`, `/tmp/rating-orbs-tsc.log`, `/tmp/rating-orbs-lint.log`, `/tmp/rating-orbs-build.log`, `/tmp/rating-orbs-bench.log`, `/tmp/rating-orbs-baseline-bench.log`, and `/tmp/rating-orbs-benchmark-imports.json`.
