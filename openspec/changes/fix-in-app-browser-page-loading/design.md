## Context

The Web Browser tab currently has three page-rendering paths and none of them delivers the loop the user wants (open a URL → read it → ask the Assistant about it → select text → extract with source attribution).

| Path | Where | State |
| --- | --- | --- |
| `<iframe src={remoteUrl}>` | web/PWA | Blocked by `X-Frame-Options` / `frame-ancestors` on most real sites |
| Native Tauri child webview | desktop | Renders as an OS widget over the React tree; its extract bridge calls `webview.evaluateJavaScript(...)`, which does not exist on `@tauri-apps/api@2.11` — verified against `node_modules/@tauri-apps/api/webview.d.ts`, whose `Webview` class exposes no JS-evaluation method at all. Every injection call throws into a swallowing `.catch()` |
| Reader View | both | Works. Fetches server-side via the Rust `fetch_url_content` command, then renders sanitised HTML in the React tree |

Reader View works for one reason: the fetch happens **outside the browser's origin model**. `X-Frame-Options` and `frame-ancestors` are enforced by the user agent against the headers of the *framed document*; an HTTP client in Rust neither sees nor honours them.

The constraint that shaped this design: **the app already runs a loopback HTTP server.** `src-tauri/src/media_server.rs` binds `127.0.0.1:0`, serves `/stream` for audiobooks, and merges `epub_server`'s `/epub` route into the same `axum::Router` — a documented "sibling module, same listener" pattern (`openspec/changes/stream-epub-resources/design.md`, decision D2). Serving a fetched page from our own loopback origin costs one more axum route and turns "the site refuses to be embedded" into a non-problem.

Relevant existing pieces this design reuses rather than re-creates:

- `crate::security::validate_url_not_private` — SSRF guard already applied by `fetch_url_content`.
- `src/lib/webview-extract-bridge.ts` — a 320-line injected script that already tracks selection, captures its HTML, honours the user's configured extract shortcut, and renders a floating "Extract" button. Its only consumer is `WebBrowserTab.tsx`, so it can be re-pointed at a new sink without touching anything else.
- The existing Reader View, failure states, extract dialog, and Assistant context resolver in `WebBrowserTab.tsx`.

## Goals / Non-Goals

**Goals:**

- A URL typed into the tab renders as a page — styled, images intact, links clickable — for ordinary content sites, including sites that refuse embedding.
- Selecting text in that page makes "Create Extract" work immediately, with the extract's source recorded as the upstream URL and title.
- The Assistant, opened over that page, gets the page's text as context without a second network fetch, so its tools (Q&A, flashcard generation) act on what the user is looking at.
- Reader View survives as an explicit, always-available fallback.
- Net deletion in `WebBrowserTab.tsx`: one rendering path instead of three.

**Non-Goals:**

- **Being a real browser.** Logged-in sessions, cookies, credentialed requests, OAuth flows, video DRM, and heavy client-rendered SPAs are out of scope. This is a reading surface.
- **Proxying in the browser/PWA build.** That build has no Rust process. It keeps today's direct-iframe attempt plus the embed-blocked → Reader View fallback. Adding a proxy route to the hosted `server/` Express app would make Incrementum's servers an open web proxy — a bandwidth and abuse liability that this change deliberately does not take on.
- **Bypassing paywalls or bot walls.** Sites that block the fetch, or serve a challenge page, land in the failure state and hand off to Reader View or the system browser.
- **Rewriting sub-resource URLs through the proxy.** See D3.

## Decisions

### D1 — Fetch the document server-side and serve it from loopback

Add `src-tauri/src/web_proxy.rs` exposing `GET /web?url=<percent-encoded upstream>`. It fetches the upstream document with `reqwest` (already a dependency), then serves the bytes back with `X-Frame-Options`, `Content-Security-Policy`, and `Content-Security-Policy-Report-Only` removed, and the original `Content-Type` (including its `charset`) preserved.

A Tauri command — `get_web_proxy_url(url) -> String`, mirroring the existing `get_epub_stream_url` — starts the listener if needed and returns the loopback URL for the frontend to drop into `iframe.src`.

*Alternative considered: a Tauri custom URI protocol* (`incrementum-web://…`). It avoids a port, but the scheme is rendered differently per platform (`http://…​.localhost` on WebView2), has no equivalent in the PWA build, and the loopback server already exists and is already proven to serve into this webview. Rejected as more moving parts for no gain.

*Alternative considered: keep the iframe pointed upstream and inject a "frame-buster-buster".* There is no such thing — the enforcement is in the user agent, before any script of ours runs. This is why the current code has an embed-blocked state rather than a workaround.

### D2 — A dedicated listener, **not** the shared media-server listener

This is the one place the design deliberately declines the smaller diff. Merging `/web` into the media server would put proxied third-party pages on the *same origin* as `/stream` and `/epub`, which serve files from the app data and cache directories — including the SQLite database. A single malicious or compromised proxied page could then same-origin `fetch('/stream?path=…')` and read the user's library out of the app.

