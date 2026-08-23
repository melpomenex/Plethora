## ADDED Requirements

### Requirement: Apple NL is one EmbeddingProvider among several

The system SHALL expose `NLContextualEmbedding` through the existing Rust `EmbeddingProvider` trait in `src-tauri/src/ai/embeddings.rs` (plus Swift `AppleNaturalLanguage` in `src-tauri/plugins/plethora-apple-intelligence/`). Apple NL SHALL NOT be the only embedding system: OpenAI, Cohere, OpenRouter, Ollama, Android EmbeddingGemma (`plethora-android-genai`), and the `Mock` backend in `src-tauri/src/ai_learning/embeddings_backend.rs` SHALL remain. On Apple, NL SHALL be the implicit on-device default when live, except that an explicit Ollama config remains honored (same rule as `EmbeddingBackend::from_config` today).

#### Scenario: Cloud and Ollama providers still construct
- **WHEN** `EmbeddingConfig` / `EmbeddingConfigInput` selects OpenAI, Cohere, OpenRouter, or Ollama
- **THEN** `build_provider` / `from_config` still returns that provider
- **AND** Apple NL is not required for those paths to work

#### Scenario: Android Gemma path unchanged
- **WHEN** the app runs on Android with the genai embedding bridge installed (`src-tauri/src/lib.rs`)
- **THEN** the on-device backend remains EmbeddingGemma
- **AND** Apple NL commands report `platform_unsupported`

#### Scenario: iOS default uses Apple NL when available
- **WHEN** Apple NL assets are ready and no Ollama embedding config is forced
- **THEN** indexing and query embedding use the Apple NL provider
- **AND** retrieval can return mode `semantic` from `retrieveFromLibrary` / `src-tauri/src/ai_learning/retrieval.rs`

### Requirement: Mean-pooled token vectors with recorded identity

The Swift bridge SHALL mean-pool `NLContextualEmbedding` token vectors into a single L2-normalized `Vec<f32>` per text matching `EmbeddingResponse`. Every stored row in `semantic_chunk_embeddings` SHALL persist **provider**, **model**, **revision**, **language**, and **dimension** (extend migration `085` via a new in-code migration in `src-tauri/src/database/migrations.rs`). `embedding_version` SHALL be a stable function of those identity fields (extend `embedding_version_for` in `embeddings_backend.rs`).

#### Scenario: Mean pool produces one vector per chunk
- **WHEN** `apple_nl_embed_texts` is given a chunk string
- **THEN** the result contains one embedding whose `dimension` equals the native model dimension
- **AND** that vector is what the indexer writes to `semantic_chunk_embeddings.embedding`

#### Scenario: Identity fields are stored
- **WHEN** a chunk is embedded with Apple NL revision `R`, language `L`, and dimension `D`
- **THEN** the embedding row stores provider `apple-nl` (or equivalent kind string), revision `R`, language `L`, dimension `D`, and a matching `embedding_version`

### Requirement: Stale on revision or space change; reindex locally

When provider, model, revision, language, or dimension differs from the live backend, stored vectors SHALL be marked stale and re-embedded incrementally. The index SHALL remain queryable in lexical-only mode during reindex (existing `ai-semantic-index` behavior). Re-embedding SHALL run on the device that detected the mismatch; another device’s vectors SHALL NOT be assumed valid.

#### Scenario: Revision change triggers reindex
- **WHEN** Apple reports a new NL embedding revision
- **THEN** existing Apple NL rows are stale
- **AND** the indexer re-embeds incrementally without deleting user documents
- **AND** `retrieve` uses FTS (`lexicalOnly`) until current-version vectors exist

#### Scenario: Dimension change is a new space
- **WHEN** stored dimension is 512 and the live backend is 768
- **THEN** `embedding_version` differs
- **AND** cosine search does not mix the two populations

### Requirement: Vectors are device-local and must not sync

NaturalLanguage (and other on-device) embedding blobs SHALL be device-local derived data (D-Apple-10). The sync protocol SHALL NOT upload or merge `semantic_chunk_embeddings` with an equality assumption across devices or OS versions. Each device SHALL re-embed from canonical chunk text.

