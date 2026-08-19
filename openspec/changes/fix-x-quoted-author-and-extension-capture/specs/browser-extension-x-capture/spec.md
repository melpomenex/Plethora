## ADDED Requirements

### Requirement: Extension routes X status URLs to the thread pipeline
The Plethora Capture extension SHALL detect x.com/twitter.com status URLs at save time (single-tab save, save-all-tabs, and context-menu save) and send a URL-only capture of type `x-thread` to the local capture server, without scraping page content.

#### Scenario: Save current tab on a status URL
- **WHEN** the user saves the current tab and its URL matches an X status pattern (`x.com|twitter.com/<user>/status/<id>`, tolerating `www.`/`mobile.` hosts, query params, and `/photo/n` suffixes)
- **THEN** the extension SHALL send `{ type: "x-thread", url, title }` to the capture server
- **AND** SHALL NOT request or transmit page DOM/text for that tab

#### Scenario: Save current tab on a non-status X URL
- **WHEN** the URL is an X page that is not a status URL (e.g. a profile or search page)
- **THEN** the save SHALL proceed through the existing generic page-capture path

#### Scenario: Cross-browser behavior
- **WHEN** the same save is performed in Firefox and in Chromium
- **THEN** the extension SHALL produce the identical request (type, URL, title) using only cross-browser Manifest V3 APIs

### Requirement: Capture server imports X captures as thread documents
The capture server SHALL route any extension request whose URL is an X status URL (regardless of declared type) through the ThreadReaderApp-first thread retrieval pipeline, apply enrichment, and persist the result as an X thread document equivalent to an in-app import.

#### Scenario: x-thread capture received
- **WHEN** the server receives an extension capture for an X status URL
- **THEN** it SHALL resolve the thread via the same retrieval path as the in-app `get_twitter_thread` flow
- **AND** SHALL apply per-post enrichment before persisting
- **AND** SHALL persist a document with the same category, tags, `article_html`, and `structured_content` as `import_twitter_thread`
- **AND** SHALL emit the existing `browser-sync://document-saved` event so the library reflects the capture

#### Scenario: Duplicate capture
- **WHEN** an X status URL that is already saved (after URL normalization) is captured again
- **THEN** the server SHALL dedupe by URL instead of creating a second document

#### Scenario: Retrieval failure
- **WHEN** thread retrieval fails with a typed error (unavailable, rate-limited, network)
- **THEN** the server SHALL return a typed error response to the extension
- **AND** the extension SHALL surface a failure notification naming the reason

#### Scenario: App not running
- **WHEN** an X capture is triggered while the capture server is unreachable
- **THEN** the extension SHALL queue the capture using its existing offline-queue mechanism and retry when the app becomes available
