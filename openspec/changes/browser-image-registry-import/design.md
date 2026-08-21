## Context

Plethora has an Image Registry (`image_assets` table in SQLite, `src/api/image-registry.ts`, and `src/components/image-registry`) that stores reusable visual assets for flashcards and notes. Plethora also has a browser extension (`browser_extension/`) connecting via HTTP on `127.0.0.1:8766` to `src-tauri/src/browser_sync_server.rs` and a smart tagging pipeline (`src/lib/smartTagging/` and `src-tauri/src/ai/smart_tagging/`).

Currently, the extension does not offer a direct context-menu capture flow for images into the Image Registry. When users find diagrams or illustrations while browsing, they must download them manually and re-upload through Plethora's desktop UI. Furthermore, web images often use dynamic formats (`srcset`, `<picture>`, canvas renders, authenticated CDN endpoints, CSS backgrounds) that cannot be fetched simply by passing a URL to the backend.

## Goals / Non-Goals

**Goals:**
- Provide a single right-click "Save Image to Plethora" context menu action in the browser extension.
- Robustly extract image data directly in the page DOM context (handling `srcset`, `<picture>`, `canvas`, blob/data URLs, and authenticated CORS endpoints).
- Collect rich provenance metadata (source URL, page title, alt text, caption, domain, dimensions, timestamp).
- Handle ingestion in `src-tauri/src/browser_sync_server.rs` with SHA-256 deduplication and safety verification (MIME checks, SVG script sanitization, decompression bomb guards).
- Integrate with Plethora's smart tagging system using deterministic keyword/domain signatures offline with optional LLM refinement.
- Provide non-intrusive toast confirmation with applied tags and offline queueing in `chrome.storage.local`.

**Non-Goals:**
- Heavy image manipulation / editing tools in the browser extension popup.
- Synchronizing arbitrary non-image binaries or arbitrary web page DOM snapshots.
- Mandating cloud LLM calls for tagging.

## Decisions

### 1. In-Page DOM/Canvas Extraction vs Backend Remote Fetching
- **Decision**: Extract image data primarily within the content script using canvas export (`toBlob()` / `toDataURL()`) or authenticated page-context `fetch()`, falling back to backend remote URL fetch only if needed.
- **Rationale**: Many high-value web diagrams are behind authentication cookies, rendered dynamically via WebGL/Canvas, or protected by strict CORS headers that an external backend HTTP client cannot fetch. Executing extraction in the page context guarantees what the user sees is what gets saved.
- **Alternatives Considered**:
  - *Backend URL download only (`ingest_remote_image_asset`)*: Rejected because it fails on private sessions, paywalled portals, intranet pages, dynamic canvas diagrams, and blob URLs.
  - *Sending screenshot bounding boxes*: Rejected because bitmap screen captures have lower resolution than the original source asset bitmap.

### 2. SHA-256 Deduplication & Idempotent Ingest
- **Decision**: Compute SHA-256 hash in Rust on decoded image bytes and check against `image_assets.sha256`. If already saved, return the existing asset record with `is_duplicate: true` and update references/provenance without allocating duplicate blob storage.
- **Rationale**: Prevents accidental library bloat when users repeatedly save diagrams or clip multiple notes from the same page.

### 3. SVG Sanitization and Decompression Safeguards
- **Decision**: For raster images (`png`, `jpeg`, `webp`, `gif`, `avif`), enforce 10 MB payload limits and verify dimensions do not exceed 16,384 x 16,384. For SVGs, parse XML and strip `<script>`, inline event handlers (`onload`, `onerror`), and external DOCTYPE entity references before saving, or safely render to PNG.
- **Rationale**: Prevents XSS attacks and memory exhaustion from malicious vector files or zip/image bombs.

### 4. Smart Tagging Pipeline Integration
- **Decision**: Ingested image assets populate a `BrowserCaptureContext` with page title, alt text, caption, and domain. The existing `queued_browser_organization` in `src-tauri/src/browser_sync_server.rs` processes the metadata against user tag signatures deterministically, queuing for optional LLM refinement.
- **Rationale**: High-quality organization happens automatically with zero extra user clicks, respecting user privacy and local-first principles.

## Risks / Trade-offs

- [Risk] Memory overhead when base64-encoding large images in browser extension. -> Mitigation: Impose strict client-side budget check (`shared.checkRequestBudget`) and 7 MB decoded cap (mirrored in `shared.TRANSPORT_LIMITS`).
- [Risk] Ephemeral connection drops when browser extension attempts to send payload. -> Mitigation: Persist un-sent image payloads in `chrome.storage.local` under `pendingImageImports` and drain queue on service worker startup or reconnect.
- [Risk] Tainted canvas errors on cross-origin images without CORS headers. -> Mitigation: Content script catches tainted canvas errors and falls back to passing the validated source URL to backend `ingest_remote_image_asset` with referrer headers.

## Migration Plan

1. Update `browser_extension/manifest.json` and `browser_extension/background.js` to register `contextMenus` on `image`.
2. Add image DOM extractor helper in `browser_extension/content.js` with `canvas` fallback and provenance collection.
3. Add `POST /api/image-registry/ingest` route and handler in `src-tauri/src/browser_sync_server.rs`.
4. Wire SVG sanitization and SHA-256 dedup in `src-tauri/src/commands/image_registry.rs`.
5. Connect smart tagging metadata pipeline in `src/lib/smartTagging/browserImportOrganization.ts`.
6. Add in-page feedback toast in `browser_extension/content.js`.

## Open Questions

- None blocking. Support for webp/avif is handled by the existing Rust `image` crate.
