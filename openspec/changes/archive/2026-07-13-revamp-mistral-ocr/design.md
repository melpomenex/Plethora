## Context

Incrementum handles OCR on documents via local (Tesseract, Marker, Nougat, GLM-OCR) and cloud (Google Document AI, AWS Textract, Azure Vision) engines. Mistral AI has introduced a high-fidelity cloud OCR API under the `mistral-ocr-latest` model. This design describes how to add Mistral as a first-class OCR provider, process files through Mistral's multipart file upload and OCR API, convert the output markdown to HTML on the Rust backend, and clean up uploaded files.

## Goals / Non-Goals

**Goals:**
- Add `Mistral` as an OCR provider in the Rust backend and TypeScript frontend settings.
- Implement the two-step file-upload and OCR execution flow via Mistral's API endpoints.
- Parse returned Markdown pages and compile them into a single clean HTML page using `pulldown-cmark`.
- Ensure temporary files uploaded to Mistral are deleted via the API after OCR completion.
- Support Mistral OCR API Key configuration in the settings UI.

**Non-Goals:**
- Creating local vision language models for offline OCR.
- Caching OCR files in the cloud (all cloud storage is temporary and deleted immediately).

## Decisions

### Decision 1: Multipart upload and automatic deletion for privacy
Mistral's OCR API requires documents to be uploaded first using `POST /v1/files`, returning a `file_id` which is then passed to `POST /v1/ocr`. To respect user privacy, we will perform a `DELETE /v1/files/{file_id}` immediately after receiving the OCR response (or if the OCR process fails).
*Alternatives considered:* Keeping files on Mistral storage. Rejected because storing user documents in the cloud indefinitely violates privacy expectations.

### Decision 2: Backend Markdown-to-HTML conversion via `pulldown-cmark`
Mistral OCR returns pages with Markdown content. By adding the `pulldown-cmark` crate to our Rust backend, we can convert Markdown to HTML directly. The backend will return format `"html"` and the rendered HTML string as the result content.
*Alternatives considered:* Returning raw Markdown and letting the frontend render it. Rejected because the Document Viewer already features a highly optimized HTML display mode using an iframe, which supports precise text selection, custom fonts, and annotations.

### Decision 3: Extending the OCR Configuration Scheme
We will introduce `Mistral` to the `OCRProviderType` enum and add a `mistral_ocr` config field to `OCRConfig`.
In TypeScript:
- Store it in `settings.documents.ocr.mistralApiKey` (or similar pattern to other cloud keys).
- Add `mistral` to the `provider` union types.

## Risks / Trade-offs

- **[Risk] Orphaned Files on Mistral Cloud** -> If the Rust thread panics or the app is killed mid-OCR, the uploaded file may remain on Mistral's servers.
  - *Mitigation:* Ensure the deletion logic is executed in a block where drop-handlers or standard result-matching will trigger `DELETE` even on processing errors.
- **[Risk] High Network Latency/Timeout** -> Large PDF files uploaded over slow connections might cause timeouts.
  - *Mitigation:* Set appropriate client timeouts on `reqwest` client configuration and show progress or clear error messages to the user.
