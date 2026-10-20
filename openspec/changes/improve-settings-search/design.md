## Context

See `proposal.md` for motivation and `specs/settings-search/spec.md` for the behavior contract.

- The active tab registry loads `src/components/settings/SettingsPage.tsx` (`src/components/tabs/TabRegistry.tsx:34`). Older change documents describing this component as unused are stale.
- Settings section ids, label keys, and keywords already live in the lightweight `settingsSections.ts` module shared with the Command Palette. Icons and descriptions are still page-local (`SettingsPage.tsx:293-355`).
- Current search compares a whole lowercased query with translation-key strings, keywords, and descriptions (`SettingsPage.tsx:480-494`). It has neither per-control entries nor target revelation. For example, Appearance has separate `font` and `size` keywords, while the actual Font Size row is at `SettingsPage.tsx:1441`.
- Panels are lazy-loaded behind Suspense (`SettingsPage.tsx:72-156`). Search must know what they contain before mounting them without importing panel components into the catalog.
- Section navigation uses an asynchronous in-app discard confirmation (`SettingsPage.tsx:496-526`). Compact Settings has a menu/content hierarchy, contextual native/system back, and a separate app-return control. These contracts already exist in `settings-return-navigation`.
- The Command Palette has tiered token matching in `src/commandPalette/registry.tsx:90-193`, but that module also imports icons, destinations, stores, and actions. The reusable edit-distance primitive is already isolated in `src/utils/fuzzy.ts`.
- Locale dictionaries are loaded dynamically with English fallback (`src/lib/i18n/index.ts`). Search must follow displayed localized text and dictionary readiness, rather than indexing translation keys.

## Goals / Non-Goals

**Goals:**

- Give a user who remembers a preference's wording or purpose a specific, recognizable result and a reliable arrival point.
- Make coverage explicit across the active Settings tree, including nested surfaces and runtime availability, without coupling search to panel loading.
- Preserve the incumbent Settings composition and Material design system: compact result rows in the navigation surface, existing content panels, theme tokens, visible focus, and accessible touch targets. This is an Operate surface.
- Keep matching deterministic, local, small, and independently testable.

**Non-Goals:**

- Reorganizing Settings categories, replacing its visual design, or editing preferences inline in results.
- Semantic/LLM search, arbitrary question answering, stored search history, analytics, or searching configuration values.
- Adding features merely because their names appear in a query. Reader-only preferences and planned controls are not Settings destinations.
- Adding individual-setting commands to the global Command Palette or changing its ranking. Its existing section metadata and ids remain compatible.

## Decisions

### 1. Use a typed, component-free catalog with an explicit coverage inventory

Add a Settings-owned catalog, for example `settingsSearchCatalog.ts`, importing section ids from `settingsSections.ts`. Each definition contains a stable id, result kind (`setting`, `group`, or `section`), section id, group path, label/description references, alias references, a target id, and availability requirements. Section entries derive from the existing section metadata. Do not duplicate the category list or import JSX, stores with side effects, panel modules, or Command Palette actions.

Resolve the catalog against a translation function and an explicit availability snapshot. Use the same text keys in the destination and its entry. Move participating hardcoded labels/descriptions to locale keys as needed so visible copy and search cannot diverge. Include English fallback text and shipped product names alongside localized aliases; do not load all six dictionaries just to search.

Inventory every currently reachable configurable row, meaningful group, nested tab, and configuration dialog. A configuration group represents a repeated editor template such as provider credentials; it does not create one catalog entry per user-created provider or model. Destructive operations can be discoverable as labeled groups, but their search destination is the configuration/confirmation entry point, never the destructive callback.

Maintain a section-by-section coverage fixture with source/control references, catalog ids, target ids, availability cases, and justified exclusions. The implementation work is not complete after indexing a handful of examples. Coverage tests compare rendered configurable targets with the catalog for representative platform/setup states; a fixture alone is insufficient because it could omit the same setting twice. Shared row/group wrappers accept a search id, and custom markup exposes equivalent target markers.

| Coverage area | Reachable sections to inventory |
| --- | --- |
| App and appearance | General, Appearance, Shortcuts, Notifications |
| Learning and reading | Language Learning, Learning, Smart Queues, Documents, RSS |
| AI and speech | AI, Audio Transcription, Text to Speech, Embeddings/indexing |
| Integrations and data | Integrations, Cloud Storage, Import/Export, Privacy |
| Guidance and account | Handbook, Help, Account when available; index section/group destinations and any actual configurable preferences |

Existing wrappers `SettingsRow` and `SettingsSection` can supply target markup; bespoke panels can use the same small target primitive without rewriting their layouts.

**Alternative:** DOM text scanning or registering entries only as panels mount. Both miss unopened panels, make coverage depend on navigation history, and risk indexing user-entered content. A static category-keyword expansion would still fail to take users to the control.