So `web_proxy` binds its own `127.0.0.1:0` listener behind its own `OnceCell<u16>`, structurally mirroring `media_server::start`. Cost: about fifteen lines. It keeps the local-file routes cross-origin from anything the proxy serves, and those routes send no CORS headers, so the read is refused by the browser.

*Alternative considered: same listener + `sandbox` without `allow-same-origin`.* An opaque origin also blocks the attack, but it breaks pages that touch `localStorage`/`sessionStorage` (they throw) and complicates the bridge. Rejected — a second port is cheaper and less surprising.

### D3 — Rewrite only the document; let sub-resources load straight from upstream

The proxy injects two things into the `<head>` of an HTML response and nothing else:

1. `<base href="<final upstream URL>">` — so every relative `src`/`href` in the page resolves against the real site.
2. `<script>` — the bridge (D4).

Sub-resources (`<img>`, `<link rel=stylesheet>`, `<script src>`, fonts) are then fetched by the webview **directly from the upstream origin**, which is exactly what a browser normally does and is not restricted by `X-Frame-Options` — that header governs framed documents only. Stripping the upstream `Content-Security-Policy` (D1) is what makes this work: an unmodified `default-src 'self'` would otherwise be evaluated against `127.0.0.1` and block the page's own assets.

The insertion is done on bytes, immediately after the `<head>` open tag (or before the first `<` if there is none), and the injected text is pure ASCII — so a page in Shift-JIS or Latin-1 is not corrupted and needs no transcoding. Non-HTML content types are streamed through untouched. No HTML-parser crate is added; `regex` and `url` are already dependencies and are enough.

*Alternative considered: rewrite every URL in the HTML and in linked CSS to route back through the proxy.* Strictly more faithful (it would also fix pages whose scripts fetch same-origin JSON), but it means an HTML parser, a CSS `url()` rewriter, a proxy hop per asset, and a rewriting bug class for every attribute we forget. Rejected for a reading surface. The trade-off it costs us is recorded under Risks.

*Alternative considered: `srcdoc` with the fetched HTML.* Then the document is same-origin with the app and selection is directly readable — but the app's own CSP governs it, so third-party stylesheets and images are blocked and every page renders unstyled. That is Reader View with extra steps.

### D4 — Selection and navigation cross the origin boundary by `postMessage`

The proxy origin is not the app origin, so `iframe.contentDocument` is unreadable. `postMessage` is the sanctioned channel and the proxy controls the injected script, so the bridge is ours to define.

`src/lib/webview-extract-bridge.ts` is repurposed: it keeps the selection tracking, HTML capture, shortcut handling, and floating-button UI it already has, and its `localStorage.setItem(STORAGE_KEY, …)` sink is replaced with `window.parent.postMessage(...)`. The 500 ms polling loop in `WebBrowserTab.tsx` disappears with it — messages are pushed, not polled.

Message types, all tagged with a fixed namespace field:

| Direction | Type | Payload |
| --- | --- | --- |
| frame → app | `ready` | final `url`, `title` |
| frame → app | `selection` | `text`, `html`, `url`, `title` (empty payload when the selection clears) |
| frame → app | `navigate` | resolved absolute `url`, `newTab` flag |
| app → frame | `text-request` | `id` |
| frame → app | `text-response` | `id`, `text` (`document.body.innerText`) |

On the app side every handler first checks `event.source === iframeRef.current?.contentWindow` **and** `event.origin === proxyOrigin`, then shape-checks the payload; anything else is dropped. The bridge intercepts anchor clicks and form submits, resolves the target against the current document, and emits `navigate` instead of letting the frame self-navigate — that keeps the URL bar, page title, and back/forward history authoritative in React and guarantees the loopback URL never leaks into them. Cmd/Ctrl/middle-click sets `newTab`, which opens a new in-app browser tab, reusing the branch `handleReaderLinkClick` already implements for Reader View.

### D5 — Upstream identity: browser UA, no credentials, validated hops

- **User agent.** The current `Incrementum/1.0 (https://incrementum.app)` gets many sites to serve a degraded or refusing response. The proxy sends an ordinary desktop-browser UA and forwards the user's `Accept-Language`.
- **Credentials.** No cookie jar, no `Authorization` pass-through. Browsing is logged-out. This is a stated non-goal, and it is also what keeps the proxy from becoming a confused deputy for the user's sessions.
- **Redirects.** `reqwest`'s default policy is replaced with a custom one that runs `validate_url_not_private` on every hop and refuses non-`http(s)` schemes, capping at ten. The **final** `response.url()` — not the requested one — becomes the `<base href>` and the URL reported to the app, so a redirect lands the URL bar on the right page.
- **Limits.** 30 s timeout and a response-size cap, so a hostile or broken upstream cannot pin memory.

### D6 — Assistant context comes from the frame, with the existing chain behind it

