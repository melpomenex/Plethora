## Why

Plethora's local ingestion, reader, flashcard generation, and search pipelines lack a unified, fast, 100% offline vision engine. Existing OCR (`Tesseract`, cloud APIs) only extracts flat text without scene understanding, object segmentation polygons, or spatial relations, while image-occlusion and visual search require manual drawing or heavy cloud multimodal LLMs. Integrating Cactus Compute's **Mirage** (`mirage.cact`, ~22 MB 2-bit quantized vision engine, ~74–107 ms local inference) unlocks real-time, privacy-preserving visual intelligence across desktop, mobile, and the browser extension.

## What Changes

- **Local Inference Runtime (`mirage.cact`)**: Add a Rust dynamic FFI wrapper (`libloading`) for Cactus Compute's native C API (`cactus_load`, `cactus_describe`) with lazy model loading, thread-safe serialized inference queue, on-demand/first-run weight caching for `mirage.cact`, raw RGB pixel buffer ingestion, configurable sections (`scene`, `objects`, `text`, `relations`), confidence thresholds (`conf`, `text_conf`), `mask_format="polygons"`, and `0–1000` normalized coordinates. Zero cloud API dependencies.
- **Snap-to-Extract & Screen/PDF Region Parsing**: Decode photos/captures/PDF regions to RGB, sort Mirage `text` blocks into reading order (`0–1000` bounding boxes), and insert structured extracts into Plethora's incremental reading queue while preserving structured scene/diagram JSON for text-based flashcard/cloze generators.
- **Spatial Text + Figure Pairing**: Pair nearby diagrams/callout figures with adjacent text extracts using Mirage `relations` and `0–1000` bounding-box proximity, and render paired visual attachments during spaced repetition review.
- **Automated Image Occlusion & Interactive Tap-to-Mask Reader**: Auto-generate `image-occlusion` flashcards from Mirage's detected text labels and object segmentation polygons, and render interactive, hoverable SVG polygon overlays in Plethora's React reader (`ImageViewer` / `MiragePolygonOverlay`) where clicking a polygon or text region creates a masked flashcard immediately.
- **Visual Semantic Search & Auto-Tagging (SQLite FTS5)**: Add migration `152_mirage_visual_search` (`image_visual_metadata` + `image_visual_search_fts` FTS5 virtual table + triggers), a background worker to index newly ingested images (scene description, detected object names/attributes, OCR text, auto-tags), and integrate visual queries into `run_palette_search` / `GlobalSearch` / `CommandCenter`.
- **Browser Extension Visual Clipper**: Upgrade `browser_extension` to capture visible viewport screenshots on canvas-rendered or non-selectable readers (Kindle Cloud Reader, Google Books, embedded slide decks) and route them through Mirage via the local Tauri `browser_sync_server` (`POST /ai/mirage-clip`) with preserved text and cropped figure assets.

## Capabilities

### New Capabilities

- `vision-engine`: Cactus Compute `libcactus` dynamic FFI, `mirage.cact` model lifecycle/caching, thread-safe inference queue, and RGB-to-structured-JSON pipeline.
- `visual-search`: SQLite FTS5 `image_visual_search_fts` schema, background image indexing worker, auto-tagging, and unified `palette_search` integration.

### Modified Capabilities

- `extract-ingestion`: Add Snap-to-Extract, desktop screen/PDF region snipping to Mirage, spatial text-figure pairing (`selection_context` / attachments), and browser extension Visual Clipper (`POST /ai/mirage-clip`).
- `image-occlusion`: Extend `ImageOcclusionRegion` with optional polygon masks (`points`), add automated Mirage-driven occlusion proposal/card generation, and add interactive SVG tap-to-mask overlays in the React reader and review renderer.

## Impact

- **Backend (Rust/Tauri v2)**: New `src-tauri/src/vision/` module (`cactus_ffi.rs`, `mirage.rs`, `spatial_pairing.rs`, `search_worker.rs`), new `src-tauri/src/commands/vision.rs`, migration `152` in `src-tauri/src/database/migrations.rs`, search integration in `src-tauri/src/commands/search.rs`, and `/ai/mirage-clip` in `src-tauri/src/browser_sync_server.rs`.
- **Frontend (React 19 + TypeScript)**: `src/api/vision.ts`, `src/types/learningItemInteractions.ts` (polygon support on `ImageOcclusionRegion`), `src/components/viewer/MiragePolygonOverlay.tsx` + integration in `ImageViewer.tsx`, `src/components/extracts/SnapToExtractModal.tsx`, `src/components/review/ReviewCardContent.tsx` (polygon SVG occlusion rendering & paired figure attachments), and `src/components/search/GlobalSearch.tsx` / `CommandCenter.tsx` visual search results.
- **Browser Extension**: `browser_extension/background.js`, `browser_extension/popup.html`, `browser_extension/popup.js`, `browser_extension/shared.js`, and new unit tests in `browser_extension/tests/mirage-clipper.test.cjs`.
