## Proposal validation

- `openspec validate add-assistant-context-actions --strict`: passed.
- `openspec status --change add-assistant-context-actions`: all four planning artifacts complete (proposal, specs, design, tasks).
- New planning/HTML files checked for presence and trailing whitespace: passed.
- Implementation tasks remain unchecked. No application source, package, runtime configuration, or performance baseline was changed.

## Illustrative concept verification

Concept: [Assistant actions](../../../.lavish/assistant-context-actions.html). Design authority: existing Plethora Material 3 roles and the Launch Purple theme in `DESIGN.md` and `src/themes/fallback.ts`.

Inspected the rendered phone and document-side desktop concepts in the in-app browser. Exercised More and its bounded grouped menu, explicit whole-document outline naming, hidden quiz answers and Show answer, and action access through the add control while an unsent draft exists. The simulated Explain action preserved the draft. Confirmed the mobile strip hides while its action menu is open. Saved a [preview screenshot](../../../.lavish/assistant-context-actions-preview.png).

The concept contains illustrative content and sends no AI requests. It demonstrates the interaction direction, not production grounding, provider behavior, adaptive sheet geometry, localization, card persistence, or the complete accessibility/device matrix. Those checks and `npm run bench:check` are implementation acceptance tasks in `tasks.md`; application tests and benchmarks were not run for this proposal-only change.

## Implementation validation — 2026-10-26

### Reconciled boundaries

The current tree already contains the completed `simplify-assistant-mode-controls` work: ordinary Chat and Learning Agent remain separate modes, and Chat/Document/Library remain answer scopes. This change adds targets without changing that hierarchy or the Learning Agent and selection Ask paths. The mobile composer capability delta replaces the canonical quick-action prohibition; synchronize it when this change is archived. The in-progress `unify-assistant-experience` work retains its existing conversation/provider pipeline.

Shared submission remains in `AssistantPanel.tsx` (`submitAssistantRequest`), with the synchronous flight guard before source loading. New pure catalog, target, and outcome contracts are in `src/features/assistant/contextActions/`; the source loader reads captured identities and uses the existing canonical text loader and token trimmer. `runAssistantTurn` enforces action scope/content/tools and bypasses ambient video planning and Library retrieval. Read actions have no write tools. Action card batches become individual writes, with captured document/deck association and per-card recovery.

The add menu remains in flow and owns Back at priority 70, above the sheet's 60. More opens that same menu at Actions. Menu height uses the remaining sheet height, and duplicate context chips/scope chrome are temporarily hidden while browsing. The mobile host drops optional action chrome before sacrificing the partial stop, with 96px for conversation and a 16px restoration hysteresis. Desktop More is anchored to its own control, including internal scrolling at large text.

### Automated and browser evidence

- Focused and existing Assistant, grounding, conversation, composer, card, quiz, and locale tests: 655 tests passed in 70 files before the final ephemeral-source coverage case; its follow-up result is recorded below.
- `npx tsc --noEmit`: passed.
- ESLint over changed Assistant, action model, mobile geometry, tests, and browser fixture files: passed.
- `npx vite build`: passed. Existing SQL.js browser-externalization and chunk-size advisories remain.
- `openspec validate add-assistant-context-actions --strict`: passed.
- `git diff --check`: passed.
- Browser action matrix covers 320/390/430px phones, partial/expanded sheets, short and landscape viewports, keyboard viewport, German 200% text, and 320/430/600px desktop panels. All 11 action scenarios and all 7 incumbent mode/source scenarios passed across the bounded matrix and focused geometry confirmations. The final checks scroll the last study action completely into view and verify menu containment, focus return, draft continuity, and zero inference merely from opening a catalog.
- Screenshots: `.playwright/results/assistant-context-actions/` and `.playwright/results/assistant-controls/`. Useful examples include `phone-320-partial-idle.png`, `phone-390-expanded-menu.png`, `phone-german-200-menu.png`, and `desktop-german-200-menu.png`.
- Mechanical Impeccable scan: no new control findings; two advisory 11px labels belong to the incumbent composer menu.
- Ripwire contract check: shared submit signature unchanged, three callers, zero incompatible sites. The scoped quality delta has no major complexity/verbosity regression after extracting source resolution and response parsing. It still reports historical churn in the panel/host and common Escape-handler duplication; those reports are not a clean quality-gate result.

### Environment and limits

The local dependency installation lacked lockfile-pinned `acorn-jsx@5.3.2` and Playwright Chromium. Restored/downloaded those test dependencies without editing package manifests or the lockfile. Visual fixtures use real UI with fake provider credentials and issue no inference requests. Native device behavior and live model quality were not exercised; target authority, consent routing, malformed quiz recovery, cancellation, and write recovery are tested deterministically.

Existing binary/sidecar changes and the user's illustrative mockup were preserved. No archive, Settings control, dependency declaration, or performance baseline change is part of this implementation.

### Final gate results

- Final target/dispatcher/orchestrator follow-up: **43/43 tests passed**, including ephemeral-source partial outlines and background-cancellation recovery. The preceding regression run passed **655 tests across 70 files**; the added ephemeral-source case was verified in this follow-up.
- Final production rebuild and bundle recheck: **passed** (entry 5 KB, one PDF worker, total 27.0 MB).
- `npm run bench:check`: **passed**, 67 benchmark comparisons. The gate emitted existing missing/stale-baseline warnings, with no regression failure. Rechecking the saved results against the final bundle also passed.
- Performance and bundle baselines, package manifests, and lockfile: **unchanged**.
- OpenSpec tasks: **20/20 complete**, ready for acceptance/archive. Implementation validation finished before the separately requested commit and push.
