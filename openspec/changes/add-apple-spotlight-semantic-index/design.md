## Context

Binding planning: `openspec/planning/ios-on-device-ai-openspecs.md` (D-Apple-2, D-Apple-6, D-Apple-7, D-Apple-8). This change is **C** in that map. It extends `add-ondevice-ai-learning-system` (`specs/ai-semantic-index/spec.md`); it does not replace FTS or SQLite chunks.

Canonical data today:

| Store | Path / id |
|---|---|
| Documents | `documents.id` |
| Chunks | `semantic_chunks.id` (migration `085_ai_learning_system`) |
| Extracts | `extracts.id`; indexer source type `extract` (`SOURCE_TYPE_EXTRACT`) |
| Cards | `learning_items.id`; indexer source type `card` (`SOURCE_TYPE_CARD`) |
| Embeddings | `semantic_chunk_embeddings` (rebuildable; not required for Spotlight text donate) |
| Indexer | `src-tauri/src/ai_learning/indexer.rs` — load → chunk → content_hash diff → embed → per-chunk COMMIT → `ai_index_state` |
| Retrieve | `src-tauri/src/ai_learning/retrieval.rs` `retrieve()`; TS `retrieveFromLibrary` in `src/api/ai-learning.ts` |
| Lexical search | `src/api/ftsSearch.ts` → existing FTS5 tables; UI `SearchPage.tsx`, `CommandCenter.tsx`, `GlobalSearch.tsx` |
| Reset | `ai_learning_reset_index` / `resetAIIndex()` |

Native plugin pattern (copy): `src-tauri/plugins/plethora-storekit/ios/Sources/StoreKitPlugin.swift` — `@objc` methods, `invoke.resolve` / `invoke.reject("CODE: …")`, `@available` guards, iOS 14 deploy. Android genai shows non-Apple stubs: `PLATFORM_UNSUPPORTED` in `src-tauri/plugins/plethora-android-genai/src/lib.rs`.

Core Spotlight facts (Aug 2026 planning doc): semantic ranking / `CSUserQuery` iOS 18+; donate `CSSearchableItem` with unique ids; SpotlightSearchTool is **out of this change** (Ask Library / FM tools).

App min iOS: `IPHONEOS_DEPLOYMENT_TARGET = 14.0` in `src-tauri/gen/apple/.../project.pbxproj`. Spotlight semantic APIs are `@available(iOS 18.0, *)`; donate APIs exist earlier and must compile behind availability.

## Goals / Non-Goals

**Goals:**

- Derived Core Spotlight index 1:1 with Plethora ids via deterministic URIs.
- Incremental lifecycle driven by the existing indexer (not a second worker framework — D-Apple-14).
- Privacy default: in-app use only; system Spotlight display opt-in and off.
- Existing search/command palette consume Spotlight hits when available; FTS remains the always-on fallback.
- Logout, index reset, and corruption recovery delete or rebuild the Spotlight domain without touching user documents.
- CI-testable via a fake index; no device Spotlight in GitHub Actions.

**Non-Goals:**

- Storing library text only in Spotlight.
- Persisting `appleSpotlightIdentifier` on `documents` or any user table.
- A new search application, tab, or help-corpus merge.
- `SpotlightSearchTool` / Foundation Models tool calling (change D + D-Apple-8).
- Changing `retrieve(query, k, filters)` prompt text or Ask Library generation (Agent D owns merge later; this change may expose a **candidate list** API for that merge).
- Enabling system-wide Spotlight for private libraries by default.

## Decisions

### 1. Identity is a URI scheme, not a stored Apple id

Every donated item’s `CSSearchableItem.uniqueIdentifier` (and the value parsed from in-app query results) is:

| Kind | URI | Canonical id |
|---|---|---|
| Document | `plethora://document/<id>` | `documents.id` |
| Chunk | `plethora://chunk/<chunk_id>` | `semantic_chunks.id` |
| Extract | `plethora://extract/<id>` | `extracts.id` |
| Card | `plethora://card/<id>` | `learning_items.id` |

Rules:

- Ids are URL-path-safe as already stored (UUIDs / existing TEXT PKs). Do not percent-encode unless an id contains reserved characters; if encoding is needed, it must be symmetric and unit-tested.
- **Never** INSERT/UPDATE an `appleSpotlightIdentifier` column. Mapping is a pure function `spotlight_uri(kind, id)` in Rust (`src-tauri/src/ai_learning/spotlight.rs` or plugin-adjacent module) and the same function in Swift for defensive parsing.
- Opening a hit always loads SQLite by that id. If the row is gone, drop the Spotlight item (orphan — see lifecycle).

