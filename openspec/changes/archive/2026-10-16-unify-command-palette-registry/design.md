# Design — Unified Command Palette Registry

## Context

See `proposal.md` — Why. The current palette assembles commands and destinations from four sources with different shapes and matching:

- `src/components/common/CommandPalette.tsx` — `Command` type, `CommandCategory`, `getDefaultCommands()` (legacy registry; partially filtered out by the catalogue).
- `src/commandPalette/catalogue.tsx` — `buildCommandCatalogue(deps)`, which re-lists navigation commands, theme commands, and extras while filtering `REPLACED_REGISTRY_COMMAND_IDS` from the legacy registry; `commandMatchesQuery` (substring-only, currently unused).
- `src/components/search/sectionRegistry.ts` — five app sections (`dashboard`, `documents`, `queue`, `analytics`, `settings`) with `findMatchingSections(query)` returning scores 1.0 / 0.93 / 0.86, consumed by `features/help/helpIntent.ts` and `CommandCenter`.
- `src/components/layout/MainLayout.tsx` — `TAB_TYPE_ALIASES` + `resolveTabType(input)` (module-private) mapping navigate-event paths to `TabType`, then `openTabByType` → `addTab` (tab reuse/activation in `tabsStore`).

`CommandCenter.handleSearch` (`src/components/search/CommandCenter.tsx`) has three separate command-matching paths: the general path (`matchesTerms` over extracted terms + `fuzzyMatch`), an RSS branch (`lowerQuery.includes` over label/description/keywords), and a podcast branch (same as RSS). Sections are pushed as separate `resultKind: "section"` results; commands get a flat score of `0.8` regardless of match tier, while sections score up to `1.0`, so an exact command label can rank below a weaker section or content match. `GlobalSearch`'s hub browse (`browseRows`) pushes both command rows and section rows for the same destinations, and filters with a plain `${title} ${description}` substring (no aliases/keywords).

Constraints that shape the approach:

- **Routing is already solved**: `navigate` CustomEvent → `resolveTabType` → `openTabByType` → `tabsStore.addTab` (which reuses existing tabs and activates them). The registry must use this, not a new router.
- **Destination actions are already solved**: `requestDestinationAction` (`src/commandPalette/destinationActions.ts`) delivers an action to a destination after navigation and settles once; settings sections, import, flashcard creation, and queue management use it.
- **Platform gates are already solved**: `capabilityId` + `filterCommandsByPlatformAvailability` + `resolveNearestAvailableTabType` fallbacks; the capability lint (`src/lib/__tests__/platformCapabilityLint.test.ts`) enforces gated-or-allowlisted definitions.
- **Matching must stay local-first**: no LLM/network for command matching; `fuzzyMatch` (Levenshtein) already exists in `src/components/search/SearchUtils.tsx`.
- **Performance gate**: `npm run bench:check` runs `src/**/*.bench.ts` against `scripts/perf-baselines.json`; `src/commandPalette/palette.bench.ts` already covers palette hot paths.
- **i18n fallback**: `t()` falls back to the `en` dictionary, then the key; new labels only need `en.ts` entries to render (other locales fall back to English until translated).

## Goals / Non-Goals

**Goals:**

- One typed registry that is the only place a palette destination or action is defined.
- One pure matcher with explicit tiers and deterministic ordering, shared by typed search, hub browse, and help-intent navigation.
- Comprehensive coverage of real destinations and supported operations, each verified to execute.
- Behavior preserved for contextual actions, help-forced searches, URL import, note composing, and content search.
- Durable guardrails: lint over the registry, alias/route drift tests, matching benchmarks.

**Non-Goals:**

- No new routing mechanism, no react-router/intent system, no panelized command UI redesign.
- No new destinations (each registered destination already exists as a view).
- No translation work beyond `en.ts` labels (fallback behavior is already defined).
- No changes to content-search providers (documents, extracts, RSS, podcasts, help).
- No global registration of view-scoped contextual actions (they stay view-scoped).

## Decisions

