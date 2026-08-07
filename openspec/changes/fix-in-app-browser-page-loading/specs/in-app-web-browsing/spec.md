## ADDED Requirements

### Requirement: Pages load through the loopback web proxy

On builds with a Rust backend (desktop and native mobile), the Web Browser tab SHALL load pages by requesting them from the app's loopback web-proxy route rather than by pointing an iframe at the upstream origin. The proxy SHALL remove `X-Frame-Options` and the upstream `Content-Security-Policy` from the response before serving it, so that a site's refusal to be embedded does not prevent it from rendering in the tab.

#### Scenario: A site that refuses embedding loads anyway

- **WHEN** the user enters `https://en.wikipedia.org/wiki/Spaced_repetition` in the URL bar and presses Enter
- **THEN** the article renders inside the tab with its text, images, and stylesheets
- **AND** no "This site can't be embedded here" state is shown

#### Scenario: Desktop uses the proxy, not a native webview

- **WHEN** a URL is opened in the Tauri desktop app
- **THEN** the page loads through the proxy iframe
- **AND** no native child webview is created

#### Scenario: Browser/PWA build keeps its existing fallback

- **WHEN** the same URL is opened in the browser/PWA build, where no Rust backend is available to proxy it
- **THEN** the direct iframe is attempted as today, and the existing embed-blocked state offering Reader View is shown when the site refuses embedding

#### Scenario: Upstream failure is surfaced, not blank

- **WHEN** the upstream host returns a non-success status, times out, or refuses the connection
- **THEN** the tab shows a failure state naming the reason and the host
- **AND** offers Retry, Reader View, and Open in system browser

### Requirement: The proxy refuses private and non-HTTP targets

The proxy SHALL validate every URL it fetches — the initial request and each redirect hop — against the app's existing private-address guard, and SHALL reject any target that is not `http:`/`https:` or that resolves to localhost, a loopback address, a private range, or a link-local address.

#### Scenario: Private target rejected

- **WHEN** a proxy request is made for `http://169.254.169.254/latest/meta-data` or `http://192.168.1.1/`
- **THEN** the proxy responds with a client error and fetches nothing

#### Scenario: Redirect to a private target rejected

- **WHEN** a permitted public URL responds with a redirect to `http://127.0.0.1:9527/`
- **THEN** the proxy does not follow the redirect and responds with a client error

#### Scenario: Listener is loopback-only

- **WHEN** the proxy route is mounted
- **THEN** it is served by the existing loopback media-server listener bound to `127.0.0.1`

### Requirement: Navigation inside the proxied page stays in the proxy

Links, form submissions, and redirects inside a proxied document SHALL resolve to proxied URLs so the user stays inside the tab, and the tab's URL bar, page title, and back/forward history SHALL reflect the upstream URL, never the loopback URL.

#### Scenario: Following a link

- **WHEN** the user clicks an in-page link to another page on the same or a different site
- **THEN** the new page loads through the proxy inside the tab
- **AND** the URL bar shows the upstream URL of the new page

#### Scenario: Back and forward

- **WHEN** the user has navigated across several pages and presses Back, then Forward
- **THEN** the tab returns to the previous and next upstream URLs respectively, each loaded through the proxy

#### Scenario: Opening in the system browser

- **WHEN** the user clicks "Open in system browser"
- **THEN** the upstream URL opens, not the loopback proxy URL

### Requirement: Selecting text in the page enables extraction

A proxied document SHALL report the user's current text selection to the app. When a selection exists, "Create Extract" SHALL open the extract dialog pre-filled with the selected text and its HTML, with no clipboard or manual-paste step.

#### Scenario: Extract from a selection

- **WHEN** the user selects a paragraph in the loaded page and clicks "Create Extract" (or presses the configured extract shortcut)
- **THEN** the extract dialog opens with that paragraph as its content
- **AND** the dialog's rich-formatting indicator reflects that HTML was captured

#### Scenario: No selection

- **WHEN** the user triggers "Create Extract" with nothing selected
- **THEN** the app states that no text is selected and opens the manual-entry dialog
- **AND** no empty extract is saved

