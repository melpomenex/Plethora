## Why

The Web Browser tab cannot show pages. Reader View can, because it goes through the Rust `fetch_url_content` command — a server-side HTTP fetch that is not subject to CORS or `X-Frame-Options`. Every other path in the tab is subject to exactly those restrictions, or is broken outright:

- **Web/PWA path** — `<iframe src={remoteUrl}>` is refused by any site sending `X-Frame-Options: DENY/SAMEORIGIN` or a `frame-ancestors` CSP. Wikipedia, most news sites, and nearly every large site do. The tab already has a "This site can't be embedded here" state for it ([WebBrowserTab.tsx:1700](src/components/tabs/WebBrowserTab.tsx:1700)).
- **Desktop path** — a native Tauri child webview positioned over the tab. Its extract bridge calls `webview.evaluateJavaScript(...)`, **a method that does not exist** on `@tauri-apps/api@2.11`'s `Webview` class. Every call throws and is swallowed by a `.catch()`, so script injection never happens and selection can never be read. The webview also floats as an OS-level widget above React UI, requiring ~250 lines of bounds math, offset detection, and `IntersectionObserver` show/hide to stay roughly aligned — the subject of two still-open proposals (`fix-webview-layout`, `fix-webview-permissions`).

The result: on desktop the page is either missing or unextractable; on web it is blocked; and the only thing that works is the Reader View escape hatch the user has to discover and click.

There *is* a way around embedding refusal, and this codebase already has the infrastructure for it: `X-Frame-Options` and `frame-ancestors` are enforced by the browser against the *response headers of the framed document*. Fetch that document through the app's own loopback HTTP server, drop those two headers, and the page frames normally — while gaining a single, controlled origin from which selection, links, and assets can all be handled.

## What Changes

- **New loopback web-proxy route.** A `web_proxy` module mounted on the existing shared media-server listener (the same pattern `epub_server` uses). It fetches an upstream URL server-side, strips `X-Frame-Options` and `frame-ancestors`, rewrites the document so links and assets route back through the proxy, and serves it from `http://127.0.0.1:<port>`.
- **The Web Browser tab renders the proxied page in an iframe on every platform.** URL in → page loads, with working links, back/forward, refresh, images and stylesheets.
- **A proxy-injected selection bridge.** The proxy injects a small script into every proxied HTML document that reports selections to the app via `postMessage`. Selecting text in the page enables "Create Extract" directly — no clipboard step, no manual paste — and the saved extract carries the real upstream page URL and title as its source, not the loopback URL.
- **The Assistant reads the live proxied page.** Its context resolver reads the DOM the user is actually looking at (via the same bridge), instead of re-fetching the URL a second time.
- **BREAKING (internal): the native Tauri child webview path is removed.** With it go `updateWebviewBounds`, `detectNativeOffset`, the `IntersectionObserver` show/hide, the zombie-webview sweep, the 500 ms selection poll, and the dead `evaluateJavaScript` bridge. Desktop and web converge on one code path. `fix-webview-layout` and `fix-webview-permissions` become moot.
- **Reader View is kept**, unchanged, as the fallback for pages the proxy cannot render usefully (paywalls, heavy SPAs, sites that block the fetch). It also stays the reading-optimised view users may simply prefer.

## Capabilities

### New Capabilities
- `in-app-web-browsing`: Loading, navigating, and extracting from arbitrary web pages inside the Web Browser tab — proxy-based page loading, selection capture with upstream source attribution, assistant context from the live page, and the Reader View fallback.

### Modified Capabilities

None. No existing spec in `openspec/specs/` covers browser-tab behaviour.

## Impact

**New code**
- `src-tauri/src/web_proxy.rs` — proxy route, header stripping, HTML rewriting, bridge injection.
- `src/lib/webProxy.ts` (or equivalent) — resolve proxy URLs, `postMessage` bridge client.

**Modified code**
- `src-tauri/src/media_server.rs` — merge the new router into the shared listener.
- `src-tauri/src/lib.rs` — register the `web_proxy` module and its URL-resolving command.
- `src-tauri/tauri.conf.json` — `frame-src` must allow `http://127.0.0.1:*` in both `csp` and `devCsp`.
- `src/components/tabs/WebBrowserTab.tsx` — the bulk of the change; net deletion.
- `src/lib/webview-extract-bridge.ts` — repurposed for the proxy bridge, or deleted if the browser extension is its only remaining consumer.
- `src/lib/i18n/locales/*.ts` — new strings for proxy failure states; removal of embed-blocked strings that no longer apply.

**Security**
- The proxy is an SSRF surface. It must reuse `crate::security::validate_url_not_private` (already used by `fetch_url_content`) on the initial URL *and* on every redirect hop and sub-resource request, and must bind loopback-only, as the media server already does.
- Proxied documents run with their scripts intact under a distinct `127.0.0.1` origin, isolated from the app's `tauri://localhost` origin. Cookies and credentials are not forwarded, so the proxy browses logged-out; this is a deliberate limitation, stated in Design.

**Dependencies**
- None new. `reqwest`, `axum`, and `scraper`/`lol_html` alternatives are evaluated in Design; the HTML rewrite is small enough to do without a new crate.

**Removed**
- Native child-webview creation and management, and the `core:webview:*` capability permissions that exist only to serve it.