### D1 — Registry lives in `src/commandPalette/registry.ts` and produces `Command`-shaped entries

The registry exports:

- `CommandDefinition` entries built from the data tables below, with `id`, `label`, `description`, `icon`, `category`, `aliases`, `keywords`, `capabilityId?`, `precondition?`, `intentId`, `contextualEquivalents?: ViewActionId[]`, `scopes?: PaletteScope[]`, and `action`.
- `buildCommandRegistry(deps): Command[]` — the single assembly function (supersedes the assembly in `catalogue.tsx`), taking the same dependency bag the catalogue takes today (`translate`, theme state, `isWeb`, `selectedDocumentTitle`, saved queues).
- `matchCommands(commands, query): Array<{ command, tier, score }>` and `commandMatchesQuery` (compat).
- `REGISTRY_COMMAND_EXCEPTIONS` — reviewed allowlist used by the capability lint test.

`Command` (the existing UI type in `CommandPalette.tsx`) gains four optional fields: `aliases?: string[]`, `intentId?: string`, `suppressedByContextual?: ViewActionId[]`, and `scopes?: PaletteScope[]`; it reuses the existing `keywords`/`capabilityId`. `src/commandPalette/catalogue.tsx` shrinks to compatibility re-exports (`buildCommandCatalogue`, `navigateTo`, `commandMatchesQuery`) so external imports keep working; the deprecated `REPLACED_REGISTRY_COMMAND_IDS` filtering disappears because the registry owns each destination exactly once.

*Why not a second parallel type hierarchy:* `Command` already carries exactly the render/execute surface the palette uses; extending it avoids an adapter layer and keeps `GlobalSearch`/`PaletteBrowseList` untouched.

*Why not keep editing `catalogue.tsx` in place:* the catalogue's identity is "registry defaults minus replaced + extras"; the new module expresses "the registry" directly, and the file name documents the architectural intent.

### D2 — One canonical destination table, shared with path resolution

Add `src/navigation/tabDestinations.ts` exporting:

- `NAVIGATION_DESTINATIONS: NavigationDestination[]` — `{ id, labelKey, descriptionKey?, path, tabType, aliases, keywords, capabilityId? }` for the 20 destinations inventoried below.
- `TAB_TYPE_ALIASES` and `resolveTabType(input)` — moved from `MainLayout.tsx`, which imports them back. Two aliases are added so all destinations resolve: `extracts` → `extracts`, `continue-reading` → `continue-reading` (both were previously unreachable through the navigate event).

The registry derives its navigation entries from this table; `MainLayout.handleNavigate` uses the same `resolveTabType`. A drift test asserts, for every entry: `resolveTabType(pathWithoutSlash) === tabType`, label/description keys exist in `en.ts`, and no two entries share an alias or path.

*Alternative considered:* registry dispatching `openTabByType` directly — rejected (page component import, cycle, and it bypasses the event decoupling that tours/vimium/help all use).

### D3 — One matcher with explicit tiers; fuzzy extracted to a leaf module

Move `fuzzyMatch`/`levenshteinDistance` from `src/components/search/SearchUtils.tsx` into `src/utils/fuzzy.ts`; `SearchUtils.tsx` re-exports them for existing consumers. This avoids a module cycle (`SearchUtils` imports `GlobalSearch`, which imports `sectionRegistry` → registry).

Normalization: `toLowerCase().trim()`; empty query returns no scored matches.

Matching tiers (per token, then combined):

| Tier | Condition | Score |
| --- | --- | --- |
| `exact-label` | normalized query equals the entry label | 1.30 |
| `exact-alias` | equals a normalized alias | 1.25 |
| `prefix-label` | label starts with query | 1.12 |
| `prefix-alias` | an alias starts with query | 1.10 |
| `keyword` | a keyword contains the query token | 0.94 |
| `fuzzy` | `fuzzyMatch(label-or-alias, token, 2)` with score ≥ 0.6 | 0.90 |
| `description` | description contains the query token | 0.85 |

