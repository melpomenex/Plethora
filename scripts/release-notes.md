### Added

- **Unified session chrome & end-of-item triage** — Consolidated reading and review session headers with a provenance pill (`QueueProvenancePill`) showing why an item appeared, plus an end-of-item triage bar (`EndOfItemTriageBar`) for fast post-item actions.
- **Split Q&A / Cloze creation & chained clozes** — Dedicated `QACreatorPopup` and `ClozeCreatorPopup` with inline selection action bar support and chained cloze creation for multi-part cards.
- **Progressive disclosure density modes** — Switch between UI density modes (`uiStore`) to declutter reading and review surfaces, paired with expanded command palette actions and navigation.
- **Ghost Context Peek & Subway Minimap** — Preview surrounding source context inline during review (`GhostContextPeek`) and navigate long documents via a visual `SubwayMinimap`.
- **Timebox session playlists** — Build timeboxed study playlists (`TimeboxSessionLauncher` and `timeboxPlaylistBuilder`) tailored to available session minutes.
- **Triage Compost Sweep & Leech Refactor Wizard** — Batch-sweep stale or postponed queue items with `TriageCompostSweepModal` and split or rewrite stubborn leeches inline with `LeechRefactorWizard`.
- **Transcript video slicing & role-voice TTS PiP** — Extract timed video slices directly from `TranscriptSync`, and listen with multi-voice/role-voice TTS in a persistent `MiniAudioPlayer` picture-in-picture bar.
- **Breakout View & Socratic Margin** — Open focused `BreakoutOverlayModal` views for dense content and iframes, and ask/reflect in-context with `SocraticMarginThread` alongside documents, EPUBs, and markdown.
- **Today's Horizon & Knowledge Gap queue injection** — See daily learning focus in `TodaysHorizonBanner` on the dashboard and inject targeted items from `KnowledgeGapCard` directly into the active queue.
- **Graceful AI fallbacks & Knowledge Graph heatmaps/lasso** — Degrade cleanly when AI providers are unavailable (`GracefulAiFallbackCard`), and explore `ObsidianGraph` with mastery/activity heatmaps and lasso multi-selection.
- **Ingestion Airlock & automatic heading splitter** — Stage, preview, and split incoming documents by headings (`IngestionAirlockModal`, `documentHeadingSplitter`) before committing them to the library.
- **Mobile thumb-arc & double-tap ergonomics** — Redesigned `MobileQueueView` with one-handed thumb-arc controls and double-tap gestures.

### Fixed & Improved

- **EPUB & HTML iframe shortcuts and Breakout View** — Forward keyboard shortcuts reliably out of EPUB/HTML iframes, guard `j`/`k` navigation against modifier keys, and support Breakout View inside iframe viewers.
- **Ingestion Airlock & mobile fallbacks** — Wired `IngestionAirlockModal` into `ImportNeedsReviewPage` and added default thumb-arc fallbacks in `MobileQueueView`.
- **CI build performance across all platforms** — Parallelized Cargo release builds (`CARGO_BUILD_JOBS=4`) on Linux, macOS, Windows, and Android, disabled ThinLTO on 16 GB CI runners, added Windows Defender exclusions, and removed redundant frontend/sidecar build passes.