#### Scenario: No cross-device equality assumption
- **WHEN** tests construct two Apple NL identities (different revision or dimension)
- **THEN** they do not share `embedding_version`
- **AND** retrieve helpers do not claim the vectors are comparable

#### Scenario: Sync does not copy blobs as canonical
- **WHEN** a library is synced to a second device
- **THEN** embedding BLOBs are not required to match
- **AND** the second device builds vectors with its local provider identity

### Requirement: Availability, deploy target, and assets

`NLContextualEmbedding` APIs SHALL be compiled under `@available(iOS 17.0, macOS 14.0, *)`. The app SHALL keep `IPHONEOS_DEPLOYMENT_TARGET = 14.0`. Status SHALL distinguish `platform_unsupported`, `unsupported_os`, and assets-not-ready. Asset download SHALL be an explicit `apple_nl_request_assets` (user action), not a side effect of a status check. Missing embeddings SHALL degrade to lexical retrieval, not a hard indexer failure (`EmbeddingUnavailable` in `embeddings_backend.rs`).

#### Scenario: iOS 14 binary does not crash
- **WHEN** the app runs on iOS 16 or earlier
- **THEN** NL types are not executed
- **AND** search/retrieval use FTS
- **AND** status reports `unsupported_os` or equivalent

#### Scenario: Assets not downloaded
- **WHEN** NL is supported but assets are not ready
- **THEN** a status check does not start the download
- **AND** indexing stores chunks without vectors until the user requests assets and they become ready

### Requirement: Consumers — similarity, related items, duplicates, retrieval, tag ranking

Apple NL vectors, when present and current-version, SHALL be usable for:

1. Library retrieval assistance (`retrieve` / `retrieveFromLibrary` in `src/api/ai-learning.ts`)
2. Related-item ranking (`src/utils/semanticRelations.ts` or equivalent), with the existing heuristic as fallback
3. Duplicate detection (`check_semantic_duplicate_candidates` in `src-tauri/src/commands/learning_item.rs`, threshold used by `src/lib/ai/tasks/definitions/learnThisValidation.ts`)
4. Smart-tagging **Tier 1 ranking fallback** (`src/lib/smartTagging/candidateRetrieval.ts` / `baseline.ts`) — not a second tag system

#### Scenario: Retrieval assistance
- **WHEN** current-version Apple NL embeddings exist and the query is embedded with the same identity
- **THEN** `retrieve` can return `mode: "semantic"` with chunk metadata
- **AND** if the backend is unavailable, `mode` is `lexicalOnly` rather than an error

#### Scenario: Duplicate detection fallback
- **WHEN** embeddings are unavailable
- **THEN** `check_semantic_duplicate_candidates` still returns using its non-vector path (or empty/advisory)
- **AND** Learn This validation does not crash

#### Scenario: Tag ranking fallback
- **WHEN** the `smart-tagging` LLM task fails and Apple NL vectors are available
- **THEN** Tier 1 ranking MAY use cosine against tag-name embeddings
- **AND** the app still uses the existing smart-tagging task and baseline, not a parallel tag product

#### Scenario: Related items without vectors
- **WHEN** no current embeddings exist
- **THEN** related-item UI continues to use `src/utils/semanticRelations.ts` heuristics

### Requirement: Fake embedder for tests

CI SHALL use a fake embedder (`EmbeddingBackend::Mock` and/or a plugin fake). Tests SHALL cover version-mismatch reindex and SHALL NOT call real `NLContextualEmbedding`. Diagnostics SHALL never include vectors or chunk text (`src/lib/ai/diagnostics.ts`).

#### Scenario: Fake embedder indexes and retrieves
- **WHEN** tests install a deterministic fake Apple/Mock embedder
- **THEN** the indexer stores vectors and retrieve can run in semantic mode
- **AND** no native NL framework is invoked

#### Scenario: Version mismatch test
- **WHEN** a test swaps the fake identity (revision or dimension) after an index is built
- **THEN** stored vectors are stale
- **AND** a subsequent index run re-embeds under the new version
