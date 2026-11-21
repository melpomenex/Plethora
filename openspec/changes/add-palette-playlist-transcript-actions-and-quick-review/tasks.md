## 1. Command Palette YouTube Playlist Detection & Selective Import

- [x] 1.1 Implement `fetchYouTubePlaylist` in `src/api/youtube.ts` using the Tauri `get_youtube_playlist_info` command with fallback to `fetchPlaylistInfo` from `src/lib/youtubeDataApi.ts`, and verify with unit tests that playlist metadata and video entries are normalized into `YouTubePlaylist`.
- [x] 1.2 Update `src/hooks/useURLDetector.ts` and `src/hooks/useURLMetadata.ts` to resolve playlist metadata for dedicated YouTube playlist URLs (`youtube.com/playlist?list=...`) and dual watch+playlist URLs (`v=...&list=...`), and verify with unit tests in `src/hooks/__tests__/useURLMetadata.playlist.test.ts`.
- [x] 1.3 Build `YouTubePlaylistImportPreview` in `src/components/import/ImportPreview.tsx` and wire batch/single video import in `src/components/search/GlobalSearch.tsx` with per-video checkboxes, "Select All / Deselect All", title filter input, already-imported badges, single-row import button, batch "Import Selected (N)" execution, and mode toggle when a URL has both `v=` and `list=`, verifying with component tests.

## 2. Transcript Block Context Menu, Easy Extraction, and Multi-Format Export

- [x] 2.1 Create `src/utils/transcriptExport.ts` supporting Plain Text (`.txt`), Markdown (`.md`), SubRip (`.srt`), WebVTT (`.vtt`), and JSON (`.json`) serialization and browser/Tauri file download, and verify with unit tests in `src/utils/__tests__/transcriptExport.test.ts`.
- [x] 2.2 Add a right-click context menu (`useSurfaceMenu` + `ContextMenu`), hover quick-extract button, selection floating bar "Create Extract" + "Capture Video Slice" actions, and an always-available header Export menu to `src/components/media/TranscriptSync.tsx`, and pass `documentId` in `src/components/viewer/LocalVideoPlayer.tsx`, verifying with component tests.
- [x] 2.3 Add right-click context menus with block extraction, copy, seek, and multi-format transcript export to `src/components/media/TranscriptPanel.tsx`, `src/components/podcast/PodcastTranscriptViewer.tsx`, and `src/components/recording/SessionTranscript.tsx`, verifying with component tests.

## 3. Purposeful Dashboard Quick Review

- [x] 3.1 Replace the placeholder document-title cards and no-op `handleQuickRate` in `src/components/tabs/DashboardTab.tsx` with real due `LearningItem` cards fetched via `getDueItems()` (respecting active study deck/collection filters) and FSRS rating submission via `submitReview()`, formatting cloze deletions cleanly on front/back.
- [x] 3.2 Enhance `src/components/review/QuickReviewWidget.tsx` to support opening the card's source document (via `onOpenDocument` prop and context menu item) and verify the end-to-end Dashboard Quick Review rating and source navigation flow with component tests.