### 2. Match normalized fields with bounded typo tolerance

Add a pure matcher, for example `settingsSearch.ts`, consuming resolved definitions rather than UI objects. Precompute normalized searchable fields when the catalog, locale/dictionary readiness, or availability snapshot changes.

- Apply Unicode normalization, case normalization, trim/collapse whitespace, punctuation/hyphen boundaries, and Latin accent folding. Preserve non-Latin scripts; contiguous CJK label substrings must work without English-style segmentation. Keep raw localized text for display.
- Test exact normalized labels and explicit aliases first. Otherwise require every query token to match within a single entry's label, alias, description, or breadcrumb. An entry cannot borrow tokens from another result.
- Rank whole-label exact, whole-alias exact, label/alias prefix, direct token, bounded typo, then description-only matches. Score multiword queries by their weakest token tier, then prefer more direct label coverage over breadcrumb coverage. Break remaining ties by catalog order and stable id.
- Apply fuzzy matching to individual label/alias words, using `fuzzyMatch` from `src/utils/fuzzy.ts`. For query tokens of length 4–5 allow at most one edit; at length 6 or more allow at most two, with a minimum similarity of 0.7. Do not fuzz shorter tokens or entire long descriptions. A transposition such as `siez` to `size` counts as two Levenshtein edits, so include a bounded adjacent-transposition check to satisfy the accepted typo case without broadly relaxing short-word matching.
- Keep alias sets curated and small. Seed common language such as `bigger text`, `volume buttons`, `speech to text`, `tts`, `dark mode`, and `vibration` on real destinations. This is short-phrase search, not inferred intent from arbitrary sentences.
- Deduplicate by stable destination id. Separate controls with the same name keep separate ids and meaningful breadcrumbs.

Keep the matcher Settings-owned and reuse the leaf fuzzy helper. Importing `registry.tsx` would pull unrelated command behavior into the Settings bundle; extracting and changing the global matcher would unnecessarily enlarge this change's regression surface. The two experiences can share simple primitives while keeping their result contracts distinct.

### 3. Reveal targets through a Settings-scoped registration contract

Use a provider scoped to the rendered Settings instance/content pane. A target registration maps a stable target id to a reveal callback and a focusable named container. Its callback can select an existing nested tab, expand a group, or open an existing configuration dialog without changing persisted settings. Configuration dialogs use their normal overlay and focus management.

Result activation follows one guarded navigation path:

1. Recheck availability and apply the existing discard confirmation if the editing context would be left. Declining performs no navigation or revelation.
2. Capture the query, originating result id, and result-list scroll position. Set a monotonically identified pending target and select its section. On compact layouts show section content.
3. Wait for the selected panel's target resolver to register after Suspense. Group-level resolvers make nested tabs/dialogs reachable before their inner controls mount; await the child target once revealed.
4. Scroll the nearest owning Settings content scroller, or the opened dialog's own scroller, so the target is visible below its header. Apply token-based outline/marker emphasis and a small localized "Search match" label. Focus the named row/group with `tabIndex=-1`; do not autofocus a text input and summon the mobile keyboard.
5. Clear the pending request on completion, superseding navigation, back, clear-search, or unmount. Older callbacks must check request identity before changing nested selection, scrolling, or focus.

Use readiness callbacks instead of a fixed delay or unbounded DOM polling. A bounded deadline (five seconds after the selected panel commits, excluding an explicit setup/loading operation) produces a localized recovery notice rather than a false success. A real load error offers retry; a removed target returns to the retained results. Scope registrations and DOM queries to the owning instance, never a document-wide duplicate id.

**Alternative:** Global `querySelector` plus `setTimeout`. It races lazy panels, cannot reliably open nested content, and can focus the wrong Settings pane.

### 4. Keep search in the existing navigation surface

An empty or whitespace-only query shows normal categories. A nonblank query replaces the navigation list with one ranked list of settings, groups, and category results; there is no additional results page or modal. Rows show a localized primary label, compact category/group breadcrumb, and one descriptive line where it helps disambiguation. Category/group labels identify what will open. Do not truncate away the distinguishing breadcrumb on a phone.

Use a labeled search input, a named clear button, semantic buttons in a results list, and a polite result-count/no-results status. Standard Tab and Enter/Space navigation is sufficient; do not introduce custom combobox semantics or additional global keyboard shortcuts. Typing must not automatically navigate or move focus, including during IME composition. Clearing restores focus to the input and category navigation. No-results copy includes a clear action to browse all settings while leaving the query editable.

Maintain query, last activated result, and result-list scroll in the current Settings instance. Desktop results stay visible beside the panel. Compact hierarchical back restores that list and focus; visible, gesture, and system-back handlers must all use the existing Settings back path. Explicit app return still leaves Settings directly. Do not persist query state in localStorage or cross-tab global state.

