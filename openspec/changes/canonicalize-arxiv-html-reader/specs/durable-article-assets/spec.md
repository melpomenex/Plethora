## Durable article assets (amendment)

Imported canonical article images MUST become Plethora-managed resources, not remote hotlinks.

### Requirements

- After extraction and sanitization, `ingestArticleAssets()` discovers `<img>` sources, fetches bytes through SSRF-guarded infrastructure, deduplicates by content hash, and rewrites `src` to `plethora-asset://{id}` logical URLs.
- Persisted HTML references logical asset IDs only — never raw filesystem paths.
- Canonical reader preparation resolves `plethora-asset:` URLs to platform render URLs (`data:` from registry) for offline display.
- `webImportPreserveImages=false` skips download; captions and figure structure remain.
- Asset diagnostics (`discovered`, `imported`, `reused`, `failed`, `rejected`, `totalBytes`) are recorded in import diagnostics and provenance.
- Partial failure is non-fatal: unavailable figures degrade gracefully with captions preserved.
- Legacy arXiv HTML (no `metadata.webArticle`) continues using remote URL resolution.
- Eligible legacy documents may be explicitly re-imported through the canonical pipeline (network required).

### Security

- Reuse Rust `ingest_remote_image_asset` SSRF guard on native; mirror private-address blocking in browser fetch path.
- SVG sanitized at ingest (existing registry path).
- Enforce per-asset and aggregate byte limits, MIME validation, redirect limits, bounded concurrency.

### Build parity

- Production Tauri bundles MUST include the same canonical reader and asset resolution code paths as `tauri dev` (verified by runtime-target regression tests).
