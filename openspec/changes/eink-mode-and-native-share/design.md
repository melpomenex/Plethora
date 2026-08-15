## Context

Incrementum has evolved into a full-featured incremental reading and spaced repetition workstation, now compiling for desktop (macOS, Linux, Windows), mobile (Android, iOS), and web/PWA. However, mobile reading workflows face two notable friction points:
1. **E-Ink Devices**: Devices like Onyx BOOX, Palma, Bigme, and custom e-readers utilize e-paper displays where high refresh rates and continuous animations cause severe ghosting, battery drain, and visual artifacts. Existing themes use gradients, glassmorphism, backdrop filters, and smooth scrolling that look suboptimal on e-paper.
2. **Native Mobile Share**: Capturing links, PDFs, EPUBs, and articles while on mobile requires opening Incrementum, navigating to the Documents/Import modal, and manually pasting or picking files. While an initial basic URL handler existed on Android, it lacked multi-type support, robust cold-start queuing, `content://` streaming safety, multi-file sharing, text+provenance extraction, and iOS parity.

## Goals / Non-Goals

**Goals:**
- Provide a first-class **E-Ink Display Mode** with `Standard`, `E-Ink`, and `Auto` selection, persisted per-device.
- Implement conservative E-ink hardware detection (Onyx/BOOX, e-paper properties) with manual override always active.
- Global high-contrast, monochrome CSS profile via `data-display-mode="eink"`, disabling glassmorphism, gradients, blurs, and decorative animations, while forcing reduced motion and discrete scrolling.
- Optimize EPUB, PDF, and reflowed article readers for paginated page turning, minimal reading chrome, touch tap zones, and hardware volume key navigation.
- Build a universal native mobile share target on Android and iOS supporting URLs, plain text, text + source URL, PDFs, EPUBs, images, documents, and media.
- Safe native staging of `content://` URIs directly to `<filesDir>/imports/` without base64 JSON IPC bridging.
- Durable pending share queue state machine preventing payload loss across cold starts, warm starts, and repeated shares.
- Direct routing of all incoming shares into Incrementum's established `documentStore` and `importFromFiles` / `importFromUrl` pipelines.

**Non-Goals:**
- Creating a proprietary, brittle BOOX-only vendor SDK dependency (the architecture provides generic fallback and abstract controller hooks).
- Re-architecting desktop theme definitions or breaking existing themes.
- Creating a separate second document database or divergent share-only document schema.
- Disrupting media playback volume controls when audiobooks, podcasts, or TTS read-aloud sessions are actively playing.

## Decisions

### 1. Presentation-Driven Display Mode vs. Theme Replacement
- **Decision**: E-Ink mode is implemented as a display mode capability layered on top of the active theme (`data-display-mode="eink"` on `document.documentElement`), rather than replacing the user's theme selection.
- **Rationale**: Keeps theme preferences intact. When switching from Standard to E-Ink and back, the user's chosen theme (e.g. `milky-matcha` or `modern-dark`) is fully preserved. The E-ink presentation layer uses CSS overrides to convert theme variables into high-contrast monochrome values, solid borders, and zero-animation rules.
- **Alternatives Considered**: Creating an "E-Ink" theme. *Rejected* because selecting an E-ink theme erases the user's previous theme choice and fails to govern non-theme behaviors like reader pagination, tap zones, and hardware buttons.

### 2. Device-Local Preference Storage
- **Decision**: Store display mode (`standard` | `eink` | `auto`) in local storage (`incrementum-display-mode`) rather than syncing it across devices in Yjs/cloud sync.
- **Rationale**: An e-reader device needs E-ink mode, but the user's desktop or phone should not automatically switch to E-ink mode when opening the app.
- **Alternatives Considered**: Storing in global synced settings. *Rejected* due to cross-device synchronization conflicts.

### 3. Native Intent Queue & State Machine in Android Bridge
- **Decision**: Enhance `FolderImportPlugin.kt` / native bridge with a thread-safe `pendingPayloads` queue. When an Android share intent arrives (in `onCreate` or `onNewIntent`), the native layer stages any `content://` streams into `<filesDir>/imports/`, builds a normalized JSON payload, and appends it to `pendingPayloads`. Once the frontend calls `registerShareListener` / `consumePendingShares`, all queued items are emitted and acknowledged.
- **Rationale**: Prevents race conditions during cold start where the Android Activity receives an intent before the WebView has initialized React and SQLite.
- **Alternatives Considered**: Calling `evaluateJavascript` directly from Kotlin `handleIntent`. *Rejected* because if the webview is not yet ready, the script execution is dropped.

### 4. Zero-Base64 Direct Stream Staging for `content://` URIs
- **Decision**: Use Android `ContentResolver.openInputStream` piped directly to `FileOutputStream` in native Kotlin worker threads, querying `OpenableColumns.DISPLAY_NAME` and MIME types. Rust and TypeScript only receive the local file path.
- **Rationale**: Multi-megabyte PDFs or audiobooks would cause memory spikes or OOMs if passed across IPC as base64 JSON strings.

### 5. Reader Tap Zones & Volume Button Key Handling
- **Decision**:
  - Tap zones are implemented in a lightweight wrapper inside reader components (`EPUBViewer`, `PDFViewer`, `DocumentViewer`). The wrapper uses touch coordinate checking on `touchend` and cancels if a text selection or multi-touch gesture occurred.
  - Hardware volume buttons are intercepted in `MainActivity.dispatchKeyEvent` on Android, forwarding keydown events with `key: "VolumeDown"` / `"VolumeUp"`. If the reader's keydown handler calls `e.preventDefault()`, the native side skips `adjustSystemVolume`. If audio/TTS is playing or no reader is focused, `preventDefault` is not called and the system audio volume adjusts normally.

## Risks / Trade-offs

- **[Risk]** Manufacturer-specific e-ink devices may send unexpected intent extras or non-standard key codes.
  - **Mitigation**: Base e-ink mode on standard web/DOM APIs, standard Android key events (`KEYCODE_VOLUME_UP/DOWN`), and standard `ACTION_SEND` intents.
- **[Risk]** Heavy PDFs in E-ink mode might trigger high repaints during scrolling.
  - **Mitigation**: Default PDF viewer to paginated discrete page mode when in E-Ink display mode.
- **[Risk]** Sharing very large files while device storage is full.
  - **Mitigation**: Catch file I/O exceptions in native staging, delete incomplete partial files, and return an error message to the frontend toast without crashing.
