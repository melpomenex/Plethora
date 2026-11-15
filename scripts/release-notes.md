### Added

- **Unified session chrome & end-of-item triage** — Streamlined reading/review session header with split Q&A/cloze authoring, chained cloze creation, and end-of-item triage controls.
- **Progressive disclosure & navigation** — Added density modes, expanded command palette navigation, ghost context peek, and subway minimap.
- **Timebox playlists & leech refactor** — Create timeboxed study playlists, sweep stale queue items with triage compost, and refactor leeches inline.
- **Media, breakout & Socratic margin** — Added transcript video slicing, role-voice TTS picture-in-picture, iframe Breakout View overlay, and Socratic margin annotations.
- **Today's Horizon & graph tools** — Added Today's Horizon planning, gap queue injection, graceful AI fallbacks, and study graph heatmaps and lasso selection.
- **Ingestion airlock & mobile ergonomics** — Added an ingestion airlock staging buffer for imports and mobile thumb-arc / double-tap ergonomics.

### Fixed & Improved

- **Iframe shortcut forwarding & Breakout View** — Forward keyboard shortcuts from EPUB/HTML iframes, guard `j`/`k` modifiers, and support iframe Breakout View.
- **CI build performance** — Parallelized Cargo release builds across desktop and Android runners, disabled ThinLTO on 16 GB CI runners, added Windows Defender exclusions, and removed redundant frontend/sidecar build passes.