Multiword queries use AND semantics: every token must match at least one field of the entry; the entry score is the minimum token tier plus a small length bonus (capped below the next higher tier) so "new flashcard" matches Create Flashcard via `keyword(new)` + `label(flashcard)`. Single-token queries keep the highest tier. Ties break deterministically: tier score, then registry order (destinations before actions, then declaration order).

*Why tiers instead of raw substring scores:* the acceptance criterion ("exact destination name ranks first") needs a total order that cannot be overwhelmed by content-score noise; tiers are directly testable.

### D4 — Score mapping into the existing palette result space, with the documented exceptions

`CommandCenter` converts match tiers (multiplied by 100) into palette scores so ordering against content/help results is predictable:

- exact-label 1.30, exact-alias 1.25, prefix 1.12/1.10 → **above** every content result (content caps at 1.0), the direct-lookup guide (1.0), and Ask Plethora (0.99).
- keyword 0.94 / fuzzy 0.90 / description 0.85 → **below** contextual actions (0.95) so view-scoped actions keep priority when the user's query is action-like; they interleave with strong content matches, which is acceptable because they are weak matches.
- Contextual actions keep 0.95. Help-forced input (`?`, `help`) keeps its early-return path and is exempt. X/Twitter URL detection keeps its early return. URL import and note composing keep precedence.

This replaces the flat `score: 0.8` for commands and the `section` result rows.

### D5 — Deduplication by intent, not by string

Each entry declares `intentId` (`destination:rss`, `action:new-flashcard`, `theme:set-dark`, `settings-section:appearance`). The registry itself is the dedupe guarantee for destinations (one entry per intent; enforced by a registry test). At result assembly:

- Section results (`resultKind: "section"`) are removed; destinations are commands now. `sectionRegistry.ts` becomes an adapter over the destination table for `helpIntent`, preserving its 1.0/0.93/0.86 score semantics and its API shape.
- When the active view's contextual results include an action listed in an entry's `suppressedByContextual`, the registry command is dropped (for example `rss.refreshFeed` suppresses the global Refresh RSS Feeds command while RSS is active). This keeps "one row per intent" without coupling the registry to view internals.
- `ask-plethora`/guide/help rows are not deduplicated against destinations (they are different intents and are help-exempt).

### D6 — Execution mechanics reuse existing flows; no placeholder commands

- Navigation entries call `navigateTo(path)` → existing `navigate` handling → tab activation/reuse. No entry may point at an unresolvable path (drift test).
- Operation entries reuse what already exists: `requestDestinationAction` (import document, create flashcard, manage/new/select saved queue, settings sections), `startPaletteScrollSession`, theme store, UI-store dialogs (paste extract, X/Twitter import), and existing events (guided tour, shortcuts help). Entries whose platform capability is unavailable are filtered by `filterCommandsByPlatformAvailability` before display; contextual preconditions (translate selection requires a selection; record-lecture requires recorder availability; ask-my-library requires the `aiLibraryRag` flag; Scan Document requires a native scan surface) are evaluated in `buildCommandRegistry` exactly as the legacy registry does today, so the palette never advertises a dead end.
- New: extend `DestinationAction` with `{ destination: "rss"; action: "refresh" }`; `RSSReader` calls `useDestinationAction("rss", () => refreshAllFeeds("manual"))`, reusing the existing handler. Podcast refresh stays contextual (it requires a resolved feed/episode target — no honest global form exists), and this is recorded in the inventory as contextual-only.
- Settings sections: a light `src/components/settings/settingsSections.ts` exports `SETTINGS_SECTION_METADATA` (`id`, `labelKey`, `keywords`) for the 20 `SettingsTab` values; `SettingsPage` uses it to build its tab list (icons/descriptions stay in the page) and the registry generates `Settings: <section>` entries that `requestDestinationAction({ destination: "settings", action: "section" })`. `account` is only registered when `isPlethoraCloudAvailable()`. No importing `SettingsPage.tsx` from the palette (keeps the lazy chunk lazy).

