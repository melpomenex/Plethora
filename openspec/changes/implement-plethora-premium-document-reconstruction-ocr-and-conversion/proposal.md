# Change: Implement Plethora Premium Document Reconstruction, OCR, and Conversion

> Wave 3 — Cloud Capabilities. Hard-depends on proposals 2 + 5 (capability gate + job framework). Capability: `cloud_document_processing`. **Builds directly on the existing local PDF canonical-reflow pipeline — no duplicate reflow system.**

## Why

Terrible scanned PDFs, image-only documents, malformed academic papers, multi-column textbooks, complex tables, equations, and diagrams defeat local extraction today. Pro cloud processing converts them into high-quality **semantic Plethora documents** — reflowable, selectable, highlightable, AI-ready, TTS-ready, extractable — instead of leaving users with a rasterized page viewer.

## What exists today (the local foundation this extends)
- **PDF canonical reflow pipeline** (`src-tauri/src/pdf/`): hybrid raster+pdf.js-text analysis producing `PdfCanonicalPage/Block/Line/Word` with roles/classification/direction, `PdfTableData`, versioned schema + engine, page caches, OCR integration points, graphical fallback builder; commands `pdf_reflow_*` (per-page semaphore, 10s timeout), selection resolution to word anchors. Frontend renderers (`PdfCanonicalReflowRenderer`, analyzer/cache/scheduler).
- **OCR providers**: Tesseract (local, word geometry), Mistral OCR (cloud, BYO key), GLM-OCR (local runtime), Nougat (math, managed runtime); `ocr_pdf_file` embeds text layers via lopdf; provider config system.
- **Segmentation**: `DocumentSegmenter` (semantic/paragraph/fixed/smart) feeding extracts and the semantic index (7).
- **Ingestion**: `processor/` (pdf/epub/html/markdown/audio), content hashing, dedup.
- **Quota/pricing precedents**: `ModelPricing`, per-page accounting patterns; transcription job queue (retry/cancel/priority) as the local job UX model.

## What Changes

### 1. Cloud reconstruction job (`document_reconstruct` kind on proposal-5 framework)
- Input: document ref + page range (or full), options `{ target: canonical_json | semantic_doc, quality: fast | thorough, preserve_images, ocr_lang }`.
- Pipeline (server-side, provider-agnostic stages): page raster upload → OCR (best-available provider incl. Mistral-class vision models) → layout analysis (columns/reading order/headers/footers/footnotes) → structure mapping into **the existing canonical reflow schema** (`PDF_CANONICAL_SCHEMA_VERSION` — the output is *the same format the local renderer already consumes*, versioned; new fields additive) → figure/table/equation extraction (crop assets via existing asset mechanism; tables as `PdfTableData`; equations as LaTeX/MathML for the existing KaTeX rendering) → semantic chunking hints for 7's indexer.
- Progress per page; cancellable checkpoints; partial results retained (completed pages usable); resumable from last page.
- Output stored as artifacts (proposal-5 object storage) → downloaded into the local reflow cache (`pdf_reflow_put_page`/`put_asset` write path) so rendering, selection, highlighting, TTS, and extraction all work through existing code. **The cloud replaces the analysis engine, not the document model.**

### 2. Local integration
- "Improve this document" surface in the PDF reader (per-document or page-range), with before/after preview (original raster vs reconstructed reflow side-by-side) and accept/keep-original toggle per document (original file never destroyed; reconstruction is an overlay, reversible).
- Automatic suggestions: when local extraction quality is poor (existing signals: low text coverage, graphical-fallback usage, OCR-confidence thresholds), surface a non-intrusive offer (respecting calm-UX rules).
- Reconstruction status in document metadata; re-runs versioned.

### 3. Scope of formats
- PDF (primary). Image sets (multi-image documents via existing image pipeline), malformed HTML/academic papers (structure repair) as follow-on kinds if cheap on the same pipeline; EPUB *repair* explicitly out of scope v1.

### 4. Quotas & cost
- Unit = pages processed; monthly envelope (`cloud_document_processing`); pre-flight estimate (pages × quality tier) shown before running with clear "cloud compute" disclosure; AI-exclusion-flagged documents are ineligible (enforced).

### 5. Privacy
- Page rasters + OCR text leave the device when the job runs (disclosed in the pre-run dialog + settings); retention: artifacts TTL'd (default 7 days) then deleted; no content in logs (framework rule); provider identities disclosed per deployment.

## Impact

### Affected Specs
- `cloud-document-reconstruction` — New (job contract, schema compatibility, reversibility, quotas, privacy).

### Affected Code Areas
- Server: `document_reconstruct` job kind + stage providers (OCR/layout/structure) on `ProviderRegistry`. App: `src/components/viewer/pdf/` overlay UI, `api/pdfReflow.ts` extensions (cloud results write-through), document metadata fields, i18n. No changes to canonical schema consumers beyond additive fields.

### Non-goals
- No replacement of the local reflow engine (cloud complements it), no generic "PDF to EPUB export" productization v1, no handwriting recognition, no training on user documents (explicit).

## Dependencies

### Hard dependencies
- 5 (job framework, storage, quotas), 2 (capability).

### Soft dependencies
- 7 (semantic chunk hints consumed post-reconstruction for reindexing).

### May run concurrently
- 17, 18, 19, 20 (disjoint job kinds on shared framework).

### Must not start yet
- —.

## Shared interfaces
- `document_reconstruct` job kind registration (schema/options/progress/result contract); canonical-schema additive-version policy (owned by the reflow subsystem — changes coordinated here as consumer); overlay metadata fields on documents.

## Ownership boundaries
- **May modify**: new job kind + server stage providers, PDF viewer overlay UI, `api/pdfReflow.ts` cloud write-through, document metadata additions.
- **Must treat as external**: canonical schema semantics + local renderer (additive fields only, coordinated), job framework internals, quota mechanics.

## Collision risks
- `commands/pdf_reflow.rs` + cache layer (additive cloud write path; the local pipeline files are high-churn — restrict to clearly separated modules); migration numbering (document metadata columns).

## Integration contract
- Result artifacts conform to `PDF_CANONICAL_SCHEMA_VERSION(+additive)`; retrieval uses signed URLs from proposal 5; completion triggers reindex hint event (7).

## Testing & acceptance

### Tests
- Pipeline stage tests with fixture PDFs (scanned two-column, table-heavy, equation page, image-only) → structural expectations (reading order, table extraction, equation LaTeX, figure placement) with golden outputs per engine version.
- Schema compatibility: reconstructed pages render + select + highlight through the existing renderer (visual spec extension of `src/visual/pdf-reflow` with new fixtures); word anchors resolve.
- Job lifecycle: partial failure mid-document resumes; cancel preserves completed pages; quota pre-flight estimate accuracy.
- Overlay reversibility: keep-original/accept toggles; original file integrity (hash unchanged).
- Privacy: logs/content scans on server fixtures; exclusion-flag enforcement; artifact TTL deletion test.

### Acceptance criteria
- A terrible scanned fixture PDF becomes a reflowable, highlightable, extractable document through the cloud path with page-level progress, quota accounting, and reversibility; local-only users keep today's behavior unchanged.

### Must remain unchanged
- Local reflow behavior for documents not reconstructed; existing PDF benches/visual baselines.

## Open questions
1. Default quality tier mapping to providers (fast vs thorough pricing) — config-level.
2. Artifact TTL default (7 days) and whether reconstructed overlays sync (6) as binaries (default: yes, as opt-in document binaries).
3. Whether reconstruction counts pages or "complexity units" for quota (v1: pages).