*Alternative rejected:* store Apple’s uniqueIdentifier on `documents`. It duplicates the PK, drifts on rebuild, and invites treating Spotlight as canonical.

### 2. Domain, attributes, and display eligibility

- `domainIdentifier`: stable app domain, e.g. `ai.plethora.library` (single domain so logout/reset can `deleteSearchableItems(withDomainIdentifiers:)`).
- Attribute set: title, display name, text content (chunk text or document title + snippet), content type, and a custom key for `sourceType` / `documentId` for filters. Do not donate secrets, API keys, or account tokens.
- `isEligibleForPublicIndexing`: always **false**.
- `isEligibleForDisplayInSpotlight` (and equivalent “show in Spotlight / Look Up” flags): **false** unless `settings.search.systemSpotlightEnabled === true`.
- In-app `CSUserQuery` (iOS 18+) may still search donated items when display eligibility is false. If the OS cannot query non-display items, the implementation **must** fall back to FTS rather than flipping display on.

Setting:

- Add `Settings.search.systemSpotlightEnabled: boolean` in `src/types/settings.ts` and `defaultSettings` in `src/stores/settingsStore.ts`, default **false**.
- Merge in the existing persist/migrate path (`settingsStore` versioned merges). Missing key → false.
- Surface the toggle in `src/components/settings/` near `AiIndexPanel.tsx` (search/privacy copy: private library stays in-app unless enabled). Changing the toggle triggers a **rebuild of eligibility** (re-donate or `CSSearchableIndex` attribute update), not a SQLite rewrite.

*Alternative rejected:* donate only when the toggle is on. That would disable in-app semantic ranking and the future SpotlightSearchTool candidate source.

### 3. Hook the existing indexer; do not start a second queue

Donation is a post-commit projector, same actor as embeddings:

1. **Initial / backfill**: after `IndexerCommand::EnqueueAll` or first launch on Apple when the domain is empty, enqueue all documents through the existing queue (`enqueueAIDocument` / `enqueueAllAIDocuments` in `src/api/ai-learning.ts`). Spotlight backfill piggybacks: once chunks are committed, donate document + chunk + extract + card items for that document.
2. **Incremental**: in `indexer.rs` after the content_hash diff (delete orphans, insert/update chunks) and per-chunk COMMIT, call a `SpotlightProjector` (trait, default no-op off Apple). Updates donate changed URIs; deleted chunk/extract/card ids issue `deleteSearchableItems(withIdentifiers:)`.
3. **Delete**: document `ON DELETE CASCADE` on `semantic_chunks` already drops chunks; projector must delete `plethora://document/<id>` and all `plethora://chunk/<id>` for that document. Extra sources already use `ai_learning_remove_source_chunks` / `removeSourceChunks()` — hook the same path.
4. **Rebuild**: `ai_learning_reset_index` wipes SQLite index tables then reindexes. Projector **deletes the entire domain first**, then donates as backfill proceeds. User content unchanged (existing reset spec).
5. **Logout / local library reset**: any path that wipes the local library or signs the user out of a device-local profile (account logout in `src/stores/accountStore.ts` / `src/lib/sync-client.ts` `logout()`, plus existing “reset local data” if present) **must** delete the Spotlight domain. Derived index must not outlive the SQLite library.
6. **Corruption recovery**: persist a cheap projector generation (`spotlight_generation` integer in `ai_index_state` aggregate or a one-row `spotlight_index_meta` table — **not** on `documents`). On launch, compare donated-id count from plugin `apple_spotlight_status` (item count + generation; **not** a separate `apple_spotlight_stats` command) vs SQLite URI set. Mismatch, plugin error `index_corrupted`, or OS “index unavailable” → `apple_spotlight_rebuild` (delete domain + enqueue indexer backfill) or the equivalent `apple_spotlight_delete_domain` + `enqueueAllAIDocuments`. During rebuild, search uses FTS.

Concurrency: projector calls are serialized on the indexer worker (already single-consumer). Swift side: batch donate (Apple’s recommended batching); one heavy Spotlight batch at a time (D-Apple-14). Failures log **no content** (`src/lib/ai/diagnostics.ts` allowlist: counts, error category only).

