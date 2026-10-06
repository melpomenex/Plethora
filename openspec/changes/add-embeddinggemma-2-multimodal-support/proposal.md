## Why

Plethora currently embeds text chunks, user extracts, and speech transcripts with the text-only EmbeddingGemma 2 (270M) backbone. However, critical knowledge in academic papers, textbooks, and articles is contained in visual figures, charts, diagrams, and illustrations that lack textual descriptions. Furthermore, desktop environments have ample GPU/CPU capacity to index video keyframes and audio clips without mobile battery and thermal constraints.

Google's EmbeddingGemma 2 modular architecture projects text, code, images, video frames, and audio into the exact same 768-dimensional vector space. By introducing the lightweight Text + Vision (440M) encoder on mobile and full multimodal (740M) indexing on desktop, Plethora enables cross-modal semantic retrieval across diagrams, media, and text.

## What Changes

- **Mobile (Android LiteRT)**:
  - Add optional Text + Vision (440M) LiteRT artifact download (`embeddinggemma-2-text-vision-440m`, ~280 MB) alongside the text-only pack.
  - Implement `embedImage` / `embedImages` IPC in `plethora-android-genai` to preprocess and embed image bitmaps via the LiteRT Vision encoder.
  - Ingest PDF figures, EPUB illustrations, and article images as `SOURCE_TYPE_FIGURE` semantic chunks.
- **Desktop (macOS, Linux, Windows)**:
  - Support full multimodal EmbeddingGemma 2 (740M) through local desktop providers (Ollama / local runner).
  - Add video keyframe sampling (e.g. 1 frame every 5–10s or scene change detection) to embed video moments into the library index.
  - Add audio chunk embedding for direct audio retrieval.
- **Rust Core (`ai_learning`)**:
  - Add `SOURCE_TYPE_FIGURE` and `SOURCE_TYPE_MEDIA` chunk models to `semantic_chunks`.
  - Update `build_document_chunks` to extract document figures and index their embeddings.
  - Provide cross-modal retrieval where a single text query matches text passages, diagram images, and video timestamps.
- **Frontend UI & Settings**:
  - Add visual thumbnail previews to semantic search results in the command palette, reader, and Ask Library.
  - Clicking a figure hit jumps directly to the diagram in the reader; clicking a video hit seeks to the timestamp.
  - Add "Visual Knowledge Indexing" toggle in mobile On-Device AI settings and "Multimodal Media Indexing" in desktop settings.

## Capabilities

### New Capabilities
- `embeddinggemma-2-multimodal`: Modular multimodal embedding pipeline with Vision for mobile and Vision + Audio/Video for desktop into a shared 768d vector space.

### Modified Capabilities
<!-- None -->

## Impact

- **Android Plugin**: `plethora-android-genai` adds image preprocessing and LiteRT vision tensor session handling.
- **Rust Backend**: `src-tauri/src/ai_learning/` introduces image/media chunk models, extraction pipeline, and multi-asset retrieval payload.
- **Desktop AI**: `src-tauri/src/ai/embeddings.rs` and local runner handle image and video keyframe batches.
- **Frontend**: Search modals, reader viewer, and settings panel display image thumbnails and media deep-links.
