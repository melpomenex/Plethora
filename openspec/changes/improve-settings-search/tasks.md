## 1. Establish complete coverage and acceptance cases

- [x] 1.1 Inventory the active Settings tree from `SettingsPage.tsx`, including nested tabs, configuration dialogs, product/platform gates, and inactive/planned exclusions; verify the delivered coverage fixture accounts for every section in `settingsSections.ts` with source references and expected destinations.
- [x] 1.2 Create a table-driven acceptance corpus for the design's representative queries, ambiguous matches, negative matches, and localized names; verify expected ids and paths point to real reachable controls/groups rather than invented preferences.

## 2. Build the catalog and local matcher

- [x] 2.1 Define typed setting/group/section entries with stable ids, target ids, copy references, aliases, paths, and availability predicates; derive section entries from shared metadata and verify unique ids, valid section references, and component-free imports in catalog tests.
- [x] 2.2 Resolve localized and English fallback searchable text using the same copy references as the UI; verify no raw translation keys are displayed and catalog rebuilding follows locale and asynchronous dictionary-readiness changes.
- [x] 2.3 Implement normalization, all-token matching across one entry, relevance tiers, direct-label tie preference, stable ordering, and deduplication; verify case/space/hyphen equivalence, reversed-word queries, exact-over-broad ordering, and unrelated-token exclusion with focused matcher tests.
- [x] 2.4 Reuse `src/utils/fuzzy.ts` for bounded word matching and add the minimal adjacent-transposition handling needed for short typos; verify `font siez` finds font-size controls while short tokens and unrelated words do not produce broad fuzzy matches.
- [x] 2.5 Reuse or lift existing product/platform/setup availability predicates for catalog resolution and activation; verify accountless suppression, unsupported-platform omission, third-party/local availability, and recoverable setup destinations in availability tests.

## 3. Provide precise and cancellable target navigation

- [x] 3.1 Add a Settings-instance-scoped target provider and row/group target primitive, integrating optional ids into `SettingsRow` and `SettingsSection`; verify real registered targets expose named focus containers and two Settings instances cannot resolve each other's targets.
- [x] 3.2 Add guarded result activation through the existing discard-confirmation path, with an identified pending request and lazy-panel readiness handoff; verify accepted navigation completes once, cancellation preserves edits and view state, and superseded requests cannot later change focus or selection.
- [x] 3.3 Support nested tab/group/dialog reveal callbacks without changing settings values; verify an actual nested destination opens before its target is focused and no provider selection, action submission, recording, or model download occurs.
- [x] 3.4 Add target scrolling, a token-based outline and localized arrival marker, bounded missing-target recovery, and cleanup; verify the target is visible below headers, reduced-motion/E-Ink arrival works, delayed loading succeeds, and failures provide retry or return-to-results recovery.

## 4. Populate and anchor app, appearance, and reading settings

- [x] 4.1 Register General settings and their current availability states, including language and haptic feedback; verify label/alias searches and target revelation for the rendered General controls, with `vibration` reaching haptic feedback.
- [x] 4.2 Register Appearance groups and controls, including theme selection, interface font size, Volume Rocker Scroll, and supported E-Ink options; verify `font size`, `bigger text`, `dark mode`, and `volume buttons` reach the appropriate live targets without indexing planned placeholders.
- [x] 4.3 Register keyboard shortcut and notification configuration targets; verify displayed labels and representative purpose aliases find each reachable group/control and unsupported notification controls stay omitted.
- [x] 4.4 Register Documents and RSS preferences, including EPUB typography and nested RSS queue configuration; verify `EPUB font size` and reversed-word variants reach the EPUB control and similar Appearance results have distinct paths.

## 5. Populate and anchor learning, AI, and speech settings

