## Purpose

Enables reliable sharing of X/Twitter posts and threads from Android apps directly into Plethora with safe serialization, queued processing, accurate status reporting, and automatic reader navigation.

## ADDED Requirements

### Requirement: Android X/Twitter Share Intent Ingestion and Normalization
The Android application SHALL accept X/Twitter status URLs shared via `ACTION_SEND` and `ACTION_VIEW`, extracting valid status links from `EXTRA_TEXT`, `intent.data`, and `ClipData`. The system SHALL correctly parse URLs with `x.com` and `twitter.com` domains across `www.` and `mobile.` subdomains, `/i/status/` and `/i/web/status/` paths, and trailing query parameters, while stripping trailing punctuation from text-embedded URLs. File stream extraction SHALL be reserved strictly for `content://` and `file://` URIs and SHALL NOT treat HTTP/HTTPS URLs as local file streams.

#### Scenario: Sharing a status URL from the X Android application
- **WHEN** the user shares a post from the X app sending an `ACTION_SEND` intent with `EXTRA_TEXT` containing `https://x.com/username/status/1234567890123456789?s=20`
- **THEN** the native layer SHALL extract the normalized URL `https://x.com/username/status/1234567890123456789` without failing on missing content streams.

#### Scenario: Sharing text with an embedded status URL and trailing punctuation
- **WHEN** the user shares text formatted as `"Check out this thread: (https://x.com/username/status/1234567890123456789)."`
- **THEN** the system SHALL extract the canonical status URL `https://x.com/username/status/1234567890123456789` without trailing parenthesis or period.

### Requirement: Safe Native-to-Frontend Share Dispatch & Single Delivery
The native Android bridge SHALL safely serialize shared payloads to the frontend using valid JSON string encoding (such as `JSONObject.quote()`) before executing JavaScript evaluation, preventing script syntax errors caused by unescaped quotes, newlines, or special characters. The system SHALL dispatch each intent exactly once, deprecating parallel delivery through redundant legacy and modern custom events.

#### Scenario: Sharing a post containing quotes and newlines
- **WHEN** shared text or title contains double quotes, single quotes, and multiple lines of text
- **THEN** the native bridge SHALL evaluate JavaScript without syntax errors or parser exceptions in the WebView.

#### Scenario: Warm-start delivery without duplicate triggers
- **WHEN** a share arrives while the application is already running
- **THEN** the system SHALL deliver exactly one normalized `plethora-native-share` batch to the import listener without firing redundant duplicate callbacks.

### Requirement: Durable Share Queue and In-Flight Deduplication
The application SHALL maintain an ordered FIFO queue for incoming shares rather than dropping incoming requests while an import is in progress. The system SHALL coalesce duplicate in-flight requests for the same status URL, and SHALL reuse existing documents for already-imported threads.

#### Scenario: Receiving multiple shares during an active import
- **WHEN** a second share intent arrives while the first share is retrieving thread data over the network
- **THEN** the system SHALL enqueue the second share and process it sequentially once the active item finishes without dropping either share.

#### Scenario: Rapid re-share of the same status link
- **WHEN** the user rapidly shares the same X link twice
- **THEN** the system SHALL deduplicate the second request against the in-flight import and avoid creating duplicate document records.

### Requirement: Automatic Navigation to Native Thread Reader
Upon receiving and importing an X thread or single post from a share intent, Plethora SHALL automatically open and display the document in `XThreadViewer` without requiring manual user navigation or toast interaction. During initial network retrieval, the viewer SHALL display a loading skeleton and progress indicator.

#### Scenario: Opening imported thread directly on warm start
- **WHEN** an X thread URL is shared to a running Plethora instance
- **THEN** Plethora SHALL import the thread and immediately focus the thread viewer tab for the newly imported document.

#### Scenario: Cold-start share opens reader once UI initializes
- **WHEN** Plethora is launched from a cold start via an external share intent
- **THEN** the application SHALL process the pending share and open the thread reader as soon as the interface finishes initialization.

### Requirement: Transparent Status Reporting & Partial Thread Disclosure
The import pipeline SHALL accurately report failures when X thread retrieval cannot complete, setting an actionable error state with Retry and Open on X options instead of falsely confirming a successful import. When a multi-post thread is unavailable but the single status post is retrieved, the reader SHALL render the available post with an explicit disclaimer.

#### Scenario: Network or retrieval failure during share import
- **WHEN** an X URL cannot be retrieved due to network or provider error
- **THEN** `processSharedBatch()` SHALL report a failed count, avoid displaying a false "Imported successfully" toast, and display the typed retry state.

#### Scenario: Fallback to single post
- **WHEN** ThreadReaderApp cannot unroll a thread but GraphQL/syndication fetches the single post
- **THEN** `XThreadViewer` SHALL display the post with an alert indicating the full thread could not be retrieved.

### Requirement: Mobile Reader Navigation and Release Build Integrity
The native X thread viewer on mobile SHALL provide a back navigation control that navigates back within Plethora's tabs before falling back to web history. In release APK builds with R8 minification enabled, the native plugin methods and argument classes for share handling SHALL be retained via ProGuard consumer rules.

#### Scenario: Back button in mobile thread reader
- **WHEN** the user taps the back button in `XThreadViewer` on mobile
- **THEN** the application SHALL navigate to the previously active tab or library view.

#### Scenario: Release build plugin method invocation
- **WHEN** running a release APK build
- **THEN** `FolderImportPlugin` `@Command` and `@InvokeArg` methods SHALL NOT be stripped or obfuscated by R8.
