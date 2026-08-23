## 1. Schema and versioning

- [x] 1.1 Migration adding `provider`, `revision`, `language` on `semantic_chunk_embeddings`; extend `embedding_version_for`.
- [x] 1.2 Tests: mixed dimension/revision not comparable; retrieve current-version only.

## 2. Native + Rust provider

- [x] 2.1 Swift `AppleNaturalLanguage.swift`: status, requestAssets, mean-pool batch embed.
- [x] 2.2 `EmbeddingProviderType::AppleNaturalLanguage` + live/stub backends; install bridge from `lib.rs` like Gemma.
- [x] 2.3 Explicit asset download UX (do not start on status check).

## 3. Consumers

- [x] 3.1 Default iOS retrieve path uses Apple NL when live; honor Ollama/cloud when configured.
- [x] 3.2 Optional related-items + duplicate cosine; tag ranking fallback; feature-gate if vectors missing.

## 4. Sync / settings

- [x] 4.1 Confirm embedding blobs are not synced as canonical; document in index panel.
- [x] 4.2 Surface revision/language/dimension in `AiIndexPanel`.

## 5. Tests

- [x] 5.1 Mock identity flip; plugin `platform_unsupported` on desktop; Vitest mocks.
- [x] 5.2 Manual iOS 17+ assets; lexical on older iOS.
