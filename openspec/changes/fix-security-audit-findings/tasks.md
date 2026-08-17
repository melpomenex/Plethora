## 1. Shared security primitives (no behavior change yet)

- [ ] 1.1 Create `src/utils/sanitizeHtml.ts` exporting `sanitizeHtmlFragment` (DOMPurify wrapper with URI-scheme restrictions and handler stripping) and `escapeHtmlPreservingMarks(text, matches)`; unit tests covering script/handler/`javascript:`-href stripping and legit-content passthrough
- [ ] 1.2 Create shared `htmlToPlainText` (DOMParser-based) in `src/utils/`; unit tests asserting no subresource fetches are initiated (no `img` fetch for `src=x`) and text extraction matches the old helpers on a benign corpus
- [ ] 1.3 Create `src-tauri/src/security_paths.rs` with the `GrantRegistry` (app roots + dialog-recorded grants + membership checks via canonicalize-then-contain) and unit tests for traversal, symlink, and case variants
- [ ] 1.4 Upgrade `validate_url_not_private` in `src-tauri/src/security.rs`: DNS resolution with all-IP validation, IPv4-mapped-IPv6 rejection, 60s resolution cache; extract a shared `PrivateNetworkRedirectPolicy` from `web_proxy.rs`; unit tests for mapped-IPv6, resolving-name→private-IP, and per-hop redirects
- [ ] 1.5 Add `subtle` (constant-time compare) dependency if not present; add typed error variants for confinement/guard failures surfaced to the frontend

## 2. Frontend XSS fixes (closes the 8 webview/PWA findings)

- [ ] 2.1 `WebBrowserTab.tsx`: sanitize `extract.htmlContent` at the render sink and before persisting; sanitize stored extracts on read; add a rendering test with a hostile bridge payload asserting no execution and legit-selection equivalence
- [ ] 2.2 `PDFViewer.tsx`: escape text-layer text at the three `innerHTML` re-interpolation sites (search/TTS/jump); golden range tests proving identical `<mark>` placement on benign PDFs and inertness for markup-glyph PDFs
- [ ] 2.3 `SearchUtils.tsx` + `CommandCenter.tsx`: escape before `<mark>` insertion across excerpt builders; stop entity-decoding stored HTML into excerpts (`getHtmlText`); tests with stored `<img onerror>` content asserting inert excerpts
- [ ] 2.4 Replace the three detached-`innerHTML` helpers (`RSSScrollMode.tsx`, `QueueScrollPage.tsx`, `ScrollModeArticleEditor.tsx`) with the shared `htmlToPlainText`; tests for feed-content payloads and mount-time editor path
- [ ] 2.5 Reader view: `preventDefault()` before scheme early-return in `handleReaderLinkClick`; neutralize `javascript:`/non-image `data:` hrefs in `processHtmlContent` (`documentImport.ts`); click tests
- [ ] 2.6 `DocumentViewer.tsx`: drop `allow-same-origin` from both srcdoc iframe sites; route OCR-fallback output through the shared sanitizer; test that frame scripts cannot reach `parent.__TAURI_INTERNALS__`
- [ ] 2.7 `extension-bridge.ts` toast and any `useHapticFeedback`-style icon injection: switch to `textContent`/static markup; test hostile page title
- [ ] 2.8 `browser-backend.ts` PWA EPUB path: parse chapters with `DOMParser` (shared helper); e2e PWA import smoke for a benign and a hostile EPUB

## 3. IPC filesystem confinement (closes append/write/read/delete findings)

- [ ] 3.1 `append_import_file_chunk`: validate `staged_path` through the `GrantRegistry` against the staging dir; migrate the staged-import contract to opaque tokens keyed server-side (frontend updated in lockstep); tests for `~/.zshrc` rejection and happy-path mobile import
- [ ] 3.2 Export commands (`export_mnemosyne`, `export_deck_as_apkg/csv`, `save_pdf_as_html`, `download_book`, `download_youtube_video`): record dialog-chosen destinations in the registry and enforce containment; e2e smoke for each export flow writing to a user-picked directory
- [ ] 3.3 Read commands (`read_document_file`, `hash_document_file`, `read_file_bytes`, kindle clippings, OCR/image ingest): enforce confinement incl. media-server grants; tests reading `~/.ssh` paths fail closed
- [ ] 3.4 `download_podcast_episode`: server-generated filename id + audio-extension allowlist + guard on `audio_url`; test traversal id/media-type rejection and a benign download
- [ ] 3.5 `delete_transcription_model`: apply the download-time profile allowlist (reject ids with separators); `backup_restore`: restrict `backup_id` to `^[A-Za-z0-9_-]+$`; tests for `..`-traversal ids failing closed
- [ ] 3.6 `create_document` + `media_server`/`epub_server`: grant streaming for the exact canonical registered file only; test sibling/parent paths refused

## 4. Process spawn hardening (closes yt-dlp injection + configurable binaries)

