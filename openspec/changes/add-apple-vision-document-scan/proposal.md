## Why

The import picker (`src/components/documents/EnhancedFilePicker.tsx`) only offers `local | folder | url | arxiv | screenshot | anki | json`. Screenshot is gated by `import_screenshot` and is **desktop-only** (`src/lib/platformCapabilities.ts`). There is no document-scan or Photos source. iOS OCR today is Tesseract/cloud settings (`OCRSettings.tsx`) plus Android ML Kit labels on `plethora-android-genai` — no Apple Vision document pipeline.

`NSCameraUsageDescription` in `scripts/ios-overrides/privacy-manifest.json` (copied to `src-tauri/gen/apple/plethora-tauri_iOS/Info.plist`) currently says the camera is **only** for sync QR codes and that **no photos are recorded**. Document scan would make that string false.

iOS/macOS 26 `RecognizeDocumentsRequest` is on-device (not Apple Intelligence), returns structure (paragraphs, lists, tables, barcodes) in documented languages, and works with fixture images in Simulator. Scans must become normal Plethora documents **and** keep the original image in `image_assets` (`migrations.rs` 033, `src/api/image-registry.ts`, occlusion via `occlusionSources.ts`) so image occlusion is not blocked.

## What Changes

- Implement Swift `AppleVision` in `src-tauri/plugins/plethora-apple-intelligence/` with `apple_vision_*` commands. TypeScript SDK `src/lib/ai/appleVision.ts`.
- Add import sources **`scan`** and **`photo`** to `ImportSource` in `EnhancedFilePicker.tsx`, shown only when A’s platform capabilities `import_document_scan` / `import_photo_library` are available. Wire `handleFileSelect` + `renderImportMethod` cases — **do not invent a separate iOS-only menu**. Downstream: `src/routes/documents.tsx` `handleImportFromPicker` and `documentStore` ingest.
- Map Vision structure → HTML/Markdown document body (titles, paragraphs, lists, tables **when Vision provides them**). Persist the captured/picked image via `ingest_image_asset` / repository `image_assets` and record the asset id on the document metadata for occlusion.
- Capability-detect at runtime (`@available(iOS 26, *)` + request support). Do **not** promise handwriting OCR as a shipped capability; if Vision returns no structured text, save the image document and let the user edit. Optional later: plain text request as a fallback, still user-editable.
- Update camera purpose string (and add Photos picker copy only if a permission is actually required; prefer `PHPickerViewController`, which does not need full library access).
- Optional AI enrichment **after import** (tags/summary/cards) via existing tasks (`smart-tagging`, `passage-summarize`, `learn-this`) — opt-in, not automatic.
- Preserve share sheet (`src/lib/shareTarget.ts`, `share_extension_inbox`), PDF import, and existing OCR settings. Scanning is an additional source, not a replacement.
- Tests: fixture images (tables/lists, no text, bad image), cancel, capability-hidden sources on Android/desktop.

## Capabilities

### New Capabilities

- `apple-vision-scan`: On-device Vision document recognition, capability-gated scan/photo import sources in EnhancedFilePicker, structured document + image-registry persistence, honest handwriting limits, updated camera purpose string, optional post-import AI.

### Modified Capabilities

- `core_import`: additional sources on iOS when Vision is available; other platforms unchanged.
- `apple-ai-capability-routing`: fills reserved `apple_vision_*` commands; consumes A’s `import_document_scan` / `import_photo_library` (does not register `apple_vision_scan`).
- `apple-privacy-compliance`: camera (and if needed photo) purpose strings must match scan/photo workflows.

## Impact

- **Hard dependency:** `extend-ai-capability-routing-for-apple` (plugin, A’s `PermissionDenied` / `CapabilityUnavailable` / `GenerationFailed` mapping, fakes, capability registry).
- **Soft:** Foundation Models provider for optional enrichment; image registry and occlusion composer already exist.
- **Frontend:** `EnhancedFilePicker.tsx`, `src/routes/documents.tsx`, `documentStore.ts` (new ingest helpers), `platformCapabilities.ts` + tests (desktop/Android snapshot must stay frozen except new iOS-only ids), `CommandPalette.tsx` / `CommandCenter.tsx` capability-gated "Scan document" (`capabilityId` already supported).
- **Native:** `AppleVision.swift`, plugin forwarding, payload size limits (mirror Android genai image bounds), VisionKit document camera UI presented from the plugin.
- **Privacy:** `scripts/ios-overrides/privacy-manifest.json` `NSCameraUsageDescription`; audit doc `docs/release/ios-privacy-manifest-audit.md`.
- **Must NOT:** change occlusion geometry math; replace Tesseract/cloud OCR; merge share-extension into Vision; raise iOS 14 deployment target; auto-run expensive AI on every scan.

## Owns

Vision Swift, `appleVision.ts`, EnhancedFilePicker sources + documents route wiring, image-asset linking, camera purpose string, Vision fakes/tests.

## Must NOT change

- `transcriptionProvider.ts` (E)
- `providers/index.ts` / `errors.ts` unions except using categories A already added
- Semantic indexer SQL
- Android ML Kit OCR behavior
