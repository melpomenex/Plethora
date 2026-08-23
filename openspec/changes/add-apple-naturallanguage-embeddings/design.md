## Context

Binding planning: `openspec/planning/ios-on-device-ai-openspecs.md` (D-Apple-1, D-Apple-2, D-Apple-10). This change is **G** in that map. It extends `ai-semantic-index`; it does **not** replace cloud/Ollama/EmbeddingGemma and does **not** depend on Foundation Models.

Current embedding stack:

| Piece | Path |
|---|---|
| Trait | `src-tauri/src/ai/embeddings.rs` — `EmbeddingProvider`, `EmbeddingProviderType` (`OpenAI`, `Cohere`, `OpenRouter`, `Ollama`), `EmbeddingResponse { embedding, dimension, tokens }` |
| Factory | `src-tauri/src/ai/embedding_config.rs` `build_provider`; commands `semantic_search.rs`, `semantic_graph.rs` |
| Index backend | `src-tauri/src/ai_learning/embeddings_backend.rs` — `OnDevice` / `OnDeviceLive` (EmbeddingGemma), `Provider`, `Mock`; `embedding_version_for(kind, model)` |
| Store | `semantic_chunk_embeddings` (`chunk_id`, `embedding` BLOB, `model`, `dimension`, `embedding_version`, `content_hash`) — migration `085_ai_learning_system` |
| Indexer | `src-tauri/src/ai_learning/indexer.rs` — stale when stored version/model ≠ backend |
| Retrieve | `retrieval.rs` cosine over current-version rows; else `lexicalOnly` FTS |
| TS config | `src/api/ai-learning.ts` `EmbeddingConfig` — cloud/Ollama only; missing config → on-device stub |
| Android live path | `src-tauri/src/lib.rs` installs `plethora_android_genai::embed_texts_via_app` into `on_device_embedder` |
| Duplicates | `check_semantic_duplicate_candidates` in `src-tauri/src/commands/learning_item.rs` |
| Related items | `src/utils/semanticRelations.ts` (lexical/heuristic today) |
| Tag fallback | `src/lib/smartTagging/baseline.ts` + `candidateRetrieval.ts` `rankCandidateTags` |
| Deploy | iOS 14.0; NLContextualEmbedding is iOS 17 / macOS 14 |

Android already occupies the “on-device default” slot. Apple NL is the iOS/macOS analogue, not a second parallel retrieve API.

## Goals / Non-Goals

**Goals:**

- `NLContextualEmbedding` as a first-class `EmbeddingProvider` via Swift bridge + Rust trait.
- Mean-pool token vectors to one `Vec<f32>` per chunk/query, dimension recorded per row.
- Persist provider, model identity, **revision**, **language**, and dimension; bump `embedding_version` when any of those identity fields change.
- Device-local vectors; never sync blobs; never assume iOS dimension equals macOS dimension.
- Consumers: retrieval assistance, related items, duplicate detection, tag-ranking fallback.
- Fake embedder for `cargo test` / Vitest; version-mismatch reindex without network.
- iOS 14 compile: `@available` + runtime; older OS → embeddings unavailable → lexical-only.

**Non-Goals:**

- Making Apple NL the only embedder or deleting EmbeddingGemma/cloud/Ollama.
- Cross-device vector sync or a global “same cosine” guarantee.
- Using NL as a chat/generation model.
- Spotlight donations (change C) except sharing indexer seams.
- Paid-cloud embedding consent changes (`paidEmbeddingsEnabled`); Apple NL is not billable.

## Decisions

### 1. Provider type and backend kind

Extend, do not fork:

- `EmbeddingProviderType::AppleNaturalLanguage` in `embeddings.rs`.
- New struct `AppleNlEmbeddingProvider` implementing `EmbeddingProvider` (`generate_embedding`, `generate_embeddings_batch`, `is_available`, `dimension`, `provider_type`).
- `embeddings_backend.rs`: add `EmbeddingBackendKind::AppleNl` (string `"apple-nl"`) and variants:
  - `AppleNl { … }` inert when OS < 17, assets missing, or non-Apple target (same lexical-only degradation as `OnDevice` stub).
  - `AppleNlLive { embedder, model, revision, language, dimension }` when the plugin bridge is installed (mirror `OnDeviceLive` + `install_on_device_embedder` in `lib.rs`).

