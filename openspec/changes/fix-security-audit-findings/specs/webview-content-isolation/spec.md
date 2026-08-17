## ADDED Requirements

### Requirement: Raw-HTML sinks sanitize remote-influenced content
Every code path in the app webview or PWA that assigns remote-influenced content to `innerHTML` or `dangerouslySetInnerHTML` SHALL pass that content through the shared sanitizer (`sanitizeHtmlFragment`) or an equivalent escape step first. Remote-influenced content includes RSS/episode HTML, webpage selections and reader-view documents, imported EPUB/HTML chapters, OCR/LLM-generated HTML, saved-page titles, and stored document excerpts.

#### Scenario: Extract dialog renders a malicious selection safely
- **WHEN** a proxied webpage posts an `extract` bridge message whose `html` payload contains `<img src=x onerror=...>` and the extract dialog renders it
- **THEN** the payload is sanitized: the image element survives without the inline handler, and no script executes in the main window

#### Scenario: RSS summarize does not execute feed markup
- **WHEN** the user clicks Summarize on an article whose content contains `<img src=x onerror=...>`
- **THEN** the html-to-text conversion parses the HTML inertly (DOMParser or equivalent) and no network fetch for `src=x` begins and no inline handler executes

#### Scenario: Legitimate rich content survives sanitization
- **WHEN** sanitized content containing ordinary formatting (bold, links, images with `http(s)`/`data:image` sources, audio controls) is rendered
- **THEN** the visible output is byte-equivalent (modulo removed handlers) to pre-change rendering for the golden corpus

### Requirement: PDF text-layer highlighting escapes text before re-interpolation
The PDF search, TTS, and jump-highlight code paths SHALL HTML-escape text-layer `textContent` before assigning it back through `innerHTML` with `<mark>` wrappers.

#### Scenario: Malicious PDF glyphs do not execute
- **WHEN** a PDF whose text layer contains literal `<img src=x onerror=...>` glyphs is searched, read aloud, or opened from a global-search jump
- **THEN** the glyphs render as literal text inside the highlight and no script executes

#### Scenario: Highlight ranges are unchanged
- **WHEN** a normal PDF is searched or read aloud after the change
- **THEN** the same character ranges receive `<mark>` highlighting as before the change (golden test)

### Requirement: Search excerpts escape before markup insertion
The global-search and command-center excerpt pipeline SHALL escape excerpt text before inserting highlight markers, and SHALL NOT entity-decode stored HTML into executable excerpts.

#### Scenario: Stored markup in document content is inert in results
- **WHEN** a stored document's content contains literal `<img onerror>` markup and a matching search renders its excerpt
- **THEN** the excerpt displays the markup as text and no script executes

### Requirement: Reader view neutralizes script URLs
Reader-view link handling SHALL call `preventDefault()` before scheme-based early returns, and imported/reader HTML processing SHALL rewrite `javascript:` (and non-image `data:`) hrefs to inert values.

#### Scenario: javascript: link click does not execute
- **WHEN** the user clicks an anchor with a `javascript:` href inside rendered reader-view content
- **THEN** nothing executes and the click is consumed

### Requirement: Document iframes do not combine same-origin with scripts
Sandboxed iframes that display imported or AI-generated documents SHALL NOT set both `allow-same-origin` and `allow-scripts`, and all `srcDoc` content (including OCR-fallback output) SHALL pass through the shared sanitizer first.

#### Scenario: OCR fallback output cannot reach the parent window
- **WHEN** the OCR fallback returns HTML containing script or same-origin access attempts and it is displayed
- **THEN** the frame does not share the app origin and injected scripts are stripped by sanitization

### Requirement: UI chrome builds notifications with text content
Toast/notification/indicator UI that displays remote-influenced strings (e.g. saved-page titles) SHALL set them via `textContent`, not string interpolation into `innerHTML`.

#### Scenario: Malicious page title is displayed inertly
- **WHEN** the browser extension saves a page whose `<title>` contains `<img onerror>` and the PWA shows the save toast
- **THEN** the title renders as literal text and no script executes
