## 1. Prerequisites and plugin seams

- [ ] 1.1 Confirm `extend-ai-capability-routing-for-apple` crate and reserved `apple_vision_*` commands
- [ ] 1.2 Register `import_document_scan` and `import_photo_library` in `src/lib/platformCapabilities.ts` (available iOS; unavailable Android/desktop/web unless macOS status is explicitly available)
- [ ] 1.3 Extend `src/lib/__tests__/platformCapabilities.test.ts` and the desktop/Android frozen snapshot with the new ids as **false** on those platforms
- [ ] 1.4 Confirm `AIErrorCategory` can express `PermissionDenied`, `VisionUnavailable`, `OCRFailed`, `Cancelled`, `InputTooLarge`

## 2. Native Vision / document camera

- [ ] 2.1 Add `ios/Sources/AppleVision.swift` with `RecognizeDocumentsRequest` behind `@available(iOS 26.0, macOS 26.0, *)`; keep iOS 14 compile
- [ ] 2.2 Implement `apple_vision_status` with no capture; include `handwriting: unsupported` (or equivalent) so UI cannot advertise it
- [ ] 2.3 Implement `apple_vision_present_scanner` (VisionKit document camera); map user cancel to `Cancelled` without creating a library document
- [ ] 2.4 Implement `apple_vision_recognize_document` for in-sandbox images; map structure to generic `VisionBlock` DTO
- [ ] 2.5 Implement `apple_vision_cancel`; single in-flight Vision batch (D-Apple-14)
- [ ] 2.6 Reject oversized images (dimension/byte caps modeled on `plethora-android-genai`)
- [ ] 2.7 Forward from plugin `lib.rs`; non-Apple → `platform_unsupported`
- [ ] 2.8 Request camera permission only when Scan is invoked

## 3. EnhancedFilePicker and import pipeline

- [ ] 3.1 Extend `ImportSource` and `importOptions` in `src/components/documents/EnhancedFilePicker.tsx` with `scan` and `photo` (icons/descriptions; no separate made-up menu)
- [ ] 3.2 Filter those options with `isPlatformCapabilityAvailable` (same pattern as `import_screenshot`)
- [ ] 3.3 Implement `handleFileSelect` + `renderImportMethod` for scan/photo
- [ ] 3.4 Wire `src/routes/documents.tsx` `handleImportFromPicker` (and any other `onImport` hosts) for the new sources
- [ ] 3.5 Add documentStore ingest helper: create document + `ingest_image_asset` (`src/api/image-registry.ts`) + metadata link for occlusion (`occlusionSources.ts` / `image_asset_ids`)
- [ ] 3.6 Render Vision blocks to HTML/Markdown (titles, paragraphs, lists, tables) into `documents.content`
- [ ] 3.7 No-text / bad image: still keep image asset when bytes are valid; show picker error when decode fails
- [ ] 3.8 Command palette `scan-document` with `capabilityId: "import_document_scan"` opening this picker source (`CommandPalette.tsx`)

## 4. Privacy copy

- [ ] 4.1 Rewrite `NSCameraUsageDescription` in `scripts/ios-overrides/privacy-manifest.json` to include QR sync **and** document scanning, and accurate local storage language (replace QR-only "no photos" claim)
- [ ] 4.2 Prefer `PHPickerViewController` for `photo` so full Photo Library permission is unnecessary; add `NSPhotoLibraryUsageDescription` only if a permission is actually triggered
- [ ] 4.3 Update `docs/release/ios-privacy-manifest-audit.md` camera row
- [ ] 4.4 Do not treat generated `src-tauri/gen/apple/plethora-tauri_iOS/Info.plist` as the editable source of truth

## 5. Coexistence and optional AI

- [ ] 5.1 Leave share sheet (`src/lib/shareTarget.ts`), PDF import, Tesseract/cloud `OCRSettings.tsx`, and Android ML Kit OCR unchanged as default paths
- [ ] 5.2 Optional post-import summarize/tags/cards via existing `runTask` (`passage-summarize`, `smart-tagging`, `learn-this`); do not auto-run expensive tasks
- [ ] 5.3 Wrap scan text in untrusted containment if any task is run (`src/lib/ai/tasks/containment.ts`)

## 6. Tests

- [ ] 6.1 Fixture images: paragraph, table, list, no-text/blank, corrupt/bad bytes (`src/lib/ai/__fixtures__/vision/`)
- [ ] 6.2 Mapper tests for tables/lists/titles; unknown blocks degrade to paragraph/plain text
- [ ] 6.3 Picker tests: sources hidden on Android/desktop; visible when capability true; cancel scanner creates no document
- [ ] 6.4 Image registry: scan produces `image_assets` row and occlusion can resolve the id
- [ ] 6.5 Fake plugin: permission denied, cancel, InputTooLarge
- [ ] 6.6 Manual TestFlight: multi-page scan, QR still works, purpose string review

## 7. Non-regression

- [ ] 7.1 Existing ImportSource flows (local, folder, url, arxiv, screenshot, anki, json) unchanged
- [ ] 7.2 Desktop screenshot capability still desktop-only
- [ ] 7.3 Diagnostics contain no OCR/scan text
- [ ] 7.4 Handwriting is not claimed in UI or status as available