### D7 — Browse, scopes, and View all read the same registry

- `GlobalSearch`'s `browseRows` derives rows from `controller.commands` only; the separate `APP_SECTION_DESTINATIONS` section-row pushes are deleted. Browse filtering uses `matchCommands` (aliases, keywords, tiers) instead of `${title} ${description}.includes`.
- `commandScopes(category, id, scopes?)` in `facets.ts` consults entry-declared `scopes` first and keeps the legacy category fallback for compatibility (saved-queue/test commands). Navigation entries declare `library`; settings/theme entries declare `settings`; actions declare `actions`; the Settings destination additionally declares `settings` so it is reachable inside the Settings scope without a duplicate section row.
- Group headers stay `CommandCategory`-based, preserving the current look.

### D8 — Capability lint covers the registry

`platformCapabilityLint.test.ts` iterates `buildCommandRegistry(deps)` (with a fixed test deps object) instead of `getDefaultCommands()`. Entries either carry a registered `capabilityId` or are listed in `REGISTRY_COMMAND_EXCEPTIONS` with rationale. `getDefaultCommands()` moves out of the hot path: it becomes a thin wrapper that returns legacy-shaped commands derived from the registry (kept for the three existing tests and the lint until they migrate).

### D9 — Tests and benchmarks are part of the change

- `registry.test.ts` — coverage of every destination and its primary alias (`rss`, `feeds`, `analytics`, `stats`, `podcasts`, `audiobooks`, `settings`, `review`, `flashcards`), uniqueness of ids/aliases/paths, registry↔router drift, capability filtering, no missing actions, compatibility exports.
- `commandMatching.test.ts` — tier order, case normalization, multiword AND, typo tolerance, deterministic ties, dedupe rules.
- `CommandCenter` integration tests — RSS/podcast view parity (same matches as All scope), section-dedupe, contextual suppression, content-search regression (existing documents/extracts tests must pass unchanged).
- `GlobalSearchHub` UI tests — View all shows one row per destination; typing an alias (e.g. `feeds`) filters to RSS; Enter executes the command once; empty state unchanged.
- `tabsStore`/navigation test — invoking the same destination command twice leaves one tab and re-activates it.
- `palette.bench.ts` — add a registry matching benchmark over the full registry with seeded multi-token queries; update `scripts/perf-baselines.json` if the new entry needs a baseline.

## Feature and Command Coverage Inventory

### Navigation destinations (all registered; label keys follow the project's existing i18n naming)

| Registry id | Label (en) | Path → tab type | Capability | Primary aliases / keywords |
| --- | --- | --- | --- | --- |
| `go-dashboard` | Dashboard | `/dashboard` → `dashboard` | `tab_dashboard` | home, overview, main |
| `go-continue-reading` | Continue Reading | `/continue-reading` → `continue-reading` | `core_read` | continue, resume, last read |
| `go-documents` | Documents | `/documents` → `documents` | `tab_documents` | library, docs, files, books |
| `go-queue` | Queue | `/queue` → `queue` | `tab_queue` | reading queue, todo, list |
| `go-scroll-mode` | Scroll Mode | `/scroll-mode` → `queue-scroll` | `core_read` | scroll, scroll queue, tiktok, incremental reading |
| `go-review` | Review | `/review` → `review` | `tab_review` | flashcards, cards, study, practice, review |
| `go-analytics` | Analytics | `/analytics` → `analytics` | `tab_analytics` | stats, statistics, progress, charts |
| `go-settings` | Settings | `/settings` → `settings` | `tab_settings` | preferences, prefs, config, options |
| `go-rss` | RSS | `/rss` → `rss` | `tab_rss` | rss reader, feeds, news feeds, subscriptions |
| `go-podcasts` | Podcasts | `/podcast` → `podcast` | `tab_podcast` | podcast, shows, episodes |
| `go-audiobooks` | Audiobooks | `/audiobook` → `audiobook` | `tab_audiobook` | audiobook, ab, narration |
| `go-newsletters` | Newsletters | `/newsletter` → `newsletter` | `tab_newsletter` | newsletter, news, email newsletters |
| `go-images` | Images | `/image-registry` → `image-registry` | `tab_image_registry` | image registry, screenshots, captures |
| `go-knowledge-sphere` | Knowledge Sphere | `/knowledge-sphere` → `knowledge-sphere` | `tab_knowledge_sphere` | sphere, graph, knowledge graph |
| `go-knowledge-network` | Knowledge Network | `/knowledge-network` → `knowledge-network` | `tab_knowledge_sphere` (same surface family) | network, connections, links |
| `go-doc-qa` | Document Q&A | `/doc-qa` → `doc-qa` | `tab_doc_qa` | qa, ask library, chat with documents |
| `go-notebooklm` | NotebookLM | `/notebooklm` → `notebooklm` | `tab_notebooklm` | notebook, nb, research notebook |
| `go-extracts` | Extracts | `/extracts` → `extracts` | `tab_extracts` | highlights, quotes, clippings |
| `go-import-needs-review` | Import Needs Review | `/needs-review` → `import-needs-review` | exception (existing flow surface) | needs review, browser imports, uncertain imports |
| `go-web-browser` | Web Browser | `/web-browser` → `web-browser` | exception (webview surface) | browser, web, url |

