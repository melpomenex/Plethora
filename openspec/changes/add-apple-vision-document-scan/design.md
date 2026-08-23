## Context

Import UX is `EnhancedFilePicker` (`src/components/documents/EnhancedFilePicker.tsx`): a **sidebar of `importOptions`**, not a platform-specific action sheet. Screenshot is already capability-gated:

```ts
option.id !== "screenshot" || isPlatformCapabilityAvailable("import_screenshot")
```

`src/routes/documents.tsx` `handleImportFromPicker` switches on `ImportSource`. Share extension (`src/lib/shareTarget.ts`, capability `share_extension_inbox`) already stages files. Image occlusion requires a real `image_assets` row (`src/api/image-registry.ts`, `src-tauri/src/database/repository.rs`, `occlusionSources.ts`).

Camera copy today (`scripts/ios-overrides/privacy-manifest.json` and generated `Info.plist`):

> Plethora uses the camera only when you scan a sync QR code to link another device. No photos or video are recorded or uploaded.

That forbids implying photo capture. Scan + document camera **does** capture images (locally). The string must be rewritten to list QR **and** document scan, and to state images stay in the library unless the user exports/syncs.

`RecognizeDocumentsRequest` (iOS/macOS 26): structure for paragraphs, lists, tables, barcodes; ~26 languages; **not** Apple Intelligence; Simulator usable with fixtures. Handwriting is **not** a documented guaranteed output — product copy must not say "handwriting OCR."

Binding: D-Apple-1, D-Apple-2, D-Apple-12, D-Apple-13, D-Apple-14, D-Apple-15 (palette: "Scan document", capability-gated).

## Goals / Non-Goals

**Goals:**

- Add `scan` and `photo` sources to the **existing** picker, hidden unless capabilities are available.
- Run on-device Vision document recognition when iOS/macOS 26+ reports the request is supported.
- Preserve structure Vision actually returns (title-like blocks, paragraphs, lists, tables) as HTML/Markdown in `documents.content`.
- Always ingest the original image into `image_assets` and link it for occlusion.
- Honest capability matrix: printed-document structure vs aspirational handwriting.
- Update purpose strings to match real camera use.
- Optional post-import AI via existing tasks; share sheet / PDF / Tesseract remain.

**Non-Goals:**

- Replacing PDF import, share extension, or desktop screenshot.
- A new top-level iOS tab or a made-up "Scan" menu outside EnhancedFilePicker + existing command palette.
- Promising handwriting, math OCR, or business-card CRM.
- Auto-generating flashcards/tags on every scan.
- Changing occlusion region math (only supply `image_asset` id).
- Full `NSPhotoLibrary` access if `PHPickerViewController` suffices.

## Decisions

### 1. Import sources live on EnhancedFilePicker

Extend:

```ts
export type ImportSource =
  | "local" | "folder" | "url" | "arxiv"
  | "screenshot" | "anki" | "json"
  | "scan" | "photo";
```

Add two `importOptions` entries (Scan document / Photo). Filter with `isPlatformCapabilityAvailable("import_document_scan")` and `import_photo_library` respectively — same pattern as screenshot. Android and desktop: both unavailable (`unsupported_platform`) so the frozen snapshot in `platformCapabilities.test.ts` stays valid if new ids default to unavailable everywhere except iOS (and macOS desktop if the plugin reports available — **hide photo/scan on non-Apple desktop** unless status says otherwise; v1: iOS/iPadOS primary, macOS only if `apple_vision_status` is available).

`handleFileSelect`:

- `scan` → invoke `apple_vision_present_scanner` (VisionKit document camera or equivalent). User can cancel the system UI; that is not an error toast storm.
- `photo` → `PHPicker` (single or small multi, bounded). Then `apple_vision_recognize_document` per image.

`src/routes/documents.tsx` and any DocumentsView picker host must handle the new sources (today the route file is the `onImport` owner).

Command palette (`src/components/common/CommandPalette.tsx`): add `scan-document` with `capabilityId: "import_document_scan"` that opens the picker with source `scan` (e.g. custom event `import-document` + initial source), **not** a duplicate camera stack.

### 2. Plugin commands

`AppleVision.swift` in the shared crate.

| Command | Role |
|---|---|
| `apple_vision_status` | OS, `@available`, request supported, camera permission, busy, handwriting: **always `unsupported` or `unknown` in v1** (do not advertise). Languages list from Apple docs at runtime if API provides it. |
| `apple_vision_present_scanner` | Present document camera; return images + recognition or cancel. |
| `apple_vision_recognize_document` | File/bytes in-app; structure DTO; `requestId`. |
| `apple_vision_cancel` | Cancel in-flight batch. |

Payload limits: reject oversized images (mirror Android genai decoded-byte/dimension caps) with `InputTooLarge`.

Non-Apple: `platform_unsupported`.

### 3. Generic document structure DTO (not Vision types)

