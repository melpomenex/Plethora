## Why

Scanning textbook pages should create **ordinary Plethora documents** plus image-registry assets, using ML Kit Document Scanner (GA, Play-delivered UI) and Text Recognition (Latin already in genai plugin). OCR is not semantic reconstruction. AI enrichment is optional.

## Existing behavior

- File/folder import, image registry, occlusion task, Latin OCR labels in android-genai, cloud OCR providers, PDF pipeline.

## What Changes

- Plugin `plethora-android-vision` (scanner Activity Result + multi-script OCR as needed).
- Workflow: camera/gallery → scanner crop/correct → JPEG pages into **existing image registry** (dedup) → OCR blocks/lines/elements → Plethora document (plain structured text; headings heuristic only).
- Preserve source images for verify/re-OCR/occlusion.
- Optional later: Prompt/Image Description for alt text and occlusion suggestions (B; experimental flag).
- CAMERA permission via scanner UI; not a global always-on permission.
- Save succeeds even if OCR or AI fails.

## Capabilities

### New Capabilities
- `android-scan-import`: scanner, OCR import, image registry linkage, optional enrich hook.

## Non-goals

- Claiming OCR rebuilds full textbook semantics/tables.
- Digital ink as v1 default (G may add later).
- Separate “Android documents” collection.

## Dependencies

A vision interfaces. B optional for enrich. Image registry APIs exist.

## Expected ownership

**Agent F.** May **call** existing `ondevice_ai_ocr_labels` for Latin occlusion boxes rather than duplicating; multi-script recognizers live in the vision plugin. Does not own Studio UI.
