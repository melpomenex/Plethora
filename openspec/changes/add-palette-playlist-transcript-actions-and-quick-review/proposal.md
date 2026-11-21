## Why

Three high-frequency study workflows currently have friction or broken placeholder behavior:
1. **Command Palette YouTube Playlist Import**: Pasting a YouTube playlist URL into the Command Palette fails to show the playlist's videos because `useURLMetadata` only inspects single-video IDs and `fetchYouTubePlaylist` is an unimplemented stub, forcing users out of the palette into separate settings panels.
2. **Transcript Block Context Menu, Extraction, and Export**: Transcript blocks lack a right-click context menu, require cumbersome manual text selection to create extracts, and hide or omit transcript export controls when parent viewers (`YouTubeViewer`, `LocalVideoPlayer`, `PodcastManager`) do not supply an `onExport` handler.
3. **Dashboard Quick Review**: The Dashboard's Quick Review widget currently maps the first 10 documents' titles and raw content prefixes into fake cards and passes a no-op `handleQuickRate` callback, meaning rating items on the dashboard has zero effect on spaced repetition or scheduling.

## What Changes

- **Command Palette YouTube Playlist Dropdown & Selective Import**:
  - Implement `fetchYouTubePlaylist` in `src/api/youtube.ts` backed by the Tauri `get_youtube_playlist_info` command (`yt-dlp --dump-json --flat-playlist`) with automatic fallback to `fetchPlaylistInfo` from `src/lib/youtubeDataApi.ts` when a YouTube Data API key is configured.
  - Update `useURLDetector` and `useURLMetadata` so YouTube playlist URLs (`youtube.com/playlist?list=...`) and watch URLs carrying a `list=` parameter resolve playlist metadata and video entries. For watch URLs that include both `v=` and `list=`, allow toggling between single-video import and playlist video selection.
  - Add an interactive playlist video dropdown list inside `ImportPreview` in the Command Palette with per-video checkboxes, "Select All / Deselect All", filter/search within the playlist, duplicate detection badges for already-imported videos, single-click per-video import, batch "Import Selected (N)" execution, and optional "Subscribe to Playlist".
- **Transcript Block Right-Click Context Menu, Easy Extraction, and Multi-Format Export**:
  - Add a right-click context menu (`useSurfaceMenu` + `ContextMenu`) and hover quick-action buttons to transcript blocks in `TranscriptSync` (used by YouTube, Local Video, and Podcast viewers), `TranscriptPanel`, `PodcastTranscriptViewer`, and `SessionTranscript`.
  - Include context-appropriate actions on right-click: **Create Text Extract** (from current selection or clicked block via `createExtract`), **Capture Video/Audio Slice** (for timed media via `createVideoExtract` or `onCaptureVideoSlice`), **Play from Here** (`onSeek`), **Copy Block Text**, **Copy Block with Timestamp**, **Copy Full Transcript**, and **Export Transcript**.
  - Enhance the transcript selection floating action bar in `TranscriptSync` so selecting text offers both **Create Extract** (text extract) and **Capture Video Slice** (timed media clip), and pass `documentId` from `LocalVideoPlayer` into `TranscriptSync`.
  - Add a built-in multi-format export menu to transcript headers and right-click menus supporting **Plain Text (`.txt`)**, **Markdown (`.md`)**, **SRT Subtitles (`.srt`)**, **WebVTT (`.vtt`)**, and **JSON (`.json`)** download or clipboard copy without requiring parent components to wire a custom `onExport` prop.
- **Purposeful Dashboard Quick Review**:
  - Repurpose the Dashboard's `QuickReviewWidget` integration in `DashboardTab.tsx` from fake document cards with a no-op handler to real due flashcards/learning items fetched via `getDueItems` (respecting active study deck/collection filters) and rated via `submitReview` using real FSRS ratings (`Again`, `Hard`, `Good`, `Easy`).
  - Format cloze deletions cleanly on card front/back, display source document title and due count, allow jumping to the source document or expanding into the full Review tab, and refresh dashboard due counts upon rating.

## Capabilities

### New Capabilities
- `command-palette-youtube-playlist-import`: Detect YouTube playlist URLs in the Command Palette, preview playlist videos in an interactive dropdown list, and import user-selected videos or subscribe to the playlist.
- `transcript-block-actions-and-export`: Right-click context menu on transcript blocks, one-click text/slice extraction from blocks or selections, and built-in multi-format transcript export (`.txt`, `.md`, `.srt`, `.vtt`, `.json`).
- `dashboard-quick-review`: Actionable dashboard Quick Review widget backed by real due `LearningItem` cards and FSRS `submitReview` persistence.

### Modified Capabilities
<!-- None -->

## Impact

- **Command Palette & URL Import**: `src/hooks/useURLDetector.ts`, `src/hooks/useURLMetadata.ts`, `src/api/youtube.ts`, `src/components/import/ImportPreview.tsx`, `src/components/search/GlobalSearch.tsx`.
- **Transcript Viewers & Export**: `src/components/media/TranscriptSync.tsx`, `src/components/media/TranscriptPanel.tsx`, `src/components/podcast/PodcastTranscriptViewer.tsx`, `src/components/recording/SessionTranscript.tsx`, `src/components/viewer/YouTubeViewer.tsx`, `src/components/viewer/LocalVideoPlayer.tsx`, `src/utils/transcriptExport.ts`.
- **Dashboard Quick Review**: `src/components/tabs/DashboardTab.tsx`, `src/components/review/QuickReviewWidget.tsx`.
