## Why

Ctrl/Cmd+K is Plethora's universal launcher, but typing the name of a real feature often fails to reach it. The palette currently assembles its searchable entries from four independent sources — the legacy registry in `src/components/common/CommandPalette.tsx`, the palette catalogue in `src/commandPalette/catalogue.tsx`, a five-entry section registry in `src/components/search/sectionRegistry.ts`, and per-view branches inside `CommandCenter.handleSearch` — each with different aliases, matching rules, and ranking. Destinations that clearly exist (RSS, Podcasts, Audiobooks, Newsletters, Knowledge Sphere, Knowledge Network, Document Q&A, settings sections) are not reachable by name at all, "rss" matches nothing that opens the RSS reader, exact destination matches can rank below document content, and the same destination can appear as two indistinguishable rows (for example a Settings section row next to a "Go to Settings" command).

## What Changes

- Introduce one authoritative, typed command registry (`src/commandPalette/registry.ts`) as the single source for searchable navigation destinations and actions: stable IDs, localized labels, descriptions, icons, categories, aliases, keywords, availability requirements, and executable actions. No palette surface keeps an independent copy of a destination.
- Add a canonical navigation destination table covering all real destinations — Dashboard, Continue Reading, Documents, Queue, Scroll Mode, Review, Analytics/Statistics, Settings, RSS, Podcasts, Audiobooks, Newsletters, Images, Knowledge Sphere, Knowledge Network, Document Q&A, NotebookLM, Extracts, Import Needs Review, Web Browser — plus supported operations: import document, create flashcard, paste extract, theme switching, settings sections, queue management, RSS refresh, scroll/study session starts, guided tour, and keyboard shortcuts. No placeholder commands.
- Reuse the existing navigation flow (`navigate` CustomEvent → path resolution → tab activation/reuse in `MainLayout`/`tabsStore`) and the existing destination-action handoff (`requestDestinationAction`). No new router and no second navigation path.
- Replace the inconsistent per-branch matching with one pure local matcher: case-insensitive, exact name, exact alias, prefix, keyword, fuzzy typo tolerance, and description matching, with multiword queries requiring every token to match. Record a deterministic relevance hierarchy (exact name → exact alias → prefix → keyword → fuzzy → description) so an exact destination query normally ranks that destination first, ahead of documents, help articles, and unrelated actions.
- Deduplicate equivalent commands and destination rows by destination identity; one row per user intent and scope.
- Preserve intentional exceptions: explicitly requested help searches (`?`, `help`), contextual "Actions in this view", URL import mode, note composition, and existing content search behavior.
- Route `sectionRegistry` and `getDefaultCommands` through the unified registry (kept only as compatibility adapters) and extend the capability lint to cover the new registry so every advertised entry is gated or explicitly allowlisted.
- Tests: registry unit tests for every destination and primary alias (`rss`, `feeds`, `analytics`, `stats`, `podcasts`, `audiobooks`, `settings`, `review`, `flashcards`, and representative actions), matcher tests for ranking/case/typos/multiword/dedupe, integration and UI tests for keyboard execution, existing-tab activation, platform restrictions, empty states, and content-search regressions, plus a matching benchmark.

## Capabilities

### New Capabilities

- `command-registry`: the single typed command/destination registry, its availability gates, and the deterministic matching, ranking, and deduplication rules shared by every palette surface.

### Modified Capabilities

- `command-palette-navigation`: destination coverage expands from five sections to all registered destinations and supported operations, and typed navigation guarantees activating an existing tab or creating the appropriate one through the established flow; the "app sections" requirements generalize to registered destinations.

## Impact

- Frontend (new): `src/commandPalette/registry.ts` (registry + destination table + matcher).
- Frontend (modified): `src/commandPalette/catalogue.tsx`, `src/components/common/CommandPalette.tsx` (compatibility adapter), `src/components/search/sectionRegistry.ts` (adapter over the registry), `src/components/search/CommandCenter.tsx` (one search pipeline, no per-view command copies), `src/components/search/GlobalSearch.tsx` (browse rows from the registry, no duplicate section rows), `src/components/layout/MainLayout.tsx` (shared path→tab resolution export), `src/features/help/helpIntent.ts` (matcher reuse, behavior preserved), `src/commandPalette/destinationActions.ts` + `src/components/media/RSSReader.tsx` (RSS refresh destination action), `src/lib/i18n/locales/en.ts` (labels for new destinations/actions).
- Tests/benchmarks: `src/commandPalette/__tests__`, `src/components/search/__tests__`, `src/lib/__tests__/platformCapabilityLint.test.ts`, `src/commandPalette/palette.bench.ts`, `scripts/perf-baselines.json` when the new benchmark has no baseline.
- No backend, API, or dependency changes. Search stays local-first, synchronous, and offline-capable; no LLM is used for command matching.
