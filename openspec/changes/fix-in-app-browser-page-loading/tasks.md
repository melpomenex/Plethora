## 1. Rust web proxy

- [x] 1.1 Create `src-tauri/src/web_proxy.rs` with a dedicated loopback listener (`127.0.0.1:0` behind a `OnceCell<u16>`), mirroring `media_server::start`, and a `port()` accessor. Do **not** merge into the media-server router — design D2.
- [x] 1.2 Add the `GET /web?url=<percent-encoded>` handler: percent-decode, parse, reject non-`http(s)` schemes, and run `crate::security::validate_url_not_private` before any network call.
- [x] 1.3 Build the `reqwest` client with a desktop-browser user agent, a forwarded `Accept-Language`, a 30 s timeout, a response-size cap, and no cookie jar or credential forwarding.
- [x] 1.4 Replace the default redirect policy with one that runs `validate_url_not_private` and the scheme check on every hop, capping at 10.
- [x] 1.5 Strip `X-Frame-Options`, `Content-Security-Policy`, and `Content-Security-Policy-Report-Only` from the response; preserve the original `Content-Type` including its `charset`.
- [x] 1.6 For HTML responses only, inject `<base href="<response.url()>">` plus the bridge `<script>` as ASCII bytes after the first `<head…>` tag (fall back to before the first tag, else prepend). Stream every non-HTML content type through untouched.
- [x] 1.7 Register `mod web_proxy;` in `src-tauri/src/lib.rs` and add the `get_web_proxy_url(url) -> String` command to the invoke handler, modelled on `epub_server::get_epub_stream_url`.
- [x] 1.8 Rust tests: private/loopback/link-local targets rejected; redirect-to-private rejected; non-`http(s)` scheme rejected; `X-Frame-Options`/CSP absent from the served response; injection correct for a normal document, a document with no `<head>`, a `<!DOCTYPE>`-only document, and a comment before `<head>`; a non-UTF-8 body round-trips unchanged apart from the injection.

## 2. Bridge script

- [x] 2.1 Rework `src/lib/webview-extract-bridge.ts` to post to `window.parent` instead of writing to `localStorage`, keeping the existing selection tracking, HTML capture, shortcut handling, and floating "Extract" button.
- [x] 2.2 Emit `ready` (final URL + `document.title`) on load and `selection` on selection change, including an empty payload when the selection clears.
- [x] 2.3 Intercept anchor clicks and form submits: resolve the target to an absolute URL, `preventDefault`, and emit `navigate` with a `newTab` flag for Cmd/Ctrl/middle-click and `target="_blank"`.
- [x] 2.4 Handle `text-request` by replying `text-response` with `document.body.innerText` and the matching request id.
- [x] 2.5 Delete the `SELECTION_STORAGE_KEY` export and its `localStorage` sink once nothing references them.

## 3. Web Browser tab — proxy rendering

- [x] 3.1 Add a frontend helper that resolves a proxy URL via `get_web_proxy_url` and exposes the proxy origin for message validation.
- [x] 3.2 On the Tauri path, point the iframe at the proxied URL with `sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"`; keep today's direct-iframe behaviour on the browser/PWA path.
- [x] 3.3 Add the `message` listener, rejecting anything whose `event.source` is not the iframe's `contentWindow`, whose `event.origin` is not the proxy origin, or whose payload does not match the expected shape.
- [x] 3.4 On `ready`, set the page title and reconcile the URL bar with the final (post-redirect) upstream URL.
- [x] 3.5 On `navigate`, update `currentUrl`/`url`/`pageTitle` and the back-forward history, then load the new proxied URL — or open a new browser tab when `newTab` is set, reusing the branch `handleReaderLinkClick` already has.
- [x] 3.6 Keep the loopback URL out of the URL bar, the page title, history, "Open in system browser", bookmarks, and every saved record.
- [x] 3.7 Surface proxy failures (non-success status, timeout, refused connection, blocked target) in the existing failure state, naming the host and offering Retry, Reader View, and Open in system browser.
- [x] 3.8 Add `http://127.0.0.1:*` to `frame-src` in both `csp` and `devCsp` in `src-tauri/tauri.conf.json`.

## 4. Extraction and Assistant

- [x] 4.1 Store the latest bridge selection and rewrite `handleCreateExtract` to use it, dropping the webview-poll and clipboard-paste branches. Keep the empty-selection guard: inform the user and open the manual dialog without saving an empty extract.
- [x] 4.2 Record the upstream page URL and title from the selection payload as the extract's source, so the source follows in-page navigation rather than the URL the tab was opened with.
- [x] 4.3 Add the `text-request`/`text-response` branch to the front of `resolveContextForPrompt`, with a short timeout, leaving the Reader View → same-origin iframe → re-fetch ladder and the "unavailable" terminal message intact behind it.
- [x] 4.4 Verify an Assistant flashcard-generation run over a proxied page produces items derived from that page and attributed to its upstream URL.

## 5. Remove the native child webview

- [x] 5.1 Delete the webview creation effect, `updateWebviewBounds`, `detectNativeOffset`, the `ResizeObserver` re-sync, the `IntersectionObserver` show/hide, the dialog-open hide/show effect, the unmount and zombie sweeps, and the 500 ms selection poll from `WebBrowserTab.tsx`.
- [x] 5.2 Delete `pollWebviewSelection`, `pushShortcutToWebview`, and both `evaluateJavaScript` call sites.
- [x] 5.3 Remove the `core:webview:*` permissions and the `web-browser-*` webview entry from `src-tauri/capabilities/default.json`, keeping any still used elsewhere.
- [x] 5.4 Confirm nothing else imports the removed helpers, and that `npm run build` and `cargo check` are clean.

## 6. Strings and docs

- [x] 6.1 Add proxy failure strings and remove the embed-blocked strings that no longer apply on the Tauri path, across all six locales in `src/lib/i18n/locales/`.
- [x] 6.2 Update the tab's empty-state instructions: selection now works directly, so the copy-and-paste caveat in the extract dialog goes away.
- [x] 6.3 Mark `openspec/changes/fix-webview-layout` and `openspec/changes/fix-webview-permissions` superseded by this change.

## 7. Verification

- [x] 7.1 Frontend tests for the message handler: wrong origin, wrong source, and malformed payloads are all ignored and change no state.
- [ ] 7.2 Manual pass on macOS, Windows, and Linux (project policy for UI changes): Wikipedia loads styled with images; a news site and a docs site load; in-page links, back, forward, and refresh work; a known-hostile site lands in the failure state.
- [ ] 7.3 End-to-end: open a URL → ask the Assistant about it → generate a flashcard → select a paragraph → create an extract → confirm the saved extract's source URL and title are the upstream page's.
- [ ] 7.4 Confirm a proxied page cannot read `/stream` or `/epub`: the ports differ and the cross-origin request is refused.
