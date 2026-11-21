## Context

See `proposal.md` for motivation and scope. Currently:
- `useURLDetector` extracts `playlistId` from YouTube URLs (`list=...`), but `useURLMetadata` ignores `playlistId` and only calls `fetchYouTubeVideoInfo(videoId)`. Meanwhile, `fetchYouTubePlaylist` in `src/api/youtube.ts` is a stub returning `null` even though the Tauri backend already exposes `get_youtube_playlist_info(url: String)` in `src-tauri/src/youtube.rs` (via `yt-dlp --dump-json --flat-playlist`) and `src/lib/youtubeDataApi.ts` provides `fetchPlaylistInfo(playlistId)` for web/API-key users.
- Transcript segments in `TranscriptSync.tsx`, `TranscriptPanel.tsx`, `PodcastTranscriptViewer.tsx`, and `SessionTranscript.tsx` lack a right-click context menu (`useSurfaceMenu` + `ContextMenu`). `TranscriptSync` only renders its export button if a parent passes `onExport`, which `YouTubeViewer` and `LocalVideoPlayer` do not pass. `LocalVideoPlayer` also omits `documentId` when rendering `TranscriptSync`, disabling selection extraction.
- `DashboardTab.tsx` constructs `quickReviewCards` by slicing the first 10 documents (`front: doc.title`, `back: doc.content.slice(0, 220)`) and passes a no-op `handleQuickRate` callback.

## Goals / Non-Goals

**Goals:**
- Seamless YouTube playlist browsing and selective single/batch video importing directly inside the Command Palette dropdown (`ImportPreview`).
- Consistent right-click context menus, one-click text/timed-slice extraction, and built-in multi-format export (`.txt`, `.md`, `.srt`, `.vtt`, `.json`) across transcript viewers.
- A genuinely functional Dashboard Quick Review widget that loads real due `LearningItem` cards and persists FSRS ratings via `submitReview`.

**Non-Goals:**
- Altering the FSRS scheduling algorithm or backend SQLite schema.
- Downloading full raw video binaries during playlist metadata preview (metadata preview uses `--flat-playlist` / YouTube Data API; video import uses the existing `importYouTubeVideo` flow).

## Decisions

### 1. Playlist Resolution & Command Palette Dropdown UX
- **Decision**: Implement `fetchYouTubePlaylist(urlOrPlaylistId: string)` in `src/api/youtube.ts`. In Tauri desktop environments, invoke `get_youtube_playlist_info` with the normalized playlist URL (`https://www.youtube.com/playlist?list=${playlistId}`) and normalize `entries` into `YouTubePlaylist` (`id`, `title`, `channel`, `videoCount`, `thumbnail`, `videos: YouTubeVideo[]`). If `yt-dlp` fails or in web mode when `isYouTubeApiEnabled()` is true, fall back to `fetchPlaylistInfo(playlistId)` from `src/lib/youtubeDataApi.ts`.
- **URL Classification**: In `useURLDetector.ts` and `useURLMetadata.ts`:
  - A URL with `list=<playlistId>` and no `v=<videoId>` (e.g. `youtube.com/playlist?list=...`) immediately resolves playlist metadata.
  - A watch URL with both `v=<videoId>` and `list=<playlistId>` fetches the single video metadata AND lazily/concurrently resolves the playlist so `ImportPreview` can render a mode switch pill: `"Single Video"` vs `"Playlist (N videos)"` (defaulting to Playlist when the URL path is `/playlist`, or showing a prominent `"Browse Playlist Videos"` toggle when pasted from a watch-in-playlist URL).
- **Dropdown Video Selection UI**: Inside `ImportPreview.tsx`, `YouTubePlaylistImportPreview` renders:
  - Playlist header (title, channel, total videos, optional tags & target collection picker, and a "Subscribe to Playlist" secondary button).
  - Toolbar with inline search/filter input, "Select All / Deselect All" toggle for unimported videos, and an "Import Selected (N)" primary CTA.
  - Scrollable video list (`max-h-72 overflow-y-auto`) inside the Command Palette dropdown where each row displays: checkbox, thumbnail, video index, title, duration badge, and either an `"Imported"` pill (with `"Open"` action if already in `documents`) or an individual `"Import"` button for one-click single-video import.

