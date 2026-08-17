## Why

A full deepsec/ZCode security audit (report at `.deepsec/zcode/reports/security-audit.md`, run 2026-08-17) confirmed 24 exploitable vulnerabilities: 12 HIGH, 9 MEDIUM, 3 LOW. The two dominant chains are (1) webview XSS that escalates to full desktop compromise because the main webview holds unscoped file-write, shell-open, and all 661 IPC commands, and (2) IPC commands that read/write/delete arbitrary filesystem paths with no confinement. A malicious RSS feed, PDF, EPUB, proxied webpage, or compromised webview can each achieve code execution or data theft today.

## What Changes

- **Frontend XSS hardening**: sanitize or escape every raw-HTML sink (extract dialog, PDF text-layer highlight rewrites, search excerpts, three `htmlToText` helpers, reader-view links, PWA EPUB import, OCR/HTML srcdoc iframes, extension-bridge toast). No behavior change for legitimate content.
- **IPC filesystem confinement**: all file-taking commands (reads, staged-import appends, exports/downloads, transcription-model delete, backup restore) must constrain paths to app data roots or backend-verified dialog grants; ids used in path joins are validated as opaque tokens.
- **Process spawn hardening**: yt-dlp invocations pass the URL after a `--` separator with http(s) validation; OCR/GLM tool paths validated against known install locations; `glm_open_installer` restricted to backend-downloaded files; MCP server configs require explicit user confirmation and restrict interpreter args.
- **Local server origin enforcement**: the browser-sync CORS predicate drops `Origin: null` and wildcard localhost ports; unauthenticated endpoints gain Origin/Host middleware checks and rate limiting; the automation key becomes CSPRNG-generated with constant-time comparison.
- **Outbound fetch guard completeness**: `validate_url_not_private` gains DNS resolution, IPv4-mapped-IPv6 rejection, and per-redirect-hop re-validation; the podcast module adopts it; `fetch_readable_content` adopts it; the Vercel transcript function validates `videoId` on every branch.
- **Secret hygiene**: the transcript `?status=true` endpoint stops reflecting proxy/VPS configuration; `get_automation_api_key` and Groq-key transit stop returning secrets to the webview (masked previews or backend-side usage only).
- **Capability scoping**: the `localhost:15173` remote-URL grant is removed from the production capability; `localhost:9527` is retained (load-bearing for the plugin-localhost frontend) but its port-hijack exposure is documented and mitigated by an Origin allowlist at the plugin layer where possible.

No user-facing features are removed. **BREAKING** only for malicious inputs: paths that escape app dirs, URLs that target private networks, and payloads containing executable markup now fail closed with typed errors.

## Capabilities

### New Capabilities
- `webview-content-isolation`: every raw-HTML render site in the app webview/PWA sanitizes or escapes remote-influenced content before assignment; sandboxed document iframes never combine `allow-same-origin` with `allow-scripts`.
- `ipc-filesystem-confinement`: Tauri commands that accept paths or ids resolved to filesystem locations confine operations to app data roots or backend-recorded user grants, and never expose arbitrary file contents over IPC.
- `process-spawn-hardening`: all child-process spawns from IPC-reachable code use fixed binaries or validated/confirmed paths, argv-safe argument passing, and end-of-options separators for tools with option parsing.
- `loopback-server-auth`: local HTTP servers (browser sync) validate Origin/Host on every unauthenticated route, never reflect `Origin: null`, rate-limit unauthenticated endpoints, and use CSPRNG tokens with constant-time comparison.
- `outbound-fetch-guard`: every URL-fetching code path (Rust backend, Vercel functions, enrichment pipelines) validates destinations against private networks before the initial request and after each redirect hop.
- `secret-hygiene`: secrets (provider API keys, automation keys, proxy credentials) are never reflected in HTTP responses, logs, or IPC returns to the webview.

### Modified Capabilities

(none — no existing spec's requirement behavior changes; all fixes are hardening within existing feature behavior)

## Impact

- **Frontend**: `src/components/tabs/WebBrowserTab.tsx`, `src/components/viewer/PDFViewer.tsx`, `src/components/search/{GlobalSearch,CommandCenter,SearchUtils}.tsx`, `src/components/media/RSSScrollMode.tsx`, `src/pages/QueueScrollPage.tsx`, `src/components/review/ScrollModeArticleEditor.tsx`, `src/components/viewer/DocumentViewer.tsx`, `src/lib/{browser-backend,extension-bridge,webview-extract-bridge}.ts`, `src/utils/documentImport.ts`.
- **Rust backend**: `src-tauri/src/commands/{document,podcast,learning_item,ocr,ocr_runtime,mcp,secure_storage,video,image_registry,cloud/backup,anna_archive,transcription_config}.rs`, `src-tauri/src/{youtube,anki,kindle_clippings,security,browser_sync_server,processor/pdf}.rs`, `src-tauri/src/transcription/model_manager.rs`, `src-tauri/src/backup/manager.rs`.
- **Serverless**: `api/youtube/transcript.py`.
- **Config**: `src-tauri/capabilities/default.json`.
- **Regression risk controls**: golden-file rendering tests for sanitized views, round-trip import/export tests for confined path commands, e2e smoke for browser-extension save/AI-podcast flows, and the existing `npm run bench:check` + unit suites gate every task group.
