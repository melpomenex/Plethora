## 1. Phase 1: Native FFI, Engine & Database Schema

- [ ] 1.1 Create `src-tauri/src/vision/cactus_ffi.rs` with `libloading` dynamic bindings for `cactus_load`, `cactus_describe`, `cactus_unload`, `cactus_free_string` and library path resolution.
- [ ] 1.2 Create `src-tauri/src/vision/types.rs` defining `MirageRequestOptions`, `MirageSection`, `MirageResponse`, `MirageObject`, `MirageTextBlock`, `MirageRelation`, and `0–1000` to `0–100` coordinate helpers.
- [ ] 1.3 Create `src-tauri/src/vision/mirage.rs` implementing `MirageEngine` (lazy model loading, thread-safe serialized queue, on-demand/first-run weight caching for `mirage.cact`, raw RGB buffer inference, and `MirageBackend` trait for testability).
- [ ] 1.4 Add migration `152_mirage_visual_search` in `src-tauri/src/database/migrations.rs` (`image_visual_metadata`, `image_visual_search_fts`, sync triggers) plus migration unit tests.

## 2. Phase 2: Ingestion, Spatial Pairing, Occlusion & Search Backend

- [ ] 2.1 Create `src-tauri/src/vision/spatial_pairing.rs` implementing reading-order text sorting (`0–1000` boxes), spatial text-to-figure pairing (relations + proximity), and cropped figure extraction.
- [ ] 2.2 Create `src-tauri/src/vision/search_worker.rs` implementing background visual indexing of `image_assets` into `image_visual_metadata` + `image_visual_search_fts` and auto-tag generation.
- [ ] 2.3 Create `src-tauri/src/commands/vision.rs` exposing Tauri commands: `mirage_status`, `mirage_ensure_model`, `mirage_analyze_image`, `mirage_snap_to_extract`, `mirage_generate_occlusion_cards`, `mirage_create_region_occlusion_card`, `mirage_search_visual`, and `mirage_index_asset`. Register in `src-tauri/src/commands/mod.rs` and `src-tauri/src/lib.rs`.
- [ ] 2.4 Integrate `image_visual_search_fts` into `run_palette_search` in `src-tauri/src/commands/search.rs`.
- [ ] 2.5 Add `POST /ai/mirage-clip` route in `src-tauri/src/browser_sync_server.rs` to process browser viewport screenshots through Mirage and create structured extracts with cropped figure assets.

## 3. Phase 3: Frontend Types, Reader SVG Overlay, Capture & Review UI

- [ ] 3.1 Extend `ImageOcclusionRegion` in `src/types/learningItemInteractions.ts` with optional `points?: Array<{ x: number; y: number }>` and paired figure attachment metadata.
- [ ] 3.2 Create `src/api/vision.ts` wrapping all Mirage Tauri commands with clean TypeScript interfaces.
- [ ] 3.3 Create `src/components/viewer/MiragePolygonOverlay.tsx` rendering interactive, hoverable SVG polygon masks (`mask_format="polygons"`) and text regions over images, where clicking a region immediately creates a masked flashcard in the review queue.
- [ ] 3.4 Integrate `MiragePolygonOverlay` and a "Mirage Analyze / Tap-to-Mask" toggle into `src/components/viewer/ImageViewer.tsx`.
- [ ] 3.5 Create `src/components/extracts/SnapToExtractModal.tsx` for desktop/mobile photo/file import and desktop screen-region snipping (`capture_app_window_region` -> Mirage -> reading-order extract + paired figures).
- [ ] 3.6 Update `src/components/review/ReviewCardContent.tsx` to render polygon SVG occlusion masks when `region.points` is present and display paired visual attachments alongside cloze/Q&A cards.
- [ ] 3.7 Update `src/components/search/GlobalSearch.tsx` and `src/components/search/CommandCenter.tsx` (or search API) to surface visual semantic search matches (`"visual"` result type).

## 4. Phase 4: Browser Extension Visual Clipper & Verification

- [ ] 4.1 Upgrade `browser_extension/background.js`, `popup.html`, `popup.js`, and `shared.js` with "Visual Clip (Mirage)" viewport screenshot capture (`captureVisibleTab`) and `/ai/mirage-clip` submission.
- [ ] 4.2 Add unit tests in `browser_extension/tests/mirage-clipper.test.cjs`.
- [ ] 4.3 Add Rust unit/integration tests for Mirage reading-order sorting, spatial pairing, FTS5 visual search, occlusion generation, and `/ai/mirage-clip`.
- [ ] 4.4 Add Vitest unit tests for `MiragePolygonOverlay` and polygon `ReviewCardContent` rendering.
- [ ] 4.5 Run `cargo test`, `npx tsc --noEmit`, `npm run test:run`, and `npm run test:browser-extension` to verify clean builds and passing tests.
