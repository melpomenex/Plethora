## Why

Google DeepMind released EmbeddingGemma 2, built on the Gemma 4 architecture, introducing a modular 270M-parameter text/code embedding backbone, expanded 8,192-token context, Matryoshka Representation Learning (MRL), cross-modal projection into a shared 768-d space, and an un-gated Apache 2.0 license. Plethora currently supports first-generation EmbeddingGemma (`embeddinggemma-300m`) via LiteRT on Android, but lacks support for EmbeddingGemma 2's faster 270M backbone, Apache 2.0 direct downloads, larger context window, and MRL dimension truncation.

## What Changes

- Add **EmbeddingGemma 2** (`embeddinggemma-2-270m`) as a supported on-device embedding model in `plethora-android-genai` and `ai_learning`.
- Update the Android LiteRT download pipeline in `EmbeddingSupport.kt` to target the un-gated Apache 2.0 weights on Hugging Face (`litert-community/embeddinggemma-2`) and ModelScope, eliminating license-gate 401 download failures.
- Update model hashes, tokenizer files, and sequence length handling for EmbeddingGemma 2 while preserving backwards compatibility or seamless automatic re-indexing via Plethora's `embedding_version` state machine.
- Expose EmbeddingGemma 2 in `src-tauri/src/ai_learning/embeddings_backend.rs` and the frontend AI configuration (`src/lib/ai/onDeviceAI.ts`).
- Add support for Matryoshka Representation Learning (MRL) dimension slicing (e.g., 256-d, 512-d, 768-d) as a configurable optimization to drastically reduce SQLite embedding storage and speed up vector cosine distance computation.
- Register EmbeddingGemma 2 in the desktop local `OllamaEmbeddingProvider` common models list in `src-tauri/src/ai/embeddings.rs` for GGUF execution on desktop.

## Capabilities

### New Capabilities
- `embeddinggemma-2-support`: Support EmbeddingGemma 2 (270M LiteRT on Android and Ollama/GGUF on desktop) for on-device semantic retrieval, including verified asset download, versioned indexing, and MRL dimension optimization.

### Modified Capabilities
<!-- None: no existing spec requirements under openspec/specs/ are modified. -->

## Impact

- **Mobile Plugin (`plethora-android-genai`)**:
  - `EmbeddingSupport.kt`: Pinned artifact URLs, byte sizes, SHA-256 digests, and tokenizer loader for EmbeddingGemma 2; MRL dimension truncation helper before L2 normalization.
  - `AndroidGenAiPlugin.kt`: Support selecting or defaulting to `embeddinggemma-2-270m`.
- **Rust Backend (`src-tauri`)**:
  - `src-tauri/src/ai_learning/embeddings_backend.rs`: Register `embeddinggemma-2-270m`, compute isolated `embedding_version`, and support MRL dimension configuration.
  - `src-tauri/src/ai/embeddings.rs`: Add `embeddinggemma-2` to `OllamaEmbeddingProvider::common_models()` with default 768 dimension.
  - `src-tauri/src/ai_learning/indexer.rs`: Model version changes cleanly trigger automatic incremental re-indexing per existing version-mismatch behavior.
- **Frontend (`src`)**:
  - `src/lib/ai/onDeviceAI.ts`: Update `EMBED_MODEL_ID` constants, status reporting, and download progress handling.
  - `src/stores/settingsStore.ts` & AI Settings UI: Display EmbeddingGemma 2 download cards and storage footprint details.
- **Dependencies**: LiteRT runtime on Android remains `2.1.0`. No new binary dependencies introduced.
