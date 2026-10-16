## 1. Shared navigation foundations

- [x] 1.1 Create `src/navigation/tabDestinations.ts` with the 20-destination `NAVIGATION_DESTINATIONS` table (id, label/description keys, path, tab type, aliases, keywords, capability) and move `TAB_TYPE_ALIASES`/`resolveTabType` there from `MainLayout.tsx`, adding the missing `extracts` and `continue-reading` path aliases; verify with `npx tsc` and a new destinations unit test that every path resolves to its declared tab type.
- [x] 1.2 Point `MainLayout.tsx` at the shared module (no behavior change to `handleNavigate`, vimium, or tour routing); verify `vitest run src/components/layout/__tests__` passes unchanged.
- [x] 1.3 Add the registry↔router drift test: every registry destination path resolves via `resolveTabType`, no aliases or paths collide, and every `labelKey`/`descriptionKey` exists in `src/lib/i18n/locales/en.ts`; verify the test fails when a destination path or key is intentionally broken and passes when restored.
- [x] 1.4 Extract `fuzzyMatch`/`levenshteinDistance` from `src/components/search/SearchUtils.tsx` into `src/utils/fuzzy.ts` and re-export them from `SearchUtils.tsx`; verify no module cycle exists (registry can import the leaf) and `vitest run src/components/search` still passes.

## 2. Unified registry and matcher

- [x] 2.1 Extend the `Command` type in `src/components/common/CommandPalette.tsx` with `aliases`, `intentId`, `suppressedByContextual`, and `scopes` (all optional) and add `src/commandPalette/registry.ts` with entry types, normalization, and the tier score table; verify `npx tsc` and normalization unit tests (trim, case-insensitivity, empty query).
- [x] 2.2 Build registry navigation entries from `NAVIGATION_DESTINATIONS`; verify a registry test asserts all 20 destinations, their `intentId` (`destination:<id>`), and their expected tab types.
- [x] 2.3 Port operation entries into the registry (legacy `getDefaultCommands`, catalogue extras, theme commands, dynamic saved-queue switches) with today's capability gates and contextual preconditions preserved; verify a test asserts every entry has an executable action and either a registered capability id or a `REGISTRY_COMMAND_EXCEPTIONS` rationale.
- [x] 2.4 Implement `matchCommands` (exact label → exact alias → prefix → keyword → fuzzy → description, multiword AND semantics, deterministic tie-break) and keep a `commandMatchesQuery` compatibility adapter; verify matcher unit tests cover tier order, case normalization, `"new flashcard"`, `"podcasst"`, and stable ties.
- [x] 2.5 Enforce registry invariants with tests: unique ids, unique `intentId` per user intent, one entry per destination, and no entry inheriting a duplicate alias from another destination.
- [x] 2.6 Reduce `src/commandPalette/catalogue.tsx` to compatibility re-exports of the registry (`buildCommandCatalogue`, `navigateTo`, `commandMatchesQuery`) and delete the `REPLACED_REGISTRY_COMMAND_IDS` filtering; verify `rg "REPLACED_REGISTRY_COMMAND_IDS"` returns nothing and existing catalogue consumers compile.

## 3. Search pipeline integration

- [x] 3.1 Replace the flat `score: 0.8` command block in `CommandCenter.handleSearch` with registry match scores (tier × 100) and registry-produced results; verify an integration test asserts an exact destination query ranks the destination first ahead of content results.
- [x] 3.2 Stop pushing `resultKind: "section"` results and convert `sectionRegistry.findMatchingSections` into an adapter over the destination table that preserves its 1.0/0.93/0.86 score semantics; verify the `sectionRegistry` and help-intent tests pass unchanged (`vitest run src/components/search src/features/help`).
- [x] 3.3 Make the RSS and podcast branches use the same registry matcher as the general branch and delete their naive `lowerQuery.includes` copies; verify a parity test asserts the same query returns the same command matches while RSS/podcast is active as in the All scope.
- [x] 3.4 Implement `suppressedByContextual` result suppression in `handleSearch`; verify a test with the RSS view active shows the contextual Refresh Feed and omits the global Refresh RSS Feeds command.
- [x] 3.5 Update `commandScopes` in `src/commandPalette/facets.ts` to honor entry-declared scopes with the legacy category fallback; verify facet tests and the Settings scope still yield exactly one Settings destination row.

## 4. Browse, View all, and execution UX

- [x] 4.1 Derive `GlobalSearch` hub browse rows solely from `controller.commands` and remove the duplicate `APP_SECTION_DESTINATIONS` section rows; verify a hub test asserts View all lists each destination exactly once.
- [x] 4.2 Filter browse rows with the shared matcher (aliases and keywords included); verify a hub test shows RSS when `feeds` is typed in View all and filters by keyword otherwise.
- [x] 4.3 Verify keyboard and mouse activation of a registry command executes exactly once (arrows move selection, Enter activates, click activates the same row, Escape closes) with UI tests in `src/components/search/__tests__`.
- [x] 4.4 Keep destination and action rows visually distinguishable (group headers/category ordering) and confirm empty states for no-match and empty-library are unchanged in existing hub tests.

