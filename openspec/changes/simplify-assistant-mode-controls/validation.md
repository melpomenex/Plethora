# Implementation validation

Validated on 2026-10-22 against `40f871248`, preserving the unrelated transcription/session-dialog working-tree edits. No branch, commit, push, or archive was performed.

## Delivered behavior

- The header has one Chat / Learning Agent mode group. Chat's three existing grounding policies appear as a localized Answer from menu above the input, using the existing stored identifiers.
- Learning Agent displays its own explicit sources. Returning to Chat restores the previous answer source, draft, thread, attachments, and review artifacts. Selecting modes does not submit; active generation locks the choices.
- Source menus announce selected choices, support keyboard navigation and focus return, and close before their containing sheet on Escape/Back. Mobile source selection expands the partial stop, stays in the sheet, and temporarily hides the mounted input bar. Narrow/large-text layouts wrap the input onto its own row.
- Source labels and explanations are present in all six locales. AskSheet and Document Q&A share the same terminology and retain their source defaults/subsets.

## Checks

| Check | Result |
| --- | --- |
| `npx vitest run src/components/assistant/__tests__ src/components/tabs/__tests__/DocumentQATab.test.tsx src/components/md3/__tests__/primitives.test.tsx` | 23 files, 214 tests passed |
| Additional mobile host, viewer resize, and queue selection-Ask integration tests | 3 files, 15 tests passed |
| `npx playwright test src/visual/assistant-controls.visual.spec.ts` | 7 layouts passed |
| `npx tsc --noEmit` | Passed |
| ESLint on touched components, tests, locale files, and browser fixtures | No errors; existing AskSheet unused imports and French escape warnings remain outside changed lines |
| `npx vite build` | Passed |
| `node scripts/check-perf-budget.mjs` against the final full benchmark run | Passed: 67 comparisons |
| `node scripts/check-bundle-budget.mjs` | Passed: entry 5 KB, one PDF worker, total 26.8 MB |
| `openspec validate simplify-assistant-mode-controls --strict` | Passed |
| `git diff --check` | Passed |

The browser fixture renders the actual AssistantPanel, theme provider, source control, and sheet focus owner. Coverage includes a 420px sidebar, the actual 300px minimum sidebar, light/dark/legal-pad themes, mobile expanded and partial sheets, a simulated keyboard viewport, French copy, and 200% text. Checks assert menu containment, every source choice's reachability, draft retention, source restoration after agent mode, Back/Escape priority, no page-wide overflow, and usable input width. This is browser validation with a simulated keyboard viewport, not a physical-device keyboard run.

Screenshots are regenerated under `.playwright/results/assistant-controls/` by the browser suite, including `desktop-legal-pad-sources.png`, `desktop-min-dark-sources.png`, `mobile-partial-keyboard-sources.png`, and `mobile-french-200-sources.png` and corresponding agent views.

## Performance gate

`npm run bench:check` was run without baseline changes. Two initial complete benchmark runs finished, but the performance comparison failed before the chained bundle step. A final run after all other heavy work finished passed all 67 performance comparisons; its chained bundle check found that the production output directory was absent. Production output was rebuilt, then the same saved benchmark results and the fresh bundle were checked independently with the exact remaining gate commands. No tolerance or baseline was changed.

The second full run reported:

| Benchmark | Normalized cost | Limit |
| --- | ---: | ---: |
| `ankiImport/convert-2000-notes` | 2.450 | 2.189 |
| `reader-speech-index/build` | 5.267 | 5.263 |
| `reader-speech-index/locate` | 5.816 | 5.779 |

The first full run reported Anki conversion, speech-index build, and large static article import; the latter passed on the second run. `git diff --exit-code HEAD -- src/utils/ankiImport* src/utils/readerSpeechIndex* src/utils/articleImport src/test/bench-support.ts scripts/perf-baselines.json` confirmed those benchmark sources, implementations, inputs, and baselines have no changes. No runtime grounding/agent engine or benchmark implementation was changed for this UI fix.

An independent full benchmark run from an untouched `40f871248` source archive passed all 67 comparisons. Its normalized Anki/build/locate costs were 1.874 / 4.361 / 4.718, respectively, with runner calibration 1.691×. The final changed-checkout run passed all 67 comparisons, with costs 1.878 / 4.380 / 4.718 and calibration 1.734×. The near-identical results after removing concurrent heavy work support runner contention as the cause of the earlier failures. A subset-only comparison is insufficient because the budget script calibrates against the median of every baselined result and requires every baseline entry to be present.

## Structural review

Ripwire found no incompatible selector callers. The menu positioning hook was extracted from the existing menu to keep the new inline/radio support from increasing its structural complexity. The scoped menu quality delta reports zero regressions. The Assistant scope's remaining quality flags are two existing-symbol short-horizon churn signals and an untouched PWA close callback flagged by the scoped call graph; no new complexity or verbosity regression remains in the changed selector. The wider affected-test map is name-based and includes many unrelated UI consumers; the directly relevant Assistant suites, Q&A tests, menu primitives, and composed browser checks above were run.

## Specification reconciliation and archive order

The pending `unify-assistant-experience` delta's first `assistant-conversation-scopes` requirement now matches this focused change, including its original default/explicit-entry scenarios and new source presentation scenarios. This change can be archived independently after review; when the broader change is archived later, retain the additional mode/source/accessibility requirements merged by this change and the canonical strict Document grounding requirements. No broader routing, storage, sync, or implementation task was taken over.

Strict validation of the wider unification proposal also surfaced an existing issue in its untouched `library-qa` delta: it omits the canonical “Document scope grounds in the open document” scenario. That separate proposal must reconcile its library-Q&A requirement before archive. It does not block validation of this focused change.
