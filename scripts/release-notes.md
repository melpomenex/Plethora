### Added
- **Chatterbox Local TTS & Voice Cloning** — Integrated local text-to-speech and zero-shot voice cloning with an OpenAI-compatible API, GPU acceleration probing, and preset integration in the Create Audio Edition dialog.
- **EmbeddingGemma 2 Multimodal Embeddings** — Added EmbeddingGemma 2 support with Matryoshka Representation Learning (MRL) dimension slicing, dynamic model listing in settings, vision embeddings on mobile, and automated library re-indexing.
- **Native Mobile Haptics & Feedback Engine** — Complete native haptic feedback foundation for review grading, navigation, pull-to-refresh, and deck management, with a General settings opt-out switch.
- **Mobile Ask Sheet & Selection Actions** — Bottom-sheet Q&A composer on mobile with passage, document, and library scopes, docked citations, and intelligent gesture handling.
- **App-Wide Context Menus** — Unified right-click context menu framework delivering surface-tailored actions across documents, decks, review queues, citations, and RSS feeds.
- **Model Reasoning in Assistant Replies** — Interactive disclosure to inspect internal model thinking tokens and reasoning chains during assistant conversations.
- **Coordinated Mobile Back Navigation** — Robust multi-layer Android back handling architecture preventing startup races and coordinating drawer, sheet, and tab dismissals.

### Fixed & Improved
- **Anki Cloze & Package Export** — Correctly map raw cloze markers to native Anki clozes during APKG and CSV exports, and connect native file save dialogs to deck exports.
- **TTS Chunk Recovery & Subprocess Safety** — Resume failed read-aloud chunks at the active reading position without restarting from the beginning, cap request payloads at 500 characters, and sanitize AppImage Python environments.
- **Dynamic Adaptive Queue Engine (DAQE)** — Consult the decision model immediately on initial queue loading when adaptive ranking is active.
- **RSS Feed Reading & Selection** — Retain unread item selection and scroll offsets during reading sessions, and expose full document selection menus in article readers.
- **Mobile Reader & UI Polish** — Correct EPUB cover aspect ratios, improve reader table-of-contents navigation, refine pull-to-refresh animations, and restore transparency for animated background themes.
- **Android Native Library Packaging** — Resolve startup back recovery races and enable legacy packaging so native libraries extract reliably to native directories.
