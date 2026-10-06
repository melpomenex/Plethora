## Context

Plethora currently deploys EmbeddingGemma 2 270M for text, which generates 768-dimensional normalized vectors stored in `semantic_chunks` for fast cosine similarity retrieval.

EmbeddingGemma 2's underlying architecture projects text, code, vision, and audio into the identical 768-dimensional latent space. Google packages this as modular encoders:
- 270M Text / Code (~168 MB)
- 440M Text + Vision (~280 MB, adding ~170M vision encoder)
- 740M Full Multimodal (~500+ MB, adding ~300M audio encoder)

See `proposal.md` for user motivation and problem context.

## Goals / Non-Goals

**Goals:**
- Enable mobile devices (Android) to embed document figures, charts, and diagrams using the 440M Text + Vision LiteRT bundle without overloading mobile RAM or battery.
- Enable desktop environments (macOS, Linux, Windows) to run full multimodal embedding across video keyframes and audio chunks in addition to text and diagrams.
- Maintain unified 768-dimensional cosine similarity search where text queries seamlessly retrieve relevant figures, video timestamps, and text chunks.

**Non-Goals:**
- Dense 30/60fps video frame-by-frame indexing on mobile (too hot, excessive battery drain).
- Raw waveform acoustic embedding on mobile (speech-to-text via Whisper/sherpa-onnx followed by text embedding is 50× more efficient and supplies readable flashcard text).
- Replacing local speech-to-text; multimodal embeddings complement transcripts by capturing visual and audio features directly.

## Decisions

### Decision 1: Mobile-Desktop Modality Split
- **Mobile**: Target `embeddinggemma-2-text-vision-440m` via LiteRT. Ingests images resized to 224×224/448×448. Slices output vectors with Matryoshka Representation Learning (MRL).
- **Desktop**: Target `embeddinggemma-2` (740M) via local desktop runner / Ollama / Transformers. Slices keyframes (1 frame every 5–10 seconds) from local video files.
- *Rationale*: Respects mobile thermal and RAM boundaries (avoiding Android LMK termination) while taking advantage of desktop hardware video decoders and multi-gigabyte GPU VRAM.

### Decision 2: Chunk Model & Database Schema
- Introduce `SOURCE_TYPE_FIGURE = "figure"` and `SOURCE_TYPE_MEDIA = "media"` into `ai_learning/models.rs`.
- Figure chunks store the image asset URI/path in metadata along with page number and caption.
- Media chunks store the video/audio file ID and millisecond offset (`timestamp_ms`).
- *Rationale*: Reuses the existing `semantic_chunks` table and FTS/cosine hybrid retrieval engine without breaking schema changes.

### Decision 3: Image Preprocessing Pipeline
- On Android: Native Kotlin image loader decodes bitmaps, scales while preserving aspect ratio, normalizes pixel buffers to `[-1.0, 1.0]` or standard ImageNet mean/std as specified by the Gemma vision backbone, and transfers tensors to LiteRT.
- On Desktop: Hardware-accelerated decode (ffmpeg/image crate) prepares RGB tensors for the embedding runner.

## Risks / Trade-offs

- **[Model Download Size on Mobile]** (~280 MB vs ~168 MB):
  - *Mitigation*: The Text + Vision pack is an optional download in Settings > On-Device AI; the base text-only 270M model remains the default.
- **[PDF Figure Extraction Overhead]**:
  - *Mitigation*: Figure extraction is already performed during document ingestion; embedding is bounded to extracted figures rather than rasterizing entire pages.
- **[Desktop Video Ingestion Time]**:
  - *Mitigation*: Keyframe sampling at 0.1–0.2 Hz (or scene-change detection) limits a 1-hour video to 360–720 frames, embedding in under 5 seconds on modern desktop GPUs.
