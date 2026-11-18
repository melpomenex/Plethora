### Added

- **Custom OKLCH image-to-theme creator** — Upload any image to automatically generate a balanced, accessible OKLCH color theme (`ImageThemeModal`), with live preview, mobile WebView file-upload support, and fuzzy search in the Theme Gallery.
- **Knowledge Atlas, Directory View & Context Inspector** — Redesigned the Knowledge Graph with a Knowledge Atlas, hierarchical Directory View, and a Context Inspector for exploring connected concepts and sources.
- **Settings Integrations master-detail redesign** — Rebuilt the Settings Integrations tabs into a responsive master-detail layout for cleaner navigation across desktop and mobile.
- **Guided Reading Trails & Study Queue checks** — Added an end-to-end guided study trail pipeline with a `StudyQueueView`, `GuidedReadingPanel` navigation, and inline multiple-choice comprehension checks.
- **Cactus Compute Mirage vision engine** — Integrated the Mirage vision engine across document ingestion, image occlusion, FTS5 full-text search, and the browser clipper.
- **Instant local media playback & HLS streaming** — Added instant local media playback and HTTP Live Streaming (HLS) support for smoother video and audio scrubbing.
- **Mobile Assistant chat & history** — Added New Chat and Recent Chat History support to the mobile assistant.
- **Mouse & wheel navigation across views** — Support mouse back/forward buttons globally across views, horizontal wheel page turning in the reader, and EPUB iframe mouse navigation.
- **Right-click context menus** — Added right-click context menus across all dashboard elements and audiobook cards.
- **Plethora Capture 1.16.0** — Persisted highlights and smart-tag extracts in the browser extension with upgraded priority UX.

### Fixed & Improved

- **Startup & document loading performance** — Accelerated app launch and streamlined the startup lifecycle, added `epub_server` for instant document/EPUB loading, batched query embeddings with precomputed corpus analysis for study trails, and added a scoped document lexical fast-path for retrieval.
- **Video playback & transcription** — Preserved and flushed initial seek positions across HLS and compatibility streams, auto-hid controls on mouse inactivity, added CORS headers to HLS stream routes, cached X/Twitter videos with inline transcription, and supported Cactus Whistle (`Needle`) in `generate_video_transcript`.
- **DAQE & decision-model ranking** — Wired Clef and decision-model ranking and added the Gemini decision model.
- **Assistant & study plans** — Persisted assistant panel conversations to SQLite with unified video/document keys, isolated text selection/context menus/scroll position, allowed resuming study plan generation jobs after reviewing updated model/embedding configs, and fixed mobile button wrapping and theme-aware surface tokens.
- **EPUB, PDF & HTML reading** — Resolved relative section resource URLs with local server CSP support in EPUBs, clipped PDF passage highlights, and supported converted HTML views.
- **UI layering, themes & shortcuts** — Fixed Theme Gallery and modal layering (`ResponsiveDialogSheet` on mobile), prevented preview/revert flicker loops in `ImageThemeModal`, clamped off-screen menus, wired default keybindings through `useShortcutStore`, and hid mobile-only settings on desktop.
- **Android & Linux packaging** — Preserved `RustWebChromeClient` file chooser when hooking permissions on Android, updated the Android launcher icon to a transparent bird-only icon, and updated the Linux AppImage packaging script and tests.
- **Handbook documentation** — Documented guided reading trails, media streaming, Mirage vision, and UX overhaul features/shortcuts across all 6 locales.