Resolution (`from_config`):

- On Apple with live NL bridge: prefer Apple NL over cloud, **unless** config is Ollama (keep today’s “local Ollama honored” rule) or the user explicitly selected a cloud provider **and** `paidEmbeddingsEnabled` (existing billing gate). Default iOS path with `config == None` uses Apple NL, not Gemma (Gemma plugin is Android).
- On Android: unchanged Gemma live path.
- Desktop non-Apple: unchanged stub/Ollama/cloud.

TS `EmbeddingConfig` / `EmbeddingSettings.provider`: add `"apple-nl"` only if settings UI needs an explicit picker; otherwise Apple remains the implicit on-device default on iOS (like Gemma on Android) and `AiIndexPanel` shows provider name + revision + language + dimension from `getAIIndexStatus()` (`EmbeddingModelUsage` today has `model` + `embeddingVersion` — extend with revision/language/dimension).

### 2. Native contract: mean-pool token vectors

Swift `AppleNaturalLanguage.swift` (`@available(iOS 17.0, macOS 14.0, *)`):

- `requestAssets` / availability for the requested language (user library language; do not assume English — planning §1.6).
- `NLContextualEmbedding` token sequence → **mean pool** (average of token vectors; skip empty; L2-normalize the pooled vector so cosine in `retrieval.rs` / `vector_store.rs` stays consistent with other backends).
- Batch texts with a cap aligned to indexer `EMBED_BATCH_SIZE` (25) and Android’s 32-cap (`ON_DEVICE_EMBED_BATCH_CAP`).
- Return `{ vectors: number[][], dimension, revision, language, model }` where `model` is a stable string such as `nlcontextualembedding` and `revision` is Apple’s asset revision integer/string.

Rust plugin commands (namespaced):

| Command | Role |
|---|---|
| `apple_nl_status` | available / assets not ready / unsupported OS / `platform_unsupported`; reports dimension, revision, language |
| `apple_nl_request_assets` | user-visible download of NL assets (explicit action, like Gemma download) |
| `apple_nl_embed_texts` | batch embed; reject oversized payloads |

`embed_texts_via_app`-style **direct** Rust→plugin call from the indexer (see `src-tauri/src/lib.rs` Gemma install) so indexing does not hop through the WebView.

Errors: map missing assets to existing embedding-unavailable (indexer stores chunks without vectors). Permission is not required for NL embeddings. `UnsupportedLanguage` (`AIErrorCategory` from change A) when the locale has no embedding asset; retrieval stays lexical.

iOS 14: types behind `@available`; else status `unsupported_os`.

### 3. Persist identity; stale on revision/language/dimension change

Migration (next id in `src-tauri/src/database/migrations.rs` `MIGRATIONS` registry — **not** leftover `migrations/*.sql`):

`semantic_chunk_embeddings` add:

- `provider TEXT NOT NULL DEFAULT ''` (e.g. `apple-nl`, `on-device`, `ollama`, `cloud`, `mock`)
- `revision TEXT NOT NULL DEFAULT ''`
- `language TEXT NOT NULL DEFAULT ''`

`dimension` already exists. Backfill: existing rows keep `model`/`embedding_version`; empty provider means “legacy, treat as current backend only if model matches.”

`embedding_version_for` must hash **kind + model + revision + language + dimension** (extend `embedding_version_for` in `embeddings_backend.rs`). A macOS 768-d revision and an iOS 512-d revision **must** produce different versions so a restored DB on the other OS marks stale and re-embeds locally rather than cosine-mismatching silently.

Indexer stale check (`indexer.rs` ~`stored_version != backend.embedding_version() || stored_model != backend.model_name()`): also compare provider/revision/language/dimension when columns are present.