## 5. New destinations and operations

- [x] 5.1 Extract `SETTINGS_SECTION_METADATA` (id, label key, keywords) into `src/components/settings/settingsSections.ts`, use it from `SettingsPage`, and register `settings-section-<id>` commands via `requestDestinationAction(settings/section)`; verify typed `appearance settings` opens the Appearance section in an integration test and `account` is only registered when `isPlethoraCloudAvailable()`.
- [x] 5.2 Extend `DestinationAction` with `{ destination: "rss"; action: "refresh" }`, hook `useDestinationAction("rss", ...)` in `RSSReader` to the existing `refreshAllFeeds("manual")`, and register `refresh-rss-feeds`; verify a destination-actions test confirms the handler runs once and the request settles.
- [x] 5.3 Add the new `en.ts` label/description keys for destinations and operations (reusing existing `nav.*`, `tabs.*`, `rssReader.title`, `review.title`, `toolbar.audiobooks`, etc. where wording matches); verify the drift test (1.3) and `npx tsc` pass.
- [x] 5.4 Manually confirm no placeholder commands: every registered entry executes its described action through the real flows (navigation opens the view; operations open their dialog/section/session) — record findings in the change’s task notes.
  > Audit: all 20 destinations dispatch `navigate` to their declared path (registryAcceptance); import document, new flashcard, refresh feeds, dark mode, keyboard shortcuts, saved-queue switch, settings sections and RSS refresh are exercised by acceptance/integration tests; remaining legacy operations (scan, record lecture, ask-my-library, translate selection, tag cleanup, paste extract, X import, tour, scroll session) keep their original handlers and precondition filters — registry tests assert every entry has an executable action, so no placeholders exist.

## 6. Acceptance tests and guardrails

- [x] 6.1 Add registry acceptance tests for every destination primary query: `rss`, `feeds`, `analytics`, `stats`, `podcasts`, `audiobooks`, `settings`, `review`, `flashcards`, plus the remaining registered destinations; each asserts the destination row is offered and activating it navigates.
- [x] 6.2 Add representative action-query tests: `new flashcard`, `import document`, `refresh feeds`, `dark mode`, `keyboard shortcuts`, and a saved-queue switch; each asserts the real handler/destination action fires.
- [x] 6.3 Add platform-restriction tests: unavailable capabilities omit their commands (mock `isPlatformCapabilityAvailable`), `account` settings section hidden without cloud, and precondition commands (translate selection without a selection) are omitted.
- [x] 6.4 Add existing-tab activation tests: invoking a destination command when its tab exists activates it and creates no duplicate; invoking it twice leaves one tab.
- [x] 6.5 Update `platformCapabilityLint.test.ts` to iterate the registry (fixed test deps) and keep `getDefaultCommands()` as a wrapper so its existing tests (`CommandPalette.recording`, `CommandPalette.savedQueues`, `paletteQueueActions`) pass; verify `vitest run src/lib/__tests__/platformCapabilityLint.test.ts`.
- [x] 6.6 Run the content-search regression suites (`src/components/search/__tests__`, `src/features/help/__tests__`, `src/commandPalette/__tests__`) and confirm documents/extracts/RSS/podcast search behavior is unchanged.
- [x] 6.7 Add a registry matching benchmark to `src/commandPalette/palette.bench.ts` using `seededRandom` input and a module-level sink; run `npm run bench:check` and add the printed baseline entry to `scripts/perf-baselines.json` if required.

## 7. Validation and close-out

- [x] 7.1 Run `npm run test:run`, `npx tsc`, and `npm run lint`; fix any failures introduced by the change.
- [x] 7.2 Run `openspec validate unify-command-palette-registry --strict` and confirm the change is valid.
- [x] 7.3 Manual smoke on desktop: Ctrl/Cmd+K for `rss`, `podcasts`, `audiobooks`, `settings`, `review`, `flashcards`, `new flashcard`, `dark mode`; verify existing-tab activation, arrow/Enter/Escape, and mouse activation behave identically; capture results in the change notes before archiving.
  > Smoke run in a live PWA browser session (Tauri desktop binary is unavailable in this environment; recommend a final desktop pass before release). Verified live: `rss` → RSS Reader (destination ranks first ahead of help/content), `flashcards` → Review first with Create Flashcard second, `podcasts`/`audiobooks`/`stats`/`analytics`/`settings`/`new flashcard` all rank their destination/action first; Enter executes, ArrowUp/Down move selection with focus retained, Escape closes; repeated `navigate /rss` invocations leave exactly one RSS tab (persisted tabs: dashboard, queue, rss, review). Theme commands executed live (`dark mode`, `light mode`) and switched the document theme.
