# Design: Android AppSearch derived index

## Architecture

```text
SQLite documents/chunks (source of truth)
        │
        ├── existing FTS5 + cosine retrieval
        └── optional AppSearch LocalStorage projection (Android)
                    │
                    └── candidate ids → join to SQLite rows → RagHit
```

If AppSearch is missing, corrupt, or flagged off, retrieval is unchanged.

## Native APIs

- Jetpack AppSearch `appsearch-local-storage`
- Embedding property / `semanticSearch()` only if `Features.isFeatureSupported(SCHEMA_EMBEDDING_PROPERTY_CONFIG)`
- Privacy: `setSchemaTypeDisplayedBySystem(schemaType, false)` always

`setSchemaTypeDisplayedBySystem` is **only effective on PlatformStorage** (experimental API). LocalStorage never participates in System UI — that is why v1 is LocalStorage-only. Still set the flag so a future storage backend cannot silently opt in.

Do **not** use PlatformStorage for v1 (system display defaults are dangerous). PlayServicesStorage stores data in Play Services — rejected for private study content v1.

## API maturity

Library GA; **embedding search APIs alpha** (`1.2.0-alpha01` release notes). Keyword index can ship without vectors. Vectors behind the same feature check.

## Version / hardware

LocalStorage: all supported app devices. No Nano requirement. Indexing is **not** GenAI — may run when backgrounded (subject to OS), unlike Prompt.

## Capability detection

`search.appsearch` descriptor: available on Android native; `ready` after schema set; `supportsEmbeddings` from Features API.

## TypeScript / native

Commands: `appsearch_status`, `appsearch_rebuild`, `appsearch_query` (internal; D/C prefer Rust calling Kotlin to avoid double hops). Prefer Rust indexer → plugin embed/query to keep one writer.

## Data model

Schemas (conceptual): Document, Chunk, Extract, Note, Card (optional — cards only if `source_kind` already indexed in SQLite).

Deterministic ids. Payload: title, text prefix, tags, `canonicalId`, `sourceKind`, optional `embedding` float array matching **current** `embedding_version`.

## UX

No user-facing “AppSearch”. Settings: optional “Android search index” with rebuild/delete. Default off until measured.

## Privacy

App-private. `displayedBySystem = false`. Never index decrypted secrets beyond existing library content the user already stored in Plethora.

## Offline / background / resources

Works offline. Rebuild is maintenance-class; battery gate reuse from indexer. Do not duplicate huge image bytes.

## Fallback

On plugin failure, log category `IndexUnavailable` without content; SQLite retrieval continues.

## Errors

Map to `IndexUnavailable` / `IndexBuilding`. Never throw into import.

## Cancellation

Rebuild cancellable; incremental upserts bounded.

## Migration / lifecycle

| Event | Action |
|---|---|
| insert/update canonical | upsert projection |
| delete document | delete document + chunks + extracts |
| embedding model change | wipe vectors or full rebuild with version |
| app upgrade schema | `setSchemaAsync` with compatibility; else rebuild |
| DB reset | wipe AppSearch database |

## Security

Query strings from UI bounded. No raw SQL. Plugin does not accept arbitrary schema names from JS — allowlisted types only.

## Tests

- Fake retriever in A.
- JVM tests for id mapping and delete cascade (in-memory if possible).
- Integration: delete document → query does not return id.

## Device matrix

Emulator sufficient for LocalStorage keyword tests. Vector tests feature-gated.
