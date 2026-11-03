### Added

- **Local media playback codec compatibility** — Dynamic media compatibility engine with codec probing, hardware-accelerated transcoding, cache management, and on-the-fly streaming fallback so unsupported formats (H.265/HEVC, AV1, VP9, proprietary audio codecs) play smoothly within the local media viewer.
- **Contextual Assistant reading & study actions** — Action strip for instant contextual exploration directly from reader and review views, supporting quick explanations, study prompts, concept breakdowns, and flashcard generation.
- **Learning Agent contract & tool orchestration** — Pinned provider and model bindings throughout agent runs to prevent drift, typed turn outcomes with truncated/empty response separation, structured flashcard batch proposals (`propose_flashcard_batch`), bounded recovery protocols, and full trace export with diagnostic telemetry.
- **Shared section mention picker** — Restored shared section picker across Assistant and reader contexts with fuzzy matching and document-anchored navigation.

### Fixed & Improved

- **Library QA response recovery** — Robust recovery and fallback handling when AI providers return empty or unparseable payloads during document and library Q&A.
- **Apple Foundation Model flashcards** — Reliable card creation and formatting for Apple Foundation Models integration on macOS.
- **Uniform reading priority** — Normalized priority calculations and interactions across all learning item types, with synchronized Alt+P shortcut handling for the scroll priority overlay.
- **Video extract queue & review lifecycle** — Repaired extract membership tracking and review lifecycle state transitions for video captures.
- **Queue scroll position preservation** — Assistant view maintains scroll position and reading context when advancing between queue items.
- **Filtered browser save document queries** — Fixed SQLite query filtering when importing browser captures.
- **Passage scoring overlay** — Cleanly hides the passage scoring overlay when scoring is disabled in settings.
- **Desktop Assistant provider picker** — Improved layout and bounded positioning so the model selection menu stays fully on-screen.
- **Linux WebKit repaint performance** — Disabled main window transparency under Linux to eliminate WebKit repaint artifacts.
- **macOS audio lifecycle stability** — Inferred Objective-C callback receiver lifetimes to prevent crashes on wake/suspend.
- **AppImage runtime permissions** — Normalized permissions for bundled runtime sidecars inside Linux AppImages.
