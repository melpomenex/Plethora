# Traceability Matrix: YouTube Ingestion & Playlist Reliability

| Issue Concern | Root Cause Anchor | Requirement | Implementation Tasks | Verification Package |
|---|---|---|---|---|
| **Issue Report**: Outdated yt-dlp / JS missing warning | `src-tauri/src/youtube.rs:591` | `youtube-ingestion-and-playlist-reliability`: YouTube runtime health diagnostics | Tasks 1.3, 3.1 | T01: YouTube health diagnostic suite |
| **Issue Report**: Age-restricted video sign-in block | `src-tauri/src/youtube.rs:613` | `youtube-ingestion-and-playlist-reliability`: Custom YouTube cookies.txt file authentication | Tasks 1.1, 1.2, 1.4, 3.1 | T02: Custom cookies argument suite |
| **Orig_06**: Playlist default interval resets on typing | `src/components/media/YouTubePlaylistManager.tsx:210` | `youtube-ingestion-and-playlist-reliability`: Disambiguated video extract states | Tasks 2.1, 2.4 | T03: Playlist draft persistence test |
| **Orig_07**: Video extract remains New after open | `src-tauri/src/commands/queue.rs:612` | `youtube-ingestion-and-playlist-reliability`: Disambiguated video extract states | Tasks 2.2, 2.3 | T04: Video extract viewed state test |
| **Orig_15**: Independent extract rating vs parent video | `src-tauri/src/commands/video.rs` | `youtube-ingestion-and-playlist-reliability`: Disambiguated video extract states | Tasks 2.2, 2.3 | T04: Video extract viewed state test |
| **AGENTS.md**: Settings search discoverability | `src/components/settings/search/settingsSearchCatalog.ts` | `youtube-ingestion-and-playlist-reliability`: Custom YouTube cookies.txt file authentication | Tasks 3.1, 3.2, 3.3, 3.4 | T05: Settings search catalog coverage gate |
