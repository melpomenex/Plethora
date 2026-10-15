## 1. Android Plugin Artifacts and Download Pipeline

- [x] 1.1 Update `EmbeddingSupport.kt` constants with EmbeddingGemma 2 identifiers (`EMBEDDING_MODEL_NAME = "embeddinggemma-2-270m"`), artifact file names, sizes, and SHA-256 digests; verify via unit tests in `EmbeddingSupportTest.kt`.
- [x] 1.2 Update download sources in `EmbeddingSupport.kt` to target unauthenticated Apache 2.0 URLs on Hugging Face (`litert-community/embeddinggemma-2`) and ModelScope; verify test assertions for valid URLs.
- [x] 1.3 Verify Gemma 2 SentencePiece tokenizer compatibility in `SentencePieceBpeTokenizer.kt` against the EmbeddingGemma 2 tokenizer model file; verify with local JVM tokenizer unit tests.

## 2. Matryoshka Representation Learning (MRL) and Inference

- [x] 2.1 Implement Matryoshka dimension truncation helper in `EmbeddingSupport.kt` to slice raw vectors to target dimensions (256, 512, 768) prior to L2-normalization; verify normalization unit tests pass for truncated vectors.
- [x] 2.2 Update `EmbedTextsArgs` in `EmbeddingSupport.kt` and `AndroidGenAiPlugin.kt` to optionally accept an `mrlDimension` parameter, defaulting to full dimension; verify IPC parsing unit tests.
- [x] 2.3 Verify `LiteRtEmbeddingSession.kt` allocates input and output buffers matching the EmbeddingGemma 2 LiteRT model tensors; verify session error handling unit tests.

## 3. Rust Backend and Indexer Isolation

- [x] 3.1 Update `ON_DEVICE_MODEL` in `src-tauri/src/ai_learning/embeddings_backend.rs` and `plethora-android-genai/src/lib.rs` to `"embeddinggemma-2-270m"`; verify `embedding_version_for` generates a distinct version from legacy `embeddinggemma-300m`.
- [x] 3.2 Add `embeddinggemma-2` to `OllamaEmbeddingProvider::common_models()` in `src-tauri/src/ai/embeddings.rs` with inferred 768 dimension; verify Ollama dimension inference unit tests.
- [x] 3.3 Verify automatic re-indexing and version invalidation tests in `src-tauri/src/ai_learning/indexer.rs` pass with the new model version.

## 4. Frontend Types and UI

- [x] 4.1 Update `EMBED_MODEL_ID` in `src/lib/ai/onDeviceAI.ts` and ensure typed status reporting handles `embeddinggemma-2-270m`; verify TypeScript compilation with `npm run typecheck`.
- [x] 4.2 Update settings copy and model size indicators in the on-device AI settings panel to reflect EmbeddingGemma 2 (~150 MB text model); verify UI component rendering.

## 5. Verification and Integration Tests

- [x] 5.1 Run Kotlin JVM unit tests in `src-tauri/plugins/plethora-android-genai` (`./gradlew testDebugUnitTest`) to ensure tokenization, downloader state machine, and vector math tests pass.
- [x] 5.2 Run Rust tests for `ai_learning` (`cargo test --lib ai_learning`) to ensure indexer state transitions, FTS fallback, and cosine retrieval operate cleanly.
- [x] 5.3 Run performance and lint checks (`npm run lint && npm run test:scripts`) to verify no regressions in bundle budgets or scripts.