- [x] 5.1 Register Language Learning and Learning preferences, including conditional scheduler controls; verify every rendered configuration group/control maps to a searchable target across the supported scheduler/profile states.
- [x] 5.2 Register Smart Queues tuning and model/setup configuration; verify ranking, refresh, and model-related searches resolve to the appropriate available control or explanatory setup group without starting a download.
- [x] 5.3 Register AI provider, learning/summarization, memory, web search, MCP, and on-device configuration surfaces that are actually reachable; verify provider/credential searches reach real configuration groups and private values do not enter the catalog.
- [x] 5.4 Register Audio Transcription and Text to Speech preferences and their nested configuration surfaces; verify `speech to text`, `speech-to-text`, and `tts`, plus representative provider/voice settings, reveal the expected targets without changing provider selection.
- [x] 5.5 Register Embeddings and library-index configuration groups; verify model/index queries reach available setup or controls and correctly explain recoverable prerequisites.

## 6. Populate and anchor integrations, data, and guidance settings

- [x] 6.1 Register reachable Integrations and Cloud Storage configuration, including nested third-party integration controls; verify the catalog mirrors panel gates and excludes hosted API/Plethora Cloud sync controls in accountless mode.
- [x] 6.2 Register Import/Export and Privacy configuration groups and safe entry points for consequential actions; verify `backup` produces distinguishable available destinations and activating a search result never performs an export, restore, deletion, or reset.
- [x] 6.3 Register Handbook/Help section and meaningful group destinations, plus Account preferences only when available; verify visible guidance/settings destinations remain searchable and hidden account controls never leak into public results.
- [x] 6.4 Complete locale copy and curated aliases across all populated families, reusing the destination's translation keys and localizing indexed hardcoded labels; verify name-based discovery in all six supported locales, English fallback terms, CJK matching, and a runtime language switch.
- [x] 6.5 Complete coverage enforcement against rendered configurable controls and groups across representative platform/setup states, including nested surfaces; verify every such control has a catalog-backed target or a documented justified exclusion, rather than merely comparing two hand-maintained lists.

## 7. Integrate results and navigation continuity

- [x] 7.1 Replace category-only filtering with the resolved ranked results in the existing Settings navigation surface; verify labels, breadcrumbs, meaningful descriptions, category results, whitespace-only navigation, and no-result recovery on desktop and compact layouts.
- [x] 7.2 Add localized accessible names for search and clear controls, semantic keyboard-activatable results, polite result feedback, and visible focus; verify Tab/Enter/Space navigation, clear-search focus restoration, no focus movement while typing, and IME composition behavior.
- [x] 7.3 Preserve query, originating result id, and result-list scroll in each Settings instance; integrate restoration with the existing visible, gesture, and system-back path and verify compact back returns to the same results/focus while explicit app return retains its current destination behavior.
- [x] 7.4 Exercise result activation while editing, availability changes, loading failures, and rapid replacement navigation using the integrated UI; verify no stale scroll/focus, silent no-op, lost draft after cancellation, private-value result, persisted query history, or setting mutation from revelation.

## 8. Verify the integrated experience and performance

- [x] 8.1 Run the new catalog, matching, coverage, and target-navigation suites together with existing Settings return-navigation and Command Palette section/availability suites; verify they pass and record the exact commands and outcomes in the change's verification notes.
- [x] 8.2 Add a deterministic Settings search benchmark for the real catalog and 1,000 seeded synthetic entries using `seededRandom`, a consumed result sink, and void benchmark bodies; verify the benchmark is discovered and add its measured baseline to `scripts/perf-baselines.json` with the rationale recorded in verification notes.
- [x] 8.3 Run TypeScript checking, lint on changed source files, and `npm run bench:check`; verify matching performance and bundle budgets pass, panel chunks stay lazy, and any intentional baseline/budget adjustment is justified rather than masking a regression.
- [ ] 8.4 Inspect the integrated search on desktop and compact touch layouts, including long translated labels, no-results, target arrival, keyboard focus, reduced motion, and E-Ink; verify usable touch targets, readable distinguishing paths, and full-catalog response within the recorded 100 ms UX target on the measured device.
- [x] 8.5 Update contributor guidance with the catalog/target/coverage requirement for new settings and record the final acceptance matrix; verify every settings-search requirement has passing automated evidence or an explicit manual verification result, then run `openspec validate improve-settings-search --strict`.