### 2. Transcript Block Context Menu, Extraction, and Export Architecture
- **Decision**: Create a shared `src/utils/transcriptExport.ts` module providing pure serializers and download triggers for `TranscriptSegment[]` in five formats:
  - Plain Text (`.txt`) — optional timestamps & speakers
  - Markdown (`.md`) — structured heading, metadata, and timestamped bullet/paragraph blocks
  - SubRip (`.srt`)
  - WebVTT (`.vtt`)
  - JSON (`.json`)
- **Context Menu & Hover Actions**:
  - Use the established `useSurfaceMenu` + `ContextMenu` component in `TranscriptSync.tsx` (and wire equivalent context menus in `TranscriptPanel.tsx`, `PodcastTranscriptViewer.tsx`, and `SessionTranscript.tsx`).
  - Right-clicking a transcript block checks if there is a non-empty DOM text selection inside the transcript container. If so, menu actions operate on the selected text and resolved timestamp span (`resolveTranscriptSelectionBounds`); otherwise they operate on the right-clicked segment block.
  - Context menu items:
    1. **Create Text Extract** (`createExtract({ document_id: documentId, content, note, ... })`) — available whenever `documentId` or a custom `onCreateExtract` handler is present.
    2. **Capture Video/Audio Slice** (`createVideoExtract` / `onCaptureVideoSlice`) — available when timed slice capture is supported.
    3. **Play from Here** (`onSeek(segment.start)`) — available when `onSeek` is provided and segment is timed.
    4. **Edit Segment** — available in `SessionTranscript`.
    5. Separator + **Copy Text**, **Copy with Timestamp** (`[MM:SS] Speaker: text`), **Copy Full Transcript**.
    6. Separator + **Export Transcript** (Plain Text `.txt`, Markdown `.md`, SRT `.srt`, WebVTT `.vtt`, JSON `.json`).
  - Also add an inline export dropdown menu in the transcript header so users can export in 1–2 clicks without needing a parent `onExport` callback, and pass `documentId={documentId}` from `LocalVideoPlayer.tsx` to `TranscriptSync`.

### 3. Dashboard Quick Review Repurposing
- **Decision**: Replace the fake document-slice cards in `DashboardTab.tsx` with real due `LearningItem` flashcards loaded via `getDueItems()` (filtered by `activeDeckIds` / `activeCollectionId` when applicable, matching the app's review filtering conventions).
- Format card front/back accurately:
  - For flashcards (`item_type === "flashcard"`): `front = item.question`, `back = item.answer`.
  - For cloze cards (`item_type === "cloze"`): render masked `[...]` on the front and the revealed cloze text (plus `item.answer` if present) on the back.
  - Attach `documentTitle` from `documents.find(d => d.id === item.document_id)?.title` and `documentId: item.document_id`.
- Wire `handleQuickRate(cardId, rating)` to map `"again" | "hard" | "good" | "easy"` to `ReviewRating` (`1 | 2 | 3 | 4`), call `submitReview(cardId, numericRating, timeTakenSeconds)`, remove/advance the reviewed card, and refresh dashboard due stats (`loadStats()`).
- Add a "View Source Document" action in `QuickReviewWidget` (both on the card header/footer and right-click context menu) when `documentId` is present so users can jump straight to the card's source document if they need context.

## Risks / Trade-offs

- **[Large YouTube playlists in Command Palette]** → `yt-dlp --flat-playlist` returns lightweight entries quickly, and the dropdown list constrains height (`max-h-72 overflow-y-auto`) with client-side title filtering so 100+ video playlists remain snappy. Batch imports run sequentially with a clear progress counter (`Importing 2/5...`) to avoid spawning dozens of concurrent `yt-dlp` processes.
- **[Text selection collapsing on right-click in some webviews]** → Capture any active transcript `selectionSlice` / selected text on `mousedown` / `contextmenu` before opening the `ContextMenu` so right-clicking an existing selection preserves the multi-segment selection range.
