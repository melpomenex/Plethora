## Context

Plethora implements on-device semantic memory and retrieval across documents, extracts, and annotations (`src-tauri/src/ai_learning/`). On Android, this uses the `plethora-android-genai` plugin running LiteRT 2.1.0 with the first-generation `embeddinggemma-300m` model. Model artifacts are downloaded into app-private storage and sha256-verified before loading. The SQLite schema (`semantic_chunk_embeddings` from migration 085) stores embeddings with `model`, `dimension`, and an integer `embedding_version` derived from `sha256(kind/model)`.

With Google DeepMind's release of EmbeddingGemma 2 (built on Gemma 4 architecture), the 270M text/code backbone offers higher retrieval quality, an un-gated Apache 2.0 license, 8k context window, and Matryoshka Representation Learning (MRL).

See `proposal.md` for overall motivation.

## Goals / Non-Goals

**Goals:**
- Provide `embeddinggemma-2-270m` as an on-device embedding model for Android and local Ollama for desktop.
- Download verified un-gated LiteRT artifacts from Hugging Face and ModelScope without license-gate 401 errors.
- Ensure safe vector-space isolation using Plethora's `embedding_version` mechanism so existing databases re-index cleanly in the background without poisoned cross-model cosine similarity searches.
- Add support for Matryoshka (MRL) dimension slicing (e.g. 256d or 512d) to save storage and speed up distance calculation.

**Non-Goals:**
- Multimodal vision/audio encoders in v1: The 170M vision and 300M audio modules remain a future extension seam; this change focuses on the 270M text/code backbone for semantic text indexing and RAG.
- Proprietary NPU-specific delegates in v1: Inference continues using `Accelerator.CPU` to guarantee portability across all Android devices.
- Replacing existing cloud or Ollama backends: EmbeddingGemma 2 acts as a newer on-device default, not an exclusive engine.

## Decisions

### 1. Model Identifier: `embeddinggemma-2-270m`
- **Choice**: Use `embeddinggemma-2-270m` as the canonical model identity across Kotlin (`EMBEDDING_MODEL_NAME`), Rust (`ON_DEVICE_MODEL`), and TypeScript (`EMBED_MODEL_ID`).
- **Rationale**: Plethora's `embedding_version_for(kind, model)` hashes the model string. Changing from `embeddinggemma-300m` to `embeddinggemma-2-270m` automatically produces a new positive `embedding_version`. The background indexer in `src-tauri/src/ai_learning/indexer.rs` natively flags documents as `IndexState::Stale` when their version mismatches the active backend, seamlessly initiating an incremental re-index.
- **Alternatives considered**: Reusing `embeddinggemma-300m` name with an internal revision counter. Rejected because it would risk vector-space pollution if cached vectors from the two architectures collided.

### 2. Artifact Packaging & Download Pipeline
- **Choice**: Download `embeddinggemma-2-270M_seq512_mixed-precision.tflite` and `sentencepiece.model` from `https://huggingface.co/litert-community/embeddinggemma-2/resolve/main` with fallback to ModelScope.
- **Rationale**: EmbeddingGemma 2 is Apache 2.0 licensed, meaning Hugging Face does not require authentication tokens or gated acceptance headers. The dual-source strategy (canonical HF + ModelScope mirror) remains in place with strict SHA-256 verification.
- **Alternatives considered**: Bundling the `.tflite` model directly in the APK. Rejected because it would bloat the base APK by >150 MB.

### 3. Matryoshka Representation Learning (MRL) Slicing
- **Choice**: Compute output embeddings by slicing raw output floats to the target dimension `D` (`vector.slice(0, D)`) *before* applying L2-normalization.
- **Rationale**: MRL guarantees that prefix sub-vectors of EmbeddingGemma 2 are meaningful and retain high retrieval accuracy. Storing 256 dimensions reduces SQLite vector blob storage from 3,072 bytes to 1,024 bytes per chunk (a 66% saving) and speeds up inner-product calculation by ~3×.
- **Versioning**: If an MRL dimension other than 768 is configured, the dimension is factored into `embedding_version_for` (e.g., `embeddinggemma-2-270m-mrl256`) so different dimensionalities never mix in cosine search.

### 4. Desktop Support via Ollama
- **Choice**: Add `embeddinggemma-2` to `OllamaEmbeddingProvider::common_models()` in `src-tauri/src/ai/embeddings.rs` with `infer_dimension("embeddinggemma-2") -> 768`.
- **Rationale**: Gives desktop users access to local EmbeddingGemma 2 via Ollama (GGUF weights) using the existing desktop settings flow.

## Risks / Trade-offs

- **[Risk] Background re-indexing battery/CPU drain after upgrade** → **Mitigation**: Plethora's background indexer already respects system constraints: it pauses when battery is low, yields cooperatively after batch chunks (batch size 25), and maintains full-text search (BM25 FTS5) as the instant fallback.
- **[Risk] LiteRT op-kernel compatibility** → **Mitigation**: Verify that Gemma 4 architecture layers (such as RMSNorm, GeGLU, rotary embeddings) in the LiteRT artifact are supported by LiteRT 2.1.0 runtime without requiring native library upgrades.
- **[Risk] Sequence length constraints** → **Mitigation**: While EmbeddingGemma 2 supports up to 8k tokens, the on-device LiteRT input buffer is kept at seq512 or seq1024 to bound memory and CPU latency; Plethora's semantic chunker targets ~200–260 tokens per chunk, which fits comfortably inside this budget.

## Migration Plan

1. The SQLite schema (`semantic_chunk_embeddings` and `ai_index_state`) requires no structural migrations; it already stores arbitrary `model` strings, `dimension` integers, and `embedding_version` integers.
2. When the updated app is installed, the download manager checks the local file match. If legacy weights are present, the user is offered the one-click download of the updated model.
3. Upon downloading and loading `embeddinggemma-2-270m`, the indexer detects the version change, marks previous chunks as stale, and re-indexes in the background. Previous vectors remain usable by FTS5 fallback while re-indexing occurs.
