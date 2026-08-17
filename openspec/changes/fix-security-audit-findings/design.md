## Context

The audit confirmed 24 vulnerabilities across four trust boundaries: the Tauri webview (XSS → IPC escalation), the IPC command surface (unconfined fs/process operations), loopback HTTP servers (CORS `Origin: null`), and outbound fetch paths (incomplete/bypassable SSRF guards). Full finding detail with file:line evidence and verifier-confirmed attack paths lives in `.deepsec/zcode/reports/security-audit.md`; this design references findings by their report titles.

Constraints:

- **No app regressions**: every fix must preserve the legitimate behavior users rely on — RSS rendering (with images/formatting), PDF search/TTS highlighting, in-app browsing + extract flow, EPUB/PDF/HTML imports, exports to user-chosen locations, podcast download/transcription, OCR/GLM/MCP integrations, browser-extension sync.
- The desktop app is single-user; the webview is the primary attack surface, and per Tauri's threat model IPC commands must not trust webview input.
- `localhost:9527` is load-bearing in production (tauri-plugin-localhost serves the frontend so YouTube iframe embeds work over `http://`); it cannot simply be deleted from capabilities.
- The staged-import, export, and download commands receive paths that originate from save dialogs on the happy path — confinement must keep that flow working.

## Goals / Non-Goals

**Goals:**

- Close all 24 confirmed findings with the smallest behavioral delta that is actually safe.
- Centralize the security primitives (sanitizers, path confinement, spawn policy, URL guard, origin checks) so fixes are consistent and auditable rather than 24 one-offs.
- Every fix ships with a regression test that fails on the vulnerability and passes on legitimate content.

**Non-Goals:**

- Redesigning the sync server auth model beyond origin enforcement + rate limiting (a pairing-token negotiation between app and extension is future work).
- Sandboxing or rewriting the webview content pipeline (Reader view, proxy browser stay as-is; only their sinks are hardened).
- Replacing the deprecated REST sync server or Vercel transcript function — harden in place.
- Browser-level mitigations we don't control (Chrome PNA, WebKit javascript: handling).

## Decisions