#### Scenario: Selection survives page navigation

- **WHEN** the user navigates to another page inside the tab
- **THEN** the selection reported to the app is that of the newly loaded page, and no stale selection from the previous page can be extracted

### Requirement: Extracts record the upstream source

An extract created from a proxied page SHALL record the upstream page URL and the upstream page title as its source. The loopback proxy URL SHALL NOT appear in any saved extract, document, or displayed attribution.

#### Scenario: Source attribution on save

- **WHEN** the user saves an extract taken from `https://example.com/article`
- **THEN** the extract's source URL is `https://example.com/article`
- **AND** the extract dialog and the extract list display that URL and the page's title

#### Scenario: Source after in-page navigation

- **WHEN** the user follows a link inside the tab and then extracts from the new page
- **THEN** the extract's source URL is the new page's upstream URL, not the one the tab was opened with

### Requirement: The Assistant reads the loaded page

When the Assistant is opened in the Web Browser tab, its context SHALL be the readable text of the page currently displayed, resolved at send time. It SHALL prefer the live proxied document, fall back to Reader View content when that is what is displayed, and only re-fetch the URL when neither is available.

#### Scenario: Asking about the open page

- **WHEN** a page is loaded through the proxy and the user asks the Assistant a question about it
- **THEN** the request carries the page's readable text as context, trimmed to the configured context-window token budget
- **AND** the context source is the loaded page, with no second network fetch of the same URL

#### Scenario: Assistant tools act on the page

- **WHEN** the user asks the Assistant to generate flashcards from the open page
- **THEN** the generated items are derived from that page's text and attributed to its upstream URL

#### Scenario: No readable text

- **WHEN** no readable text can be resolved for the current page
- **THEN** the Assistant reports the context as unavailable and directs the user to Reader View, rather than sending an empty context

### Requirement: Reader View remains available as a fallback

Reader View SHALL remain reachable from the toolbar for any loaded URL, and SHALL be offered by the failure state when the proxy cannot render a page. Toggling Reader View SHALL NOT discard the tab's current URL or history.

#### Scenario: Falling back after a proxy failure

- **WHEN** the proxy fails to render a page and the user clicks "Reader View" in the failure state
- **THEN** the article is fetched and rendered in Reader View for the same URL

#### Scenario: Toggling back to the page

- **WHEN** the user closes Reader View
- **THEN** the tab returns to the proxied page at the same URL, without re-entering the URL

### Requirement: The proxied document is isolated from the app

A proxied document SHALL be served from a loopback origin that serves nothing but proxied web content, distinct from the app's own origin and from the loopback origin that serves local app files. It SHALL NOT be able to reach the app's own origin, its Tauri IPC, or its stored data. The app SHALL accept messages from the proxy frame only when they originate from that frame and match the expected message shape.

#### Scenario: Page scripts cannot reach the app

- **WHEN** a proxied page's own scripts run
- **THEN** they have no access to the app's Tauri IPC or to the app document's DOM

#### Scenario: Page scripts cannot reach local app files

- **WHEN** a proxied page's script issues a same-origin request to the app's local file-streaming routes (`/stream`, `/epub`)
- **THEN** the request does not reach those routes, because they are served from a different loopback port than the proxy

#### Scenario: Unexpected messages are ignored

- **WHEN** a message arrives from an unexpected origin or does not match the bridge message shape
- **THEN** the app ignores it and no selection, navigation, or extract state changes

### Requirement: The native child webview is removed

The Web Browser tab SHALL NOT create, position, show, hide, or destroy a native Tauri child webview, and SHALL NOT poll a webview for selection data.

#### Scenario: No OS-level widget over the UI

- **WHEN** a page is open in the Web Browser tab and the user opens a dialog, switches tabs, resizes the window, or drags a split pane
- **THEN** the page is clipped and layered by normal DOM rules, with no separately positioned OS widget to keep aligned

#### Scenario: No background polling

- **WHEN** a Web Browser tab is open but not the active tab
- **THEN** no periodic selection polling runs for it