Use existing Material primitives/tokens for focus, target emphasis, touch targets, and layout. The arrival marker includes shape/text as well as tone, uses no pulse, and uses instant scrolling for reduced motion and E-Ink.

**Alternative:** Filter the entire active panel in place. It would either miss other panels or require mounting the entire Settings tree and can remove context needed to understand a preference.

### 5. Share availability rules and keep setup discoverable

Catalog predicates consume the same product/platform capability results used by panel rendering. Reuse or lift the smallest existing availability predicate where necessary rather than copying independent conditions. Accountless mode excludes Account, hosted API/Webhooks, and Plethora Cloud sync entries while preserving independent third-party settings. Recheck predicates on activation and refresh the resolved catalog as relevant capability/setup state changes.

A temporarily disabled control with a recoverable prerequisite can resolve to its existing explanatory group. Provider-specific configuration can lead to the provider editor/setup surface without selecting or creating a provider. Target revelation never enables a toggle, invokes network tests, starts recording, downloads anything, or changes provider selection. Private field contents, endpoints, saved names, keys, and document contents do not enter the catalog or results.

**Alternative:** Treat every disabled control as unsupported. That hides the exact setup settings a user needs to recover. Advertising all possible platform controls instead creates dead-end results.

### 6. Verify completeness, navigation, and performance separately

Use a table-driven acceptance corpus with positive targets, ordering assertions, and negative matches. Representative cases are derived from inspected code, not remembered user failures:

| Query | Expected destination or distinction |
| --- | --- |
| `font size`, `bigger text`, `font siez` | Interface and EPUB font-size rows with distinct paths |
| `EPUB font size`, `size font EPUB` | EPUB row rather than an unrelated Appearance result |
| `volume buttons` | Appearance → Volume Rocker Scroll |
| `vibration` | General → haptic feedback |
| `speech to text`, `speech-to-text` | Audio Transcription configuration |
| `tts` | Text to Speech configuration |
| `dark mode` | Appearance → theme selection group |
| `backup` | Distinguishable available backup/data destinations |
| Current localized category/control names | Matching localized destination in each supported locale |
| Account/cloud terms with Cloud disabled | No hidden Account, hosted API, or Plethora Cloud sync destinations |
| Unrelated words or private field value | No fabricated or secret-value match |

Catalog tests check unique ids, valid sections, copy resolution, availability, and coverage. Integration tests exercise real target anchors and at least one nested surface, lazy readiness, superseded requests, discard cancellation, compact back restoration, duplicate Settings instances, and clear-search focus. Keep existing Settings navigation and Command Palette section tests passing.

Add a deterministic search benchmark over the real catalog and a seeded synthetic catalog of 1,000 entries. Use the repository's `seededRandom` helper, consume results through a sink, and return void. `npm run bench:check` and the bundle budget remain the gates. Add a documented baseline for the new benchmark; adjust existing baselines only for measured, justified intentional changes. Browser verification should show full-catalog results updating within 100 ms of input on the recorded representative device; this is a measured UX target, not a timing-sensitive unit test.

## Risks / Trade-offs

- **Catalog and UI drift** → Reuse translation keys and target ids, maintain the full coverage inventory, and test rendered configurable targets against catalog entries across availability states. Include search coverage in the implementation's contributor guidance.
- **Large initial coverage sweep** → Inventory first, then implement and verify by section family. Do not reduce the contract to a few flagship settings; document inactive/planned exclusions explicitly.
- **Fuzzy noise and ambiguous phrases** → Bound edits, require all tokens, prefer direct labels, and test both intended targets and unrelated results. Ambiguity such as "bigger text" can intentionally yield more than one clearly labeled destination.
- **Lazy or nested target races** → Use scoped readiness registration, request cancellation, and visible recovery. Test delayed mounting and user navigation during loading.
- **Locale loading and hardcoded labels** → Reuse displayed keys, localize indexed hardcoded copy, invalidate search when dictionaries become ready, and test non-Latin text plus a runtime language change.
- **Search making Settings expensive to open** → Keep definitions component-free, precompute normalized fields, preserve panel chunking, and run the search benchmark and bundle gate.
- **Existing panels differ in how they save edits** → Preserve their behavior and route result changes through current guards; do not reinterpret already persisted values as unsaved drafts or change autosave semantics.

## Migration Plan

1. Add the catalog, coverage inventory, pure matcher, and scoped target primitive while retaining existing section ids and stored settings.
2. Populate and anchor all reachable section families, including setup destinations and nested surfaces; keep the new result UI unexposed until coverage is complete.
3. Switch the existing search surface to the new results and guarded target navigation. Verify compact back, locale changes, availability, and accessibility before considering the change complete.
4. No storage or backend migration is required. Reverting the search integration restores category search; additional translation keys and inert target ids do not require data rollback.
