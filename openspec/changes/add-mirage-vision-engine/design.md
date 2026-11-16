## Context

Plethora already uses `libloading` (`src-tauri/src/tts/sherpa_ffi.rs`) for runtime dynamic loading of native C APIs without build-time linking, `image` crate (`0.24`) for decoding/cropping images, `xcap` (`src-tauri/src/screenshot.rs`) for desktop screen/region capture, `axum` (`src-tauri/src/browser_sync_server.rs`) for browser extension communication, and SQLite FTS5 (`src-tauri/src/database/migrations.rs` up to `151`) for full-text search.

Mirage (`mirage.cact`) is Cactus Compute's ~22 MB 2-bit quantized vision engine exposing `cactus_load` and `cactus_describe` in `libcactus`. All coordinates returned by Mirage are normalized to `[0, 1000]`, with optional polygon masks (`mask_format="polygons"`), and configurable sections (`scene`, `objects`, `text`, `relations`) with `conf` and `text_conf` thresholds.

## Goals / Non-Goals

### Goals
- Zero build-time dependency on `libcactus` or `mirage.cact` so `cargo check` / `cargo test` and CI builds succeed everywhere, while dynamically loading `libcactus` at runtime when present.
- 100% local, offline-capable inference with lazy model loading, thread-safe serialized queue (preventing concurrent model state corruption), and on-demand/first-run weight caching in Plethora's app data models directory.
- Deterministic, testable Rust & TypeScript pipelines for reading-order text sorting, spatial text-figure pairing, polygon-to-occlusion conversion, FTS5 visual indexing, and browser visual clipping.
- Backwards-compatible extension of `ImageOcclusionRegion` (`points?: Array<{ x: number; y: number }>`) so existing rectangular occlusions and tests remain 100% intact.

### Non-Goals
- Bundling the 22 MB `mirage.cact` binary directly in git. Instead, provide a model locator/cache manager (`PLETHORA_MIRAGE_MODEL`, app-data `models/mirage.cact`, and optional on-demand download URL) plus a documented local dev setup.
- Replacing Tesseract/cloud OCR for existing users who explicitly select them; Mirage integrates alongside and powers the new vision capabilities.

## Decisions

### 1. Dynamic C FFI (`src-tauri/src/vision/cactus_ffi.rs`)
- Load `libcactus` (`libcactus.so` on Linux, `libcactus.dylib` on macOS, `cactus.dll` on Windows, or `PLETHORA_CACTUS_LIB`) via `libloading::Library`.
- Bind `cactus_load(model_path: *const c_char) -> *mut c_void`, `cactus_unload(handle: *mut c_void)`, `cactus_describe(handle: *mut c_void, rgb: *const u8, width: c_int, height: c_int, options_json: *const c_char) -> *const c_char`, and `cactus_free_string(ptr: *const c_char)` (optional if library provides it).
- Wrap the model handle in a `Mutex<Option<LoadedMirage>>` inside `MirageEngine` (managed as Tauri state / `Arc<MirageEngine>`) so inference calls are thread-safe and lazy-loaded on first use.
- When `libcactus` or `mirage.cact` is not installed on the host, return a structured `MirageUnavailable` error (or use an injected `MirageBackend` trait in tests).

### 2. Normalized `0–1000` Coordinate System & Polygon Masks
- Mirage outputs `bbox: [x1, y1, x2, y2]` and `polygon: [[x, y], ...]` in `0–1000` normalized space.
- Reading-order sorter: group `text` detections into lines/columns using vertical overlap (`y` tolerance) and sort top-to-bottom, left-to-right.
- Spatial text-figure pairing: for each `text` block and each non-text figure/object (`diagram`, `chart`, `figure`, `equation`, `image`, or `relations` edge `near`/`describes`/`references`/`contains`), compute normalized Euclidean distance between box edges and pair figures within threshold (`<= 180` in `0–1000` space, or explicitly linked by `relations`).
- `ImageOcclusionRegion` stores `x, y, width, height` in `0–100` percentage coordinates (matching existing `ReviewCardContent.tsx` and `OcclusionCanvas.tsx`) and optional `points?: Array<{ x: number; y: number }>` in `0–100` percentage coordinates. Conversion from Mirage `0–1000` to Plethora `0–100` is simply `val / 10.0`.

### 3. SQLite Migration `152_mirage_visual_search`
- Create `image_visual_metadata` table keyed by `asset_id TEXT PRIMARY KEY` (referencing `image_assets(id) ON DELETE CASCADE`), storing `scene_description`, `objects_json`, `ocr_text`, `tags_json`, `relations_json`, `raw_json`, `indexed_at`.
- Create `image_visual_search_fts` FTS5 virtual table (`asset_id UNINDEXED`, `scene_text`, `objects_text`, `ocr_text`, `tags_text`, `tokenize = 'porter unicode61'`) with `AFTER INSERT`, `AFTER UPDATE`, and `AFTER DELETE` triggers to keep it synchronized automatically.
- Extend `run_palette_search` in `src-tauri/src/commands/search.rs` to query `image_visual_search_fts` when searching `"all"` or `"images"`/`"visual"`.

### 4. Browser Extension Visual Clipper
- Add a "Visual Clip (Mirage)" action in `browser_extension/popup.html` + `popup.js` + `background.js` (context menu & command) that calls `chrome.tabs.captureVisibleTab` (or `browser.tabs.captureVisibleTab`) to capture the visible viewport as PNG/JPEG, and POSTs it to `http://127.0.0.1:8766/ai/mirage-clip`.
- The Tauri `browser_sync_server.rs` handler decodes the image, runs `MirageEngine`, extracts reading-order text, crops detected figure regions into `image_assets`, creates an Extract (with paired figure attachments) in the target document/queue, and returns the structured extract + cropped asset IDs.