*Alternative rejected:* a TypeScript job that walks the library independently. It would race the indexer and duplicate `job_queue` patterns.

### 4. Search UX: merge into existing palette and Search page

- `src/api/ftsSearch.ts`: add an optional Apple candidate fetch that returns `{ uri, score, title, excerpt }` mapped to existing `FtsSearchResult` / `SearchResult` shapes (`GlobalSearch.tsx` `SearchResultType` document | extract | flashcard).
- `CommandCenter.tsx` / `GlobalSearch.tsx`: same result rows and navigation as today (open document, extract, card). Spotlight is a **ranker/candidate source**, not a new `SearchResultType`.
- `SearchPage.tsx`: same merge; keep Ask Library / help article kinds unchanged.
- Dedup by canonical id after parsing the URI. Prefer Spotlight score when both hit; never drop FTS-only hits (FTS remains recall floor).
- Capability gate: A’s frozen id `apple_spotlight_search` (do **not** register `apple_spotlight_index`). Registry meaning is OS-family on iOS/macOS; whether the donated index is queryable still comes from `apple_spotlight_status`. Unavailable on Android/web.

Help retrieval (`features/help/helpRetrieval`, Ask Plethora) stays **out** of this index (D-Apple-7).

### 5. Plugin commands (reserved names for crate `lib.rs`)

Implemented in Swift `AppleSpotlight.swift`, forwarded from `plethora-apple-intelligence`:

| Command | Role |
|---|---|
| `apple_spotlight_status` | OS version, semantic query available, display-eligible flag echo, item count, generation |
| `apple_spotlight_donate` | Batch upsert items `{ uri, title, body, sourceType, documentId, eligibleForDisplay }` |
| `apple_spotlight_delete` | Delete by URI list |
| `apple_spotlight_delete_domain` | Wipe domain (reset / logout / corruption) |
| `apple_spotlight_query` | In-app query (CSUserQuery when `@available`; else error `unsupported_os` so TS uses FTS) |
| `apple_spotlight_rebuild` | Delete domain then signal indexer backfill (corruption / user rebuild). Do not invent `apple_spotlight_stats`. |

Non-Apple: every command `platform_unsupported`. Desktop macOS **does** implement if the plugin is linked for macOS Catalyst/app; if the current Tauri macOS target cannot link CoreSpotlight, status is `platform_unsupported` and FTS-only — do not crash.

Permissions: allowlist in `src-tauri/capabilities/default.json` (`plethora-apple-intelligence:default` once crate exists).

### 6. Testing strategy

- **Rust**: projector unit tests with a `FakeSpotlight` recording donate/delete/domain-wipe; indexer tests in `indexer.rs` style (`reset_wipes_index_but_not_documents`) extended for URI lists on insert/update/delete/rebuild/orphans.
- **TS**: Vitest merge of FTS + Spotlight candidates; fallback when plugin rejects; `systemSpotlightEnabled` default false and rebuild trigger; URI parse round-trip.
- **Swift**: extracted mapping tests if feasible; otherwise Rust+TS own the contract. No CI dependency on a real `CSSearchableIndex`.

## Risks / Trade-offs

- **Privacy leak** if display eligibility defaults true or Info.plist implies system search — mitigated by default false and settings copy.
- **OS cannot query non-display items** — mitigated by mandatory FTS fallback, never silently enabling display.
- **Indexer.rs merge conflict** with NaturalLanguage embeddings (Agent G) — projector trait is additive; G must not rewrite donate hooks.
- **Stale Spotlight after sync pull** — content_hash diff already reindexes changed documents; projector follows. Deletions must call remove-source-chunks / document delete as they do today.
- **iOS 14 compile** — unguarded CoreSpotlight semantic types fail the Apple project; `@available` + runtime is mandatory.

## Migration Plan

1. Land routing change A (plugin skeleton + reserved commands).
2. Add URI helper + FakeSpotlight tests (no native).
3. Swift donate/delete/query + stubs.
4. Indexer hooks + reset/logout/corruption.
5. Settings toggle + search merge.
6. Manual TestFlight: confirm system Spotlight does **not** show library items at default; confirm in-app search still works offline; toggle on and verify Settings → Spotlight (device) only then.

Rollback: disable capability / skip projector (no-op Fake); leftover Spotlight items are deleted on next `delete_domain` or app uninstall. SQLite unaffected.