`AggregateIndexStatus.embeddingModels` / `EmbeddingModelUsage` in `src/api/ai-learning.ts`: surface those fields in settings (`AiIndexPanel.tsx`).

### 4. Do not sync vectors (D-Apple-10)

- Embedding BLOBs and Apple revision metadata are **device-local derived data**, same class as `semantic_chunk_embeddings` today (rebuildable cache; `ai_learning_reset_index` wipes them).
- Sync protocol (`src-tauri/src/sync/`, any table allowlist, and client sync in `src/lib/sync-client.ts`) **must not** upload or merge `semantic_chunk_embeddings` with the assumption that cosine space is shared. If chunks sync, embeddings recompute on each device.
- Tests: a fixture with two `AppleNl` backends (dim 512 vs 768, or revision `"r1"` vs `"r2"`) must not consider vectors comparable; retrieval on mixed versions uses only current-version rows or lexicalOnly (existing retrieve behavior).

*Alternative rejected:* one global version integer. OS revision is not under our control; hashing identity fields is the same trick already used for Gemma `kind/model`.

### 5. Consumers (no new product islands)

| Use | Integration |
|---|---|
| Retrieval assistance | Query embed via same backend as index; `retrieve()` in `retrieval.rs` unchanged aside from backend selection. Mode `semantic` when current-version Apple vectors exist. |
| Related items | Optionally score with chunk/document vectors inside `semanticRelations.ts` **or** a small Rust helper used by the documents view (`documentsView.noRelatedItems`). If vectors missing, keep current heuristic. |
| Duplicate detection | `find_duplicate_candidates` / `check_semantic_duplicate_candidates` may cosine against card-front chunk embeddings when Apple (or any) backend is live; threshold stays 0.85 at `learnThisValidation.ts`. Lexical/token overlap remains fallback. |
| Tag ranking fallback | When `smart-tagging` LLM path fails, Tier 1 `rankCandidateTags` may add a cosine term between document embedding and tag-name embeddings. **Not** a second tag system (D-Apple-9). Flag off if vectors unavailable. |

Diagnostics: never log text or vectors (`diagnostics.ts`).

### 6. Fake embedder and CI

- Extend `EmbeddingBackend::Mock` (already hash-seeded unit vectors in `embeddings_backend.rs`) to accept an identity `{ revision, language, dimension }` so tests can flip revision and assert reindex.
- Plugin tests: non-Apple `apple_nl_*` → `platform_unsupported`.
- Vitest: mock `plugin:plethora-apple-intelligence` like Nano in `src/lib/ai/`.
- **No** physical `NLContextualEmbedding` in CI. Simulator may lack assets — status path must be tested with fakes.

## Risks / Trade-offs

- **Silent bad cosine** if mixed dimensions land in one query — mitigated by version hash including dimension and retrieve-only-current-version rows.
- **Sync poisoning** — mitigated by not syncing blobs and by tests.
- **Asset download surprise** — `apple_nl_request_assets` is explicit; indexing degrades to lexical until ready (existing EmbeddingUnavailable behavior).
- **indexer.rs** conflict with Spotlight (Agent C) — G owns embed provider; C owns donate hooks.
- **Language matrix** — runtime locale check, not a hardcoded SKU table (planning unresolved #2).

## Migration Plan

1. Change A plugin skeleton + reserved `apple_nl_*` commands.
2. Migration columns + `embedding_version_for` identity expansion + Mock tests (no Swift).
3. Swift NL + Rust provider + `lib.rs` bridge install (Apple only).
4. Wire retrieve / duplicates / related / tag fallback behind availability.
5. Settings panel metadata; document “vectors are not synced.”
6. TestFlight: iOS 17+ asset download, lexical on iOS 16, dimension logged in diagnostics without text.

Rollback: uninstall bridge → `AppleNl` stub → lexicalOnly; user documents intact. Reset index if mixed-version rows confuse a developer build.
