# Design: Scan-to-Plethora

## Native APIs

- Document Scanner: `com.google.android.gms:play-services-mlkit-document-scanner:16.0.0` (docs) — Play Services UI, ~300 KB, first-use download. https://developers.google.com/ml-kit/vision/doc-scanner/android
- Text Recognition v2: bundled Latin already; add CJK/Devanagari deps as **on-demand or additional AARs**, not all at once if size hurts.
- Structure: blocks/lines/elements — Plethora concatenates with newlines; table detection is **best-effort / out of v1 guarantee**.

## Architecture

```text
GmsDocumentScanning → page JPEGs
  → image registry asset ids (canonical storage)
  → OCR → document body + page→asset map in metadata
  → optional user “Enrich” (tags/summary/cards via existing tasks)
```

Scanner functionality ≠ OCR ≠ handwriting ≠ GenAI description.

## Privacy

On-device scan/OCR. No upload. Temp scanner URIs copied then deleted.

## Background

Scanner is interactive. OCR of saved pages can continue unless OS kills; not GenAI-foreground-bound.

## Permissions

CAMERA at scan time. No broad storage.

## Security

Validate page count, dimensions, MIME. Copy into app storage; do not index arbitrary content URIs long-term.

## Accessibility

Scanner is Google UI; document result is standard reader. Alt text optional via B.

## Tests

FakeVisionProvider. Do not require a camera in CI. Permission denied path. OCR fixture images in JVM/instrumented tests (existing `OcrImageLabelsInstrumentedTest` pattern).

## Image occlusion

Architecture stores page assets so a later pass can suggest regions; v1 does not auto-create occlusion cards.