```ts
type VisionBlock =
  | { kind: "title"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "barcode"; payload: string } // optional; render as text/code, not a second product
  | { kind: "unknown"; text: string };

interface VisionDocumentResult {
  blocks: VisionBlock[];
  detectedLanguage?: string;
  /** true only when Vision returned at least one non-empty text-bearing block */
  hasText: boolean;
  warnings: Array<"no_text" | "low_confidence" | "handwriting_unreliable" | "truncated">;
}
```

Renderer: titles → `h1`/`h2`, paragraphs → `p`, lists → `ul`/`ol`, tables → HTML `<table>`. This becomes `documents.content` (html or markdown — pick the existing import path used for HTML files in `documentStore` / `documentsApi`). Empty `blocks` + `hasText: false`: still create an **image document** (content may be a short placeholder like "Scanned page (no text detected)") so the user can type.

Never persist `RecognizeDocumentsRequest` / VisionKit types.

### 4. Image registry + occlusion

Pipeline after a successful capture/pick:

1. Write image bytes through `ingest_image_asset` (`src/api/image-registry.ts`) → `image_assets` (sha256 dedupe already in repository tests).
2. Create/update the library `documents` row with body from step 3.
3. Store `metadata.imageAssetIds: [id]` (or the existing document↔asset convention if one exists — **prefer the same JSON field occlusion already reads** in `occlusionSources.ts` / learning items `image_asset_ids`). If documents do not yet reference registry ids, add a bounded metadata key and teach occlusion "open composer for this document's source image" without changing quad math.

Deleting the document must not necessarily delete a shared asset (reference counts already exist on `list_image_assets_with_usage`).

### 5. Real vs aspirational handwriting

`apple_vision_status.handwriting` is **not** `available` in v1. UI copy: "Works best on printed documents and clear typed text." If Apple later exposes a reliable handwriting flag, a follow-on change can flip the snapshot — this spec forbids marketing handwriting now.

If the request returns text the user judges wrong, they edit the document; we do not silently send the image to cloud OCR. Cloud OCR remains the existing settings path (`OCRSettings.tsx`), user-initiated.

### 6. Permissions and purpose strings

**Source of truth:** `scripts/ios-overrides/privacy-manifest.json` (Change C contract: "Never edit `src-tauri/gen/apple` directly"). Update `NSCameraUsageDescription` to cover:

- Sync QR codes (existing)
- Scanning documents into the library (new)
- Images stored in the on-device library; not uploaded unless the user uses a cloud feature that is separately disclosed

Request camera **when the user taps Scan**, not at launch.

**Photos:** use PHPicker so we typically **do not** add `NSPhotoLibraryUsageDescription`. If implementation is forced to `UIImagePickerController` with library access, add a purpose string in the same JSON and this change's tasks. Do not claim "we never access photos" if photo import exists.

QR scanning code paths must keep working with the new camera string (broader, not narrower).

### 7. Optional AI enrichment

After import, offer the same actions as other documents: Smart Tag, Summarize, Learn this — `runTask` with untrusted containment. Default: **do not** enqueue `useSmartTaggingQueueStore` automatically unless the user already enabled import-time tagging for **all** imports (honor existing global setting if one exists; do not add a Vision-only auto-AI).

### 8. Coexistence

| Path | Behavior |
|---|---|
| Share sheet PDF/image | Unchanged drain in `shareTarget.ts`; images **may** later call `apple_vision_recognize_document` as an enhancement behind the same capability, but v1 can leave share as "import file" and let the user open Scan for camera. If share images are cheap to recognize on-device, optional: run recognition **without** blocking import on failure. |
| PDF | Existing importer; do not force Vision on every PDF page in v1 (cost/battery). |
| Tesseract / cloud OCR | Settings remain; Vision scan is a separate import source. |
| Android | No new sources; ML Kit OCR labels unchanged. |

### 9. Concurrency and cancel

D-Apple-14: at most one Vision batch (or Speech, or FM). Scanner UI cancel → `Cancelled`, no document row (or delete a pre-created draft). Bad image (decode fail, empty file): `OCRFailed` / `VisionUnavailable`, picker error banner (`EnhancedFilePicker` already has `error` state).

### 10. Testing

- Vitest: picker filters sources by capability; Android/desktop hide scan/photo; mapper titles/lists/tables; no-text still creates image asset; cancel; oversized reject; fake plugin.
- Fixture images under `src/lib/ai/__fixtures__/vision/` : printed paragraph, table, list, blank/noise, corrupt bytes.
- `platformCapabilities.test.ts`: new ids iOS true (or runtime — registry may be "available on ios" with native status doing the 26+ check). Do not flip desktop/Android snapshot for unrelated ids.
- Manual: document camera, multi-page, permission deny, occlusion opens the stored image.

## Risks

- Purpose-string mismatch → App Review rejection if we capture photos while QR-only copy remains.
- Editing `EnhancedFilePicker` / `documents.tsx` conflicts with other import work — keep the switch exhaustive.
- Storing huge camera images in SQLite BLOBs (`image_assets.content`) — bound dimensions/JPEG quality before ingest (repository already has byte_size).
- Treating barcodes as documents accidentally — render as text, don't navigate away.
- Unguarded iOS 26 types vs deployment target 14.
