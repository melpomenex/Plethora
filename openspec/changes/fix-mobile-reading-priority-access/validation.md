# Validation — mobile Reading Priority

Implemented in `ScrollOverlayControls.tsx`, with queue-item identity and localized
labels supplied by `QueueScrollPage.tsx`. The complete upper stack is measured by
the existing rating-dock hook. The shared dialog primitive's concurrent edits
were preserved.

## Behavior and layout

- Chromium Playwright: 19 priority/rating tests passed. Priority coverage includes
  320×740, 360×780, 390×844, 430×932, 844×390, 740×320, and 1440×1000.
- Assertions inspect actual button rectangles and `elementFromPoint` before
  opening priority, then click Details, reader modes, priority presets and ratings.
  All four dock positions clear the measured upper region.
- Injected nonzero safe top/left/right insets, 24px root text, long German preset
  and neural-review labels, light/dark themes and e-ink selected checkmarks.
- Real sheet focus containment, shell inertness, close button, backdrop and Escape
  dismissal preserve the reader's scroll offset and return focus to priority.
  Component tests exercise the shared system-Back dismissal stack.
- Chromium CDP synthesizes a horizontal touch drag on the native slider, followed
  by a vertical swipe starting on that slider in a short, internally scrolling
  sheet. Vertical cancellation restores the original preview and does not save.
  Mouse drag and repeated Home/End keyboard completion are also exercised. The
  final focused browser rerun passed all four interaction/desktop cases.
- Component tests cover presets, pending state, localized error and retry,
  pointer/touch/key/blur completion deduplication, cancelled pointer scrolling,
  document-to-extract and same-parent extract transitions, deferred save results,
  unsupported items, hidden overlay and unmount.
- Existing queue overlay activation and volume-rocker tests cover stationary taps,
  scroll movement, text selection, excluded interactive targets and configured
  volume-key navigation. Queue page integration verifies global shortcuts and
  idle hiding yield to modal ownership.

## Coverage limits

Browser evidence is headless Chromium with mouse, keyboard and synthesized touch;
it is not physical-device evidence. No physical Android/iOS device, Safari,
WebKitGTK, or OS-level Back gesture was exercised. System Back was tested through
`requestOverlayBack`, not through device hardware. Existing long-press behavior
was preserved and covered by existing classifiers/contracts; a physical long
press on the complete reader remains a device acceptance check.

Screenshots in `.playwright/priority-*.png` supplement the interaction assertions;
they are not the evidence for gesture correctness.

## Gates

- Focused overlay/queue/geometry/activation/volume tests: 60 passed, including cancelled-gesture and modal keyboard regressions.
- All queue-page integration suites: 47 passed before adding the additional modal
  ownership test; that new test passed in subsequent focused runs.
- TypeScript `npx tsc --noEmit`: passed.
- ESLint changed application files: zero errors; 12 existing warnings in disabled
  legacy overlay code, French translations and existing queue-page code.
- Impeccable detector: existing palette/typography/animation advisories; no new
  editor surface literals or unrelated visual cleanup introduced.
- Ripwire quality delta flagged the adaptive control complexity increase (12 to
  16) and existing unrelated working-tree findings. Saving/gesture state was
  separated from presentation; the remaining modal/presentation branches are
  retained and covered by behavior tests. Contract check found no incompatible
  callers.
- Strict OpenSpec validation and `git diff --check`: passed.
- Production Vite build and bundle budget: passed (entry 5 KB, one PDF worker,
  total 26.8 MB). No bundle or performance baseline changes.

## Benchmark limitation

`npm run bench:check` was run three times on the implementation tree. The first run reported four unrelated failures:
command-palette recent selection, Anki conversion, recent audio passage lookup,
and reader speech-index build. The idle rerun cleared those and instead reported
startup timeline desktop/phone sample sweeps (0.1997 vs limit 0.1901, and 0.112 vs
limit 0.1086). This variance does not establish a performance regression in the
priority editor; the gate remains red and is reported as such.

Saved HEAD benchmark evidence in `/tmp/plethora-reuse-head-bench.log` reproduces
Anki, audio passage and speech-index failures. The relevant saved source files
and baseline JSON were verified byte-for-byte against HEAD. Startup timeline
source, fixtures and benchmark config also match HEAD and were not edited by this
change. A fresh full HEAD run in `/tmp/priority-head-full.log` passed all 67
performance comparisons; its bundle check cannot run because that source-only
snapshot has no built `dist/`. A focused HEAD timeline run cannot establish the full gate because the
checker treats missing benchmark entries as failures; use full-suite comparisons.

The final implementation-tree run (`/tmp/priority-bench-final.log`) reported:

- `ankiImport/convert-2000-notes`: cost 2.309, limit 2.189.
- `passageScoring/normalize-1200-chars`: cost 0.2455, limit 0.2355.

Those source modules and their benchmark inputs are unchanged by this fix. The
full HEAD performance pass and shifting failures across runs support an
environment/timing explanation; they do not turn the failed gate into a pass.
The production bundle check was run independently and passed on the final code.
No intentional performance change or baseline relaxation is part of this fix.