### Operations (executable actions)

| Registry id | Label (en) | Mechanism (existing) | Gate / precondition |
| --- | --- | --- | --- |
| `import-document` | Import Document… | `requestDestinationAction(documents/import)` | `core_import` |
| `scan-document` | Scan Document | native scan flow | `import_document_scan` |
| `ask-my-library` | Ask My Library | handoff store → `/doc-qa` | `features.aiLibraryRag` |
| `record-lecture` | Record Lecture | platform recorder / lecture host | recorder availability |
| `translate-selection` | Translate Selection | selection translation | active non-empty selection |
| `tag-untagged-documents` | Smart Tag Untagged Documents | smart-tagging queue | none (exception) |
| `cleanup-legacy-auto-tags` | Clean Up Legacy Auto-Tags | tag cleanup | none (exception) |
| `create-flashcard` | Create Flashcard | `requestDestinationAction(review/create-card)` | `core_remember` |
| `manage-saved-queues` | Manage Queues… | `requestDestinationAction(queue/manage)` | `tab_queue` |
| `new-saved-queue` | New Saved Queue… | `requestDestinationAction(queue/new)` | `tab_queue` |
| `switch-queue-<id>` | Switch Queue: `<name>` | `requestDestinationAction(queue/select)` | `tab_queue`; dynamic |
| `start-scroll-session` | Start Scroll Session | `startPaletteScrollSession` | `core_read` |
| `review-browser-imports` | Review Browser Imports | navigate `/needs-review` | none (exception) |
| `paste-extract` | Paste Extract from Clipboard… | UI-store dialog | `core_extract` |
| `import-twitter-video` | Import X/Twitter Video… | UI-store dialog | desktop (non-web) |
| `refresh-rss-feeds` | Refresh RSS Feeds | `requestDestinationAction(rss/refresh)` (new) | `tab_rss`; suppressed when `rss.refreshFeed` contextual is present |
| `theme-toggle-variant` | Toggle Light/Dark | theme store | none |
| `theme-set-light` / `theme-set-dark` | Switch to Light/Dark Theme | theme store | none |
| `theme-next` / `theme-previous` | Next/Previous Theme | theme store | none |
| `theme-switch-<id>` | Switch Theme: `<name>` | theme store | dynamic |
| `settings-section-<id>` | Settings: `<section>` (×20) | `requestDestinationAction(settings/section)` | visible sections; `account` requires cloud availability |
| `start-guided-tour` | Start Guided Tour | `tour-replay` event | none (exception) |
| `keyboard-shortcuts` | Keyboard Shortcuts | `show-shortcuts-help` event | none (exception) |

### Contextual-only actions (preserved; not globally registered)