`resolveContextForPrompt` in `WebBrowserTab.tsx` gains a new first branch: `text-request` → `text-response` over the bridge, with a short timeout. Its existing chain — Reader View content → same-origin iframe read → re-fetch the URL — stays as the fallback ladder, and the "no readable text, open Reader View" terminal message stays as-is. Trimming still goes through `trimToTokenWindow` against the configured budget. The same resolved text serves the Assistant's tools, so flashcards generated from the tab describe the page on screen.

### D7 — Delete the native child webview

Removing it takes out `updateWebviewBounds`, `detectNativeOffset`, the macOS title-bar offset heuristic, the `ResizeObserver` re-sync, the `IntersectionObserver` show/hide, the dialog-open hide/show effect, the zombie-webview sweep on mount and unmount, the 500 ms selection poll, and the two `evaluateJavaScript` bridges that never worked. The `core:webview:*` permissions in `src-tauri/capabilities/default.json` and the `web-browser-*` webview entry go with it.

This is the change's largest simplification and the reason desktop and web stop diverging. It also resolves `fix-webview-layout` and `fix-webview-permissions`, both still open against symptoms of the widget this design deletes; the migration step below marks them superseded.

### D8 — CSP

`src-tauri/tauri.conf.json` must allow the frame: `frame-src` gains `http://127.0.0.1:*` in both `csp` and `devCsp`. `connect-src` and `media-src` already carry `http://127.0.0.1:*` for the media server, so no other directive changes. `127.0.0.1` is a potentially-trustworthy origin, so framing it from `tauri://localhost` is not mixed content — the media server already streams over plain HTTP into this same webview.

## Risks / Trade-offs

- **Client-rendered SPAs will not work.** The page's own `fetch`/XHR to its API is cross-origin from `127.0.0.1` and will fail CORS. → Accepted; content sites are the target. The failure state and Reader View catch the rest, and the tab keeps "Open in system browser" for the genuinely interactive case.
- **All proxied sites share one loopback origin,** so site A's script can read site B's `localStorage` on that origin. → Low impact for logged-out reading of content sites, and the origin holds no app data (D2). If it matters later, partition by a per-tab path token or per-tab port.
- **The proxy is an SSRF primitive.** → `validate_url_not_private` on the initial URL and every redirect hop, scheme allowlist, loopback-only bind, and no credential forwarding. The guard already has unit tests covering `127.0.0.1`, `169.254.169.254`, RFC1918, and `[::1]`; the redirect-hop path gets its own.
- **Proxied pages run their own JavaScript.** → Isolated by origin (D2), sandboxed on the iframe, no IPC reach, and every inbound message source-, origin-, and shape-checked (D4). This is a strictly smaller surface than the native child webview it replaces, which ran the same scripts with no boundary we controlled at all.
- **Sites will block us.** Cloudflare challenges, bot walls, and paywalls will serve a challenge instead of the page. → Detect a non-success or challenge-shaped response and route to the failure state, which already offers Reader View and the system browser. Explicitly not in scope to defeat.
- **Injecting into HTML by byte offset is a heuristic.** A page with no `<head>`, or with the tag inside a comment, could be mangled. → Insert after the first `<head…>` if present, else before the first tag, else prepend; unit-test the no-head, comment-before-head, and `<!DOCTYPE>`-only cases. Worst case is one page rendering unstyled, not a crash.
- **The user loses the native webview's rendering fidelity.** Pages that worked there (if positioned correctly) may render slightly differently. → In practice the native path is already unusable for extraction, which is the point of the tab.

## Migration Plan

1. Land the Rust proxy and its command behind the existing structure; nothing consumes it yet.
2. Repoint `WebBrowserTab.tsx` at the proxy on the Tauri path, keeping Reader View and the failure states.
3. Delete the native-webview code and the now-dead `core:webview:*` permissions in the same commit as step 2, so no build ships with both paths half-wired.
4. Verify by hand on macOS, Windows, and Linux — the project's stated policy for UI changes — on Wikipedia (the user's named regression), a news site, a docs site, and one known-hostile site to confirm the failure state.
5. Mark `fix-webview-layout` and `fix-webview-permissions` superseded by this change.

**Rollback:** the change is confined to one React component, one new Rust module, one CSP line, and one capabilities edit. Reverting the commit restores the previous behaviour; no data model, schema, or persisted state is touched, so there is nothing to migrate back.

## Open Questions

- **Should proxied responses be cached?** A short-lived in-memory cache keyed by URL would make back/forward instant, at the cost of staleness and memory. Deferred until the uncached behaviour is measured.
- **Should the browser extension's capture path converge on this bridge?** Both now capture selection + HTML + source URL from a live page. Out of scope here; worth revisiting once this ships.
- **Does the PWA build deserve a proxy later?** Only with authentication and rate limiting on the hosted server, and only if users actually browse from the PWA. Left open deliberately.