- [ ] 4.1 `youtube.rs`: validate `http(s)://` URL with host, reject leading `-`, insert `--` before the URL in every yt-dlp argv (`--get-filename`, info, download); tests for `--exec=...` rejection and normal download
- [ ] 4.2 Constrain `output_template` to filename-only (no separators/`..`); unit test
- [ ] 4.3 OCR/GLM paths: validate configured `tesseract_path`/`nougat_path`/`marker_path`/`ollama_path` against known install roots or dialog-recorded grants; `glm_open_installer` restricted to the backend-recorded download path; tests for `/tmp/evil.sh` rejection and existing custom-install configs still accepted (documented locations)
- [ ] 4.4 MCP: add user-confirmation gate before first spawn of a newly added server (pending state + UI prompt); reject `-e/-c/--eval` args in `validate_mcp_command`; tests for both

## 5. Loopback server + origin enforcement (closes CORS Origin:null + key findings)

- [ ] 5.1 `browser_sync_server.rs` CORS: remove `Origin: null` and wildcard localhost-port arms; allowlist exact app origins + exact shipped extension id (read from the extension manifest at build time)
- [ ] 5.2 Add Origin/Host enforcement middleware in front of `require_api_key` for unauthenticated routes (no-Origin passes; Host must be the loopback host:port); tests for cross-site origin rejection, extension-origin pass, and no-Origin pass
- [ ] 5.3 Rate-limit unauthenticated endpoints (per-source token bucket, `429` + `Retry-After`); test burst throttling
- [ ] 5.4 Automation key: backend `OsRng` generation, constant-time compare, rotate on version upgrade, one-time extension re-pair notice; frontend `browser-backend.ts` stops generating the key (`Math.random` path removed — also closes the LOW randomness finding)
- [ ] 5.5 Decide and implement `/api/podcast/search` posture (key-required vs public-behind-Origin; per design open question) with the extension flow verified either way
- [ ] 5.6 `fetch_readable_content`: apply the upgraded guard at entry; test private-URL enrichment refused, benign URL enrichment works
- [ ] 5.7 e2e smoke: extension save-page + AI-podcast flows against the running server with the new origin rules

## 6. Outbound fetch guard coverage (closes podcast SSRF + guard bypass)

- [ ] 6.1 Podcast module: apply guard + shared redirect policy to subscribe/refresh/resolve/download/transcribe fetches; tests for `169.254.169.254` and LAN feed/enclosure URLs rejected, benign feed works
- [ ] 6.2 Document/article fetch paths (`fetch_url_content`, `fetch_web_page_preview`, `download_with_caps`): swap to the shared redirect policy; test public-URL→LAN-redirect refused
- [ ] 6.3 Confirm RSS/image-registry paths pick up the upgraded guard semantics (they already call it) and add regression tests for mapped-IPv6 and resolving names

## 7. Secret hygiene (closes status-endpoint leak + IPC secrets findings)

- [ ] 7.1 `api/youtube/transcript.py`: reduce `?status=true` to booleans (drop `proxy_preview` and `vps_service.url`); validate `videoId` charset on every branch before URL construction; tests for both
- [ ] 7.2 `get_automation_api_key` IPC returns masked preview; full key only shown in a user-initiated settings flow; `transcribe_podcast_groq_chunks` reads the Groq key backend-side via provider reference; keychain `secure_storage_get` masked-preview contract; IPC tests asserting no plaintext key crosses
- [ ] 7.3 Sweep for other secret-reflection sites flagged in the audit report's evidence lists (e.g. remaining `Bearer ${apiKey}` display paths) and confirm none render into logs/HTML

## 8. Capability scoping (closes dev-origin capability finding)

- [ ] 8.1 Remove `localhost/127.0.0.1:15173` remote grants from `capabilities/default.json`; add dev-only capability file wired for `tauri dev`; verify dev-mode IPC works and release builds exclude it
- [ ] 8.2 Narrow remaining `9527` grant's plugin permissions to the minimum set; add startup check that refuses to navigate to the plugin-localhost port when another process holds it; tests for both startup branches
- [ ] 8.3 Run `npm run tauri build` and confirm the shipped capability contains only production origins

## 9. Regression gates and verification

- [ ] 9.1 Golden-file rendering corpus: capture sanitized output for representative RSS articles, extracts, EPUB chapters, PDFs, and reader pages; assert legit content equivalence (minus handlers/scripts) across the change
- [ ] 9.2 Full unit + script test suites pass (`npm run test`, `npm run test:scripts`) and `npm run bench:check` reports no regressions beyond baseline tolerance (update `scripts/perf-baselines.json` in-commit if sanitizer/guard paths legitimately shift, with justification)
- [ ] 9.3 e2e smoke matrix green: browser-extension save + extract, AI podcast process, PDF search/TTS, EPUB/PDF/HTML import, all exports, MCP add-server confirm flow, PWA import
- [ ] 9.4 Re-run the deterministic deepsec scan over the changed files and record in the change notes that each fixed finding's candidate no longer reproduces the confirmed attack path (spot re-verification of the CORS, extract-dialog, and append-chain chains)
- [ ] 9.5 Add a short security-notes section to the change archive documenting the residual accepted risks (9527 port hijack mitigations, podcast-search posture decision)
