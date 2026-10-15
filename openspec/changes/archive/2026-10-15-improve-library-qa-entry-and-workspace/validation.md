# Document Q&A workspace validation

Validated on 2026-10-15 against the working tree based on `8b95cb36a`.

## Delivered behavior

The command hub's bare library action closes the palette and requests the canonical Document Q&A tab without inserting or sending a question. Suggestions retain their full prompt and document identity. The mounted, active workspace acknowledges each request after session hydration; unsupported destinations use the existing platform fallback.

The workspace leads with a question and its source scope. Searchable source choices, editable starters, explicit web-search state, saved drafts, accessible history, recoverable errors, and supporting passages reuse the existing app and retrieval infrastructure. Ordinary document questions now use document-filtered grounded retrieval. Specialized section/chapter and learning-item workflows retain their existing paths.

## Automated checks

| Check | Result |
| --- | --- |
| Focused Vitest run | **180 tests passed across 11 suites** |
| TypeScript | `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` passed |
| Changed-file ESLint | Passed, zero errors; six existing warnings in unchanged French-string lines and the existing React import in `tabsStore.test.ts` |
| Production frontend | `NODE_OPTIONS=--max-old-space-size=8192 npx vite build` passed |
| Local performance gate | `npm run bench:check` passed; **53 benchmarks compared** |
| Final bundle recheck | `node scripts/check-bundle-budget.mjs` passed; entry 5 KB, one PDF worker, total 24.4 MB |
| OpenSpec | `openspec validate improve-library-qa-entry-and-workspace --strict` passed |
| Whitespace | `git diff --check` passed |
| Ripwire | Changed frontend files compared against Git HEAD: zero gating regressions; signature check for `saveSessions` reported no incompatible callers |

The benchmark run reports several existing baselines as stale because measurements are substantially faster than their recorded costs. No performance or bundle baseline was changed. Vite's existing large-chunk/browser-module warnings do not fail the build or bundle gate.

The scoped Ripwire review has minor existing-symbol changes and non-gating new-symbol findings for the cohesive history component/session hook, plus callbacks referenced through JSX. The larger Document Q&A component was reduced by extracting session and history ownership. A repository-wide scan also sees unrelated vendored Whisper findings, so the relevant review is scoped to the changed frontend files.

### Suite evidence

- `libraryAskHandoff.test.ts`: explicit open/prefill intent, coalesced bare entries, unique question requests, acknowledgement of the correct id.
- `CommandCenter.hub.test.tsx` and `LibraryAskHost.test.tsx`: the real tile closes the palette, remains navigable without generation setup or documents, requests Q&A exactly once, and honors platform fallback.
- `tabsStore.test.ts`: an existing Q&A tab in another split pane is reused and activated.
- `documentQaSessions.test.ts`: draft/reference/evidence round trips, old/malformed records, existing migration/caps, and failed storage writes.
- `DocumentQATab.test.tsx`: clean entry, suggestion prefill, Strict Mode, preserved and restored drafts, overlay dismissal/focus, touch focus behavior, an in-flight answer saved to its original session, selected-document retrieval, explicit retry without duplicate user turns, starter preparation, IME safety, empty-library import, and existing section/card workflows.
- `workspaceGrounding.test.ts`: collection/document filtering, AI exclusions, cloud restrictions on local-only content, empty/deleted source failure without broadening, configuration races, and original citation numbers after unused candidates are omitted.
- `DocumentQASources.test.tsx`: source navigation and unavailable-location fallbacks, legacy copy behavior, original citation numbers, and copy-with-sources.
- `GlobalSearchHub.test.tsx`: related-document, review, help/search, keyboard, and note workflows retain their existing routes.
- `SelectionActionsSheet.test.tsx`: the reader's selection Ask retains its separate workflow.
- `i18n-completeness.test.ts`: new strings are present in all six locales with matching placeholders.

The 3,000-document component scenario displays at most 60 source choices, searches to the intended document, and asserts zero full-document fetches, text extractions, or model/retrieval calls during entry/source browsing.

## Browser interaction and visual checks

`npx playwright test src/visual/document-qa.visual.spec.ts` passed. Its development-only fixture uses real workspace components and synthetic saved content; it does not call a live AI provider.

The bounded desktop/mobile inspection covered:

- Dark/gold desktop start, source picker, and expanded evidence; light desktop conversation.
- A 360px phone layout, history access/resume, and long source titles without horizontal page overflow.
- Escape dismissal and focus return from source selection.
- A cited passage opening the existing reader-navigation target.
- Empty-library and unavailable-source recovery states with editable questions retained.
- Reduced motion, a reduced-height focused composer simulating keyboard space, and 200% text scaling.

The initial fixture omitted the app's font bootstrap; the confirmation uses the same default system-sans setup as the app. The unavailable-source selector was subsequently given a concise label, keeping the full recovery message in the alert. Functional tests cover that recovery path.

Captures are in `.playwright/results/`:

- `qa-desktop-start-gold.png`
- `qa-desktop-sources.png`
- `qa-desktop-evidence.png`
- `qa-desktop-light.png`
- `qa-mobile-start.png`
- `qa-mobile-history.png`
- `qa-mobile-source-picker.png`
- `qa-mobile-keyboard-height.png`
- `qa-mobile-empty-library.png`
- `qa-mobile-source-error.png`
- `qa-zoom-200.png`

## Smoke flow and limits

The acceptance flow is covered across the integration suites and browser fixture: activate the library tile → close the palette and activate/reuse Q&A → choose a source → explicitly Ask → receive a grounded response with its original scope → inspect/open supporting passages → start or resume a conversation with the previous draft intact. Deferred response and retry cases use controlled retrieval results so races and failure paths are reproducible.

These are frontend/browser checks with simulated device/keyboard dimensions. Physical phones, native WebViews on other operating systems, and a live provider/indexing deployment were not exercised. The actual retrieval task, reader navigation, provider policy, session format, and specialized section/tool paths are reused rather than replaced.
