### Added

- **Global persistent audio playback** — One application-lifetime playback owner with checkpoint persistence: a persistent mini player dock on desktop and mobile with a lazily loaded expanded surface (transport, scrub, rate, chapters, bookmarks, sleep timer, source return, queue editing), and a single focus lease so reader TTS, video, hands-free feedback and recording capture pause competing audio instead of overlapping.
- **Suspend-aware desktop audio** — Linux (login1/BlueZ), Windows (power) and macOS (workspace) observers deliver audio-lifecycle events so suspend checkpoints keep playback paused after wake, with owner-scoped media-control workers on all platforms.
- **Android playback in the media service** — ExoPlayer-backed playback coordinator inside the existing media service: queue progression, rate, sleep, focus ducking, native transport receipts and a single MediaSession/notification.
- **Unified recording ingestion & Learning Studio** — Captured sessions are now playable and transcribable end-to-end, feeding recording study panels in the expanded player and the Learning Studio.
- **AI Learning Agent** — Explicit Learning Agent mode in the Assistant and palette with frozen scope, destination preflight, source-grounded flashcard proposals with edited/individual approval, reader worthiness indicators, knowledge prerequisite analysis, a readiness registry with capability-aware Enable All, and a diagnostics modal with redacted export.
- **Native whole-interface zoom** — Ctrl/Cmd +/−/0 scales the entire desktop interface (70–150%, persisted) with a Settings control and palette commands; document zoom keeps its toolbar actions and is renamed Zoom Document so the chords no longer collide.
- **Precise settings search** — Search resolves individual settings and meaningful groups across every reachable section with localized text and bounded typo tolerance, revealing the exact target without changing values.
- **Clearer Assistant controls** — A single Chat / Learning Agent switch with an always-visible "Answer from" grounding picker (General knowledge / This document only / My library), plus an on-screen searchable source picker replacing the dropdown.
- **Scoped remote passage-scoring consent** — Persisted, provider-scoped, finite allowances (10/25/60) counted device-locally, shown and revocable in Settings, and rehydrated on restart instead of silently re-granting.
- **Mobile knowledge-graph filters** — A responsive filter sheet with active-filter summary chips, live result counts and safe-area-aware canvases replacing the fixed sidebar.
- **RSS list article cards** — Responsive measured cards with multi-line headlines, expanded excerpt/author, a permanent details toggle and keyboard focus throughout the List view.
- **Mobile reading priority** — The priority control is reachable on phones with a themed preset sheet (five presets + fine-tune slider), safe-area-aware toolbars and labeled levels.

### Fixed & Improved

- **Linux AppImage runtime & graphics** — Isolated AppImage runtimes and refined the NVIDIA graphics policy.
- **Desktop session customization** — Restored bounded customization in the session dialog.
- **Podcast transcription** — Podcast views reuse already-saved queue transcripts instead of re-transcribing.
- **Assistant fixes** — The Learning Agent readiness message names the real blocker, the mobile model picker stays in-sheet and scrollable, and explicit response sources are preserved when generating flashcards.
- **RSS & review on mobile** — Article selection survives context menus, and the review source title is contained with a details disclosure.
