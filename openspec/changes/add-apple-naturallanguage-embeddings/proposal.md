## Why

Apple devices have no on-device embedding backend today. `src-tauri/src/ai/embeddings.rs` implements OpenAI / Cohere / OpenRouter / Ollama; Android uses EmbeddingGemma via `plethora-android-genai`. Retrieval (`src-tauri/src/ai_learning/retrieval.rs`) already degrades to FTS `lexicalOnly` when vectors are missing — which is the iOS default. `NLContextualEmbedding` (iOS 17 / macOS 14) can produce token vectors offline after `requestAssets`, but revision, language, and dimension vary by OS (reports of 512-d iOS vs 768-d macOS). Syncing those blobs would poison cosine search across devices (D-Apple-10). This change adds Apple NL as **one** `EmbeddingProvider`, not a replacement for the existing matrix.

## What Changes

- Implement `NLContextualEmbedding` behind the existing Rust `EmbeddingProvider` trait in `src-tauri/src/ai/embeddings.rs`, with a Swift bridge `AppleNaturalLanguage.swift` in `plethora-apple-intelligence` (commands `apple_nl_*`).
- Mean-pool native token vectors into one chunk vector matching `EmbeddingResponse.embedding` / `dimension`.
- Persist **provider, model, revision, language, and dimension** with every stored vector (extend `semantic_chunk_embeddings` beyond today’s `model` / `dimension` / `embedding_version` from migration 085). Recompute `embedding_version` so OS revision changes mark rows stale and the indexer re-embeds locally.
- **Do not sync vectors across devices.** Device-local derived data only; no equality assumption between iPhone and Mac (or Android EmbeddingGemma).
- Keep cloud / Ollama / EmbeddingGemma backends. Apple NL is selected on iOS/macOS when assets are ready and the user has not forced another local provider (Ollama still honored, matching `EmbeddingBackend::from_config` in `src-tauri/src/ai_learning/embeddings_backend.rs`).
- Use the same vectors for: library retrieval assistance, related-item ranking, duplicate detection (`check_semantic_duplicate_candidates` in `src-tauri/src/commands/learning_item.rs`), and smart-tagging **Tier 1 ranking fallback** (`src/lib/smartTagging/candidateRetrieval.ts` / `baseline.ts`) — not a second tag system (D-Apple-9).
- App remains `IPHONEOS_DEPLOYMENT_TARGET = 14.0`; NL APIs are `@available(iOS 17.0, macOS 14.0, *)` plus runtime checks.

## Capabilities

### New Capabilities

- `apple-naturallanguage-embeddings`: On-device Apple Natural Language embeddings as an `EmbeddingProvider`, versioned device-local storage, fake embedder for CI, and consumers (similarity, related items, duplicates, retrieval, tag-ranking fallback).

### Modified Capabilities

- `ai-semantic-index`: Embedding backend registry gains an Apple NL live/stub path; stale-on-revision semantics extend the existing model-version reindex.

## Impact

- **Hard prerequisite**: `extend-ai-capability-routing-for-apple` (plugin crate, stubs, errors, platform capability IDs). Soft: semantic indexer + `ai_learning_*` commands. Does **not** depend on Foundation Models.
- **Native plugin**: `src-tauri/plugins/plethora-apple-intelligence/` Swift NL module; non-Apple OS `platform_unsupported`.
- **Rust**: `src-tauri/src/ai/embeddings.rs` (`EmbeddingProvider` / `EmbeddingProviderType`); `src-tauri/src/ai_learning/embeddings_backend.rs`; indexer stale detection in `indexer.rs`; retrieve path in `retrieval.rs`. Coordinate Spotlight donations vs embed provider on `indexer.rs`.
- **TS**: `src/api/ai-learning.ts` (`EmbeddingConfig` currently omits Apple — extend or keep Apple as implicit on-device default, parallel to EmbeddingGemma); `src/stores/settingsStore.ts` index panel; `src/lib/ai/diagnostics.ts` (no vector payloads).
- **Sync**: exclude embedding blobs / revision metadata from any cross-device equality; document in sync allowlist if one exists.
- **Testing**: fake embedder; version-mismatch reindex; tests that refuse to treat two devices’ vectors as comparable. CI has no NL assets.
- **Explicit non-goals**: Replacing cloud/Ollama/Gemma; syncing embeddings; using NL as a generative model; assuming English-only or a frozen dimension; requiring iOS 17 as the app deploy target.
