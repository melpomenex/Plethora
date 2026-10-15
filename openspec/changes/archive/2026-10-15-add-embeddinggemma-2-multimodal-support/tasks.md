## 1. Android Vision Plugin & Model Pipeline

- [x] 1.1 Add `embeddinggemma-2-text-vision-440m` artifact constants, sizes, and Apache 2.0 Hugging Face download endpoints to `EmbeddingSupport.kt`; verify with unit tests in `EmbeddingSupportTest.kt`.
- [x] 1.2 Implement image bitmap resizing, normalization, and LiteRT vision input tensor session handling in `EmbeddingSupport.kt` and `AndroidGenAiPlugin.kt` for `embedImages` IPC; verify with image tensor unit test.
- [x] 1.3 Wire Matryoshka Representation Learning (MRL) dimension slicing for vision embeddings (256d, 512d, 768d); verify L2-normalization unit tests pass.

## 2. Desktop Multimodal Provider (Video & Audio Ingestion)

- [x] 2.1 Implement desktop video keyframe extractor in `src-tauri/src/ai/` sampling frames at regular intervals (0.1–0.2 Hz) or scene transitions; verify with unit test against sample video asset.
- [x] 2.2 Wire image and audio chunk embedding methods into desktop embedding provider (`src-tauri/src/ai/embeddings.rs`); verify Ollama/runner dimension inference unit tests.

## 3. Rust Core Indexer & Unified Database Integration

- [x] 3.1 Define `SOURCE_TYPE_FIGURE` and `SOURCE_TYPE_MEDIA` constants and models in `src-tauri/src/ai_learning/models.rs`; verify serialization and deserialization unit tests.
- [x] 3.2 Update `build_document_chunks` in `src-tauri/src/ai_learning/indexer.rs` to extract embedded figures from documents and schedule image embeddings; verify indexer chunk diff tests pass.
- [x] 3.3 Update `retrieval.rs` to package figure asset metadata (image URL/path, page number) and media timestamp offsets alongside text hits; verify cross-modal retrieval tests pass.

## 4. Frontend UI & Multimodal Search Experience

- [x] 4.1 Update `modelLicense.ts` and On-Device AI settings with the optional "Visual Knowledge (440M)" pack on Android and "Multimodal Media Indexing" on desktop; verify settings component rendering.
- [x] 4.2 Update command palette and search result cards to render figure thumbnail previews and direct navigation to document page; verify UI component rendering.

## 5. Verification & Testing

- [x] 5.1 Run Android plugin unit tests to ensure image normalization, LiteRT vision session, and vector math tests pass.
- [x] 5.2 Run Rust tests for `ai_learning` (`cargo test --lib ai_learning`) to ensure figure chunking, state machine transitions, and cross-modal cosine retrieval operate cleanly.
- [x] 5.3 Run frontend lint and typecheck (`npm run lint`) to verify zero regressions.
