### Added

- **Unified Assistant Experience & Conversation Architecture** — Rebuilt the AI assistant foundation with a canonical SQLite conversation repository, automated migrations, legacy conversation import, deterministic context routing, fail-closed scope authorization, and reading-state return links across desktop and mobile.
- **Mobile Assistant Chat Composer & Gesture Sheet** — Redesigned the mobile assistant with a chat-style composer, slash-command add menu, gesture-driven bottom sheet, semantic haptic feedback, native dictation integration, and compact chrome.
- **Unified Command Palette Registry** — Centralized command actions into a unified registry with expanded destination coverage and implemented previously unhandled actions.
- **Fal.ai Audio Editions** — Added Fal.ai voice synthesis integration for creating Audio Editions across desktop and mobile platforms.
- **Legal Pad Paper Theme** — Added a classic yellow Legal Pad paper texture material to the reader and theme collection.
- **Windows Sparse Package Identity** — Added sparse MSIX package identity registration and automated manifest validation for shipped Windows release artifacts.

### Fixed & Improved

- **Windows Launch & Manifest Resolution** — Fixed application startup by shipping a launchable embedded manifest and reading it directly without external mt.exe dependencies.
- **Extract Summaries Opt-in** — Made progressive-disclosure AI summaries opt-in so that reviews default to full extract content unless explicitly enabled in settings.
- **Document Q&A & Video Grounding** — Grounded single-video turns in complete transcripts and ensured Document scope grounds directly in live document evidence.
- **Android Stability & Plugin Manager** — Restored `TauriActivity` as `MainActivity` superclass to ensure plugin manager initialization and proper lifecycle handling.
- **Mobile Layout & Viewports** — Simplified mobile deck management, ensured queue customization dialogs layer above the bottom navigation bar, and kept Audio Edition cards constrained within mobile viewports.