**D1 — One shared sanitizer module for raw-HTML sinks (frontend).**
Add `src/utils/sanitizeHtml.ts` exporting `sanitizeHtmlFragment` (DOMPurify with `FORBID_TAGS: [style, form, ...]`, `FORBID_ATTR: ['onerror', ...]` via DOMPurify's hook set, and `ALLOWED_URI_REGEXP` that admits `http/https/mailto/tel/data:image` only) plus `escapeHtmlPreservingMarks(text, markRanges)` for the PDF/GlobalSearch text re-interpolation sites. Why one module: the audit showed the codebase already has both a correct DOMPurify wrapper (`RichContentRenderer.sanitizeHtml`) and several ad-hoc "sanitizers" (detached innerHTML, regex tag-strip, script-tag removal) — the bugs live in the ad-hoc ones. Alternative rejected: fixing each sink locally — reintroduces the drift that caused 5 of the 8 XSS findings.

- Extract dialog (`WebBrowserTab.tsx:210`): sanitize at the sink and before persisting; stored extracts sanitized on read too (existing rows).
- PDF text layer (`PDFViewer.tsx:1027/1061/1111`): escape `textContent` before wrapping matches in `<mark>` (keep the existing `origHtml` restore path, which is already entity-safe). Alternative (TreeWalker DOM-range highlighting, as `MarkdownViewer` does) rejected for now: the escape approach is ~10 lines and testable against golden snapshots; TreeWalker is a larger refactor of three call sites.
- GlobalSearch/CommandCenter: `highlightSearchTerms` escapes the input then re-inserts `<mark>` markers (markers themselves are generated, not from input); `getHtmlText` stops entity-decoding into excerpts.
- Three `htmlToText` helpers → one shared `htmlToPlainText` using `DOMParser.parseFromString(html, 'text/html').body.textContent` (inert, no subresource fetches).
- Reader view: `preventDefault()` before the scheme check in `handleReaderLinkClick`; `processHtmlContent` neutralizes `javascript:`/`data:` (non-image) hrefs to `#`.
- srcdoc iframes (`DocumentViewer.tsx:7055/7492`): drop `allow-same-origin` (content keeps `allow-scripts` where needed); route ALL srcdoc content — including the OCR-fallback LLM output at 4875-4886 — through `sanitizeHtmlDocumentForIframe` upgraded to use the shared module (script-tag removal alone is insufficient).
- Extension-bridge toast + `useHapticFeedback` icon: `textContent` / static markup only.
- PWA EPUB import (`browser-backend.ts:95-99`): use the shared `htmlToPlainText`.

**D2 — Path confinement via a backend grant registry, not a prefix deny-list.**
New `src-tauri/src/security_paths.rs`: an in-process `GrantRegistry` (Mutex<HashSet<PathBuf>>) recording (a) app data roots always allowed, and (b) directories/files the user picked through a save/open dialog **as observed by the backend command that invoked the dialog**. Commands check `resolve_confined(path, kind)` which canonicalizes and requires containment in a grant. Apply to: `append_import_file_chunk` (also switch the staged-import contract to an opaque token keying server-side temp paths), export commands (`export_mnemosyne`, `export_deck_as_apkg/csv`, `save_pdf_as_html`, `download_book`, `download_youtube_video`), read commands (`read_document_file`, `read_file_bytes`, kindle/OCR/image ingest — reads additionally accept the media-server grant set), and destructive ids (`delete_transcription_model` validated against the existing profile allowlist; `backup_restore` id restricted to `^[A-Za-z0-9_-]+$`; `download_podcast_episode` filename becomes a generated opaque id with a fixed audio-extension allowlist). Why registry over simple prefix checks: exports must still write anywhere the user chose via the dialog — a static app-dir-only rule breaks the primary export flow (a regression). The dialog-observed grant keeps UX identical while making forged paths fail. Rollback-safe: registry is in-memory; failure mode is a typed error surfaced by the existing dialogs.

**D3 — Spawn policy: fixed argv discipline + path provenance.**
- yt-dlp: validate `url` parses as `http(s)` with a host, reject leading `-`, and insert `--` before the URL in every invocation (`--get-filename`, info extraction, download).
- OCR/GLM configurable binaries (`tesseract_path`, `nougat_path`, `marker_path`, `ollama_path`): keep configurability (users with custom installs depend on it) but require the path to resolve within a known set of parent directories (homebrew, /usr/local, /opt, cargo target dir, user-selected via backend file dialog recorded in D2's registry). `glm_open_installer` only opens paths the backend itself downloaded (compare against state.installer_path) — the arbitrary-path `open` goes away.
- MCP: keep the existing bare-command allowlist; add a user-confirmation dialog in the UI before `mcp_add_server` persists/spawns (mirrors how the app already asks before destructive actions), and reject `-e`/`-c`/`--eval`-style direct-code args in `validate_mcp_command`.
- `download_youtube_video`'s `-o` template: constrain to a filename template (no `/`, no `..`) since the output dir comes from D2.

**D4 — Loopback origin enforcement (browser sync).**
- CORS predicate: remove the `s == "null"` arm; replace wildcard `http://localhost:*`/`127.0.0.1:*` with the exact configured origins (app origin, plugin-localhost origin, and the shipped extension's `chrome-extension://<id>` read from the extension manifest at build time).
- Add an Origin-enforcement middleware (innermost, before `require_api_key`) on the unauthenticated endpoints: requests with an `Origin` header must be in the allowlist; requests with no `Origin` (non-browser local clients) are allowed; add `Host` validation (`127.0.0.1:<port>` or `localhost:<port>`) to close DNS rebinding.
- Rate-limit unauthenticated endpoints (token bucket per source, e.g. 30 req/min) — cheapest defense against the remaining residual surface.
- Automation key: generate with `OsRng` in the server itself (frontend stops generating it in `browser-backend.ts`), compare with `subtle::ConstantTimeEq`, rotate on version upgrade.
- `/api/podcast/search` loses its public exemption (requires the key) — verify the extension's podcast search flow can pass the key; if not, keep it public but behind the Origin middleware + rate limit.
- Keep the confirmed-gap `fetch_readable_content` fix here too: apply `validate_url_not_private` at its top (per D5's upgraded guard).

**D5 — One URL guard, applied everywhere, that actually resolves.**
Upgrade `validate_url_not_private` (security.rs): (1) resolve the host via `tokio::net::lookup_host` and validate ALL resulting IPs (refuse on any private/loopback/link-local/mapped address); (2) reject IPv4-mapped IPv6 explicitly; (3) extract the per-hop redirect re-validation from `web_proxy.rs` into a shared `PrivateNetworkRedirectPolicy` and use it in `download_with_caps`, `fetch_url_content`, `fetch_web_page_preview`, and the podcast clients (which today have NO guard — adopt it for feed and audio URLs). DNS-resolution is async and adds one lookup per fetch — acceptable for these interactive flows; caching resolver output for 60s avoids repeated lookups on batch imports. Alternative (connect via custom resolver in reqwest) rejected as a larger change to the HTTP stack.

**D6 — Secrets never cross the IPC/HTTP boundary in plaintext.**
- `api/youtube/transcript.py` `?status=true`: return booleans only (proxy configured, cookies received, vps configured) — drop `proxy_preview` and `vps_service.url`.
- `videoId` validated against `^[a-zA-Z0-9_-]{11}$` on every branch before URL construction.
- `get_automation_api_key` IPC command: returns a masked preview; the full key is only shown in a user-initiated settings flow that requires the app window (and the server compares tokens server-side, so the frontend never needs the raw key for its own requests).
- `transcribe_podcast_groq_chunks`: Groq key read backend-side from config (the frontend passes a provider reference, not the key). Keychain-backed `secure_storage_get` (opt-in today) additionally requires the masked-preview treatment.

**D7 — Capability scoping without breaking the plugin-localhost frontend.**
Remove `http://localhost:15173/*` + `127.0.0.1:15173` remote grants from `capabilities/default.json` (production binds nothing on 15173 — it is the Vite dev port; dev builds run against devUrl and can use a separate dev-only capability file). Keep `9527` (production frontend origin) but narrow its permission list to what the frontend actually invokes (fs write perms scoped to app data paths where the plugin allows) and document the residual port-hijack risk with a runtime guard: on startup, if port 9527 was already bound by another process, refuse to navigate there and surface an error (fail-closed instead of silently loading foreign content).

## Risks / Trade-offs

- [Over-aggressive sanitization strips legitimate rich content from RSS/EPUB/extracts] → Golden-file rendering tests: capture sanitized output for a corpus of real feeds/epubs/extracts before the change, assert equivalence (minus scripts/handlers) after; DOMPurify default profile keeps images/links/formatting.
- [PDF highlight escape changes mark placement or breaks TTS word timing] → Unit tests with crafted spans (entities, CJK, markup glyphs) asserting the escaped output highlights the same ranges; keep the `origHtml` restore path untouched.
- [Dialog-grant registry rejects legitimate export paths on older flows that pass relative paths] → Canonicalize + accept any path under a previously granted dir; add a fallback that records the dialog-chosen parent dir for the session; e2e export smoke tests for mnemosyne/apkg/pdf-html/youtube-download.
- [yt-dlp `--` separator unsupported on very old versions] → Bump/pin the bundled yt-dlp at the same time; `--` has been supported for years; CI test asserts a leading-dash URL is rejected before spawn.
- [Origin middleware breaks non-browser local clients (curl scripts, tests)] → No-Origin requests pass; the e2e harness covers both extension-originated and no-Origin requests.
- [DNS-resolving guard slows batch RSS/article imports] → 60s resolution cache; guard failure is a typed per-item error, not a batch abort.
- [Removing 15173 capability breaks `tauri dev`] → Add `capabilities/dev.json` (gitignored or gated by a debug_assertions build) referenced only in dev config; verify `npm run tauri dev` in CI job.
- [Automation key migration: existing installs have a Math.random key in localStorage] → Server generates a fresh CSPRNG key on first start after upgrade; the extension re-reads it via the existing pairing flow; one-time re-pair notification.

## Migration Plan

1. Ship frontend sanitization (D1) and Vercel fixes (D6) first — independent, lowest regression surface, immediately closes the XSS chains.
2. Ship backend confinement/spawn/guard (D2/D3/D5) behind typed errors; add the shared security modules with unit tests before touching commands.
3. Ship loopback + capability changes (D4/D7) together with the extension re-pairing flow for the automation key.
4. Rollback: each group is an independent commit; frontend sanitizer and backend confinement can be reverted independently; the automation-key rotation is the only stateful step and is idempotent (regenerates on next start).

## Open Questions

- Should `/api/podcast/search` require the automation key (breaking un-keyed extension installs until re-pair) or stay public behind Origin+rate-limit? (Leaning: public behind Origin middleware; revisit after extension update cadence is known.)
- Do we ship a dev-only capability file for 15173, or point `tauri dev` at the same 9527 origin? (Leaning: dev-only file; smaller blast radius.)
