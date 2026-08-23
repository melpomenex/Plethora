## Why

The semantic index in `src-tauri/src/ai_learning/` already owns canonical chunks (`semantic_chunks`) and retrieval (`ai_learning_retrieve` / `src/api/ai-learning.ts`). On Apple platforms, Core Spotlight can rank those same items with on-device semantic search (`CSUserQuery` on iOS 18+) and later feed `SpotlightSearchTool` for Foundation Models — but only if Spotlight is a **derived projector**, not a second library. Today there is no donation path, no stable `plethora://` identity, and no privacy default that keeps a private study library out of system Spotlight. Without this change, in-app search stays FTS-only on iOS and Ask Library cannot merge Apple ranking later (`add-apple-ondevice-library-rag`).

## What Changes

- Add Swift `AppleSpotlight` inside the shared `plethora-apple-intelligence` plugin (crate owned by `extend-ai-capability-routing-for-apple`). Commands are namespaced `apple_spotlight_*`.
- Treat Core Spotlight as a **rebuildable derived index**. Canonical storage remains SQLite: `documents`, `extracts`, `learning_items`, `semantic_chunks` (migration `085_ai_learning_system` in `src-tauri/src/database/migrations.rs`).
- Donate `CSSearchableItem` records whose `uniqueIdentifier` is a deterministic URI from existing row ids. **Do not** persist `appleSpotlightIdentifier` (or any Apple-specific id column) on `documents` or other user tables.
- Hook incremental donate/delete into the existing indexer worker (`src-tauri/src/ai_learning/indexer.rs`) after per-document hash-diff commits, plus cascade delete, reset, logout, and corruption rebuild.
- Default **not eligible** for system-wide Spotlight display. Add `settings.search.systemSpotlightEnabled` default **false** (D-Apple-6). In-app `CSUserQuery` / command-palette merge still uses the donated index.
- Augment existing search surfaces (`src/api/ftsSearch.ts`, `src/pages/SearchPage.tsx`, `src/components/search/CommandCenter.tsx`, `src/components/search/GlobalSearch.tsx`). Do **not** ship a separate Spotlight search app or help-index merge (`features/help/helpRetrieval`).
- Fall back to existing FTS5 (`document_search` / `ftsSearch`) when Spotlight is unavailable, empty, or errors.

## Capabilities

### New Capabilities

- `apple-spotlight-index`: Derived Core Spotlight projector over Plethora library ids, privacy-gated system display, indexer-driven lifecycle, and in-app search augmentation with FTS fallback.

### Modified Capabilities

- `ai-semantic-index`: Indexer lifecycle gains a Spotlight donation hook; the SQLite chunk store remains source of truth for indexed text.

## Impact

- **Hard prerequisite**: `extend-ai-capability-routing-for-apple` (plugin crate skeleton, command-name reservation, `platform_unsupported` stubs, capability IDs). Soft prerequisite: existing semantic indexer (`add-ondevice-ai-learning-system` Phase 3).
- **Native plugin**: `src-tauri/plugins/plethora-apple-intelligence/` — Swift `AppleSpotlight.swift`; Rust command forwards in that crate’s `src/lib.rs`; non-Apple OS returns `platform_unsupported` without linking CoreSpotlight.
- **Indexer**: `src-tauri/src/ai_learning/indexer.rs` (post-commit donate, orphan delete, reset wipe). Coordinate with NaturalLanguage embeddings on this file (donations vs embed provider).
- **Settings / capabilities**: `src/stores/settingsStore.ts`, `src/types/settings.ts`, `src/lib/platformCapabilities.ts`, `src-tauri/capabilities/default.json`.
- **Search UX**: FTS + palette only; no new destination tab.
- **Testing**: Fake Spotlight index in CI; insert/update/delete/rebuild/orphans/FTS fallback. No physical Apple Intelligence required.
- **Explicit non-goals**: Canonical storage in Spotlight; persisting Apple unique ids on documents; system Spotlight on by default; merging help RAG with the library index; implementing Ask Library merge (`add-apple-ondevice-library-rag`); Foundation Models `SpotlightSearchTool` (later, D-Apple-8).