Document viewer (`doc.*`), RSS (`rss.*`, including `rss.refreshFeed`), Podcast (`podcast.*`, including `podcast.refreshFeed`), Audiobook (`audiobook.*`). They remain view-scoped via `contextualActions.ts` / `paletteActionEvents.ts` and keep their 0.95 priority band (D4).

### Intentional exceptions and preserved non-command surfaces

- Help-forced searches (`?`, `/help`, `help:`), canonical direct-lookup guides, Ask Plethora, and help articles keep their dedicated paths and ranking exemptions.
- URL detection/import mode, X/Twitter thread detection, note composer, and view-all browse keep precedence in `GlobalSearch`.
- Content search (documents, extracts, transcripts, RSS articles, podcast episodes) is untouched and remains the fallback for non-command queries.
- Commands that cannot honestly execute are not registered (no placeholder entries); unsupported platform entries are filtered before display.

## Risks / Trade-offs

- **Result reordering surprises users who type weak queries** → the tier table is explicit; exact/alias/prefix only rank above content, keyword/fuzzy/description stay in the content band; contextual behavior is specified as an exception and covered by tests.
- **Registry/route drift** (a path added without a resolver or vice versa) → drift test in D2; `TAB_TYPE_ALIASES` is the single shared table.
- **Module cycles** (`SearchUtils` → `GlobalSearch`) → fuzzy extracted to `src/utils/fuzzy.ts` (D3) and `sectionRegistry` becomes a pure adapter.
- **Eager loading the Settings chunk from the palette** → settings sections come from a light metadata module, not `SettingsPage.tsx` (D6).
- **Ranking changes break existing tests that assert order or counts** → update them deliberately; `CommandCenter.hub`/`GlobalSearchHub` tests are extended rather than weakened; content-search regressions are a named acceptance criterion.
- **Benchmark gate** → new matching benchmark runs under `npm run bench:check`; if no baseline exists the script prints the JSON line to add, which the change includes.
- **i18n drift** → new label keys only exist in `en`; other locales fall back to English by design until translated.

## Migration Plan

1. Add `src/navigation/tabDestinations.ts` (destination table + moved aliases/resolver + `extracts`/`continue-reading` aliases); point `MainLayout` at it; add the drift test.
2. Add `src/utils/fuzzy.ts`; re-export from `SearchUtils`.
3. Add `src/commandPalette/registry.ts` (entries from the inventory, `buildCommandRegistry`, matcher, exceptions); turn `catalogue.tsx` into compatibility re-exports; extend the `Command` type.
4. Migrate `CommandCenter.handleSearch` to registry matches in all three branches; delete section-result pushes; keep the help/URL/Twitter exceptions; wire `suppressedByContextual`.
5. Migrate `GlobalSearch` hub browse to registry rows; delete section-row duplication; use the matcher for browse filtering; update `commandScopes` to honor entry scopes.
6. Add settings-section metadata + entries; extend `DestinationAction` with `rss/refresh` and hook `RSSReader`.
7. Update the capability lint to iterate the registry; keep `getDefaultCommands` as a wrapper; update existing tests that enumerate commands.
8. Add/extend unit, integration, and UI tests; add the matching benchmark and baseline entry.
9. Run `npm run test:run`, `npx tsc`, `npm run bench:check` (and `npm run docs:validate` if help metadata is touched).
10. `openspec validate unify-command-palette-registry` and `openspec archive` after implementation.

Rollback: the change is confined to the frontend and additive at the surface level (same palette UI, same navigation/tab state); reverting the commit restores the previous catalogue with no data migration or stored-state change.

## Open Questions

- **Analytics naming**: the tab title is "Statistics" while the route/destination name is "Analytics". This design uses "Analytics" as the palette label with `stats`/`statistics` aliases; renaming the tab title is deferred (no spec impact).
- **Saved-queue switch commands** currently materialize from store state at registry build time; if queues change while the palette is open, entries refresh on the next open (existing behavior, unchanged). A future change could subscribe live.
