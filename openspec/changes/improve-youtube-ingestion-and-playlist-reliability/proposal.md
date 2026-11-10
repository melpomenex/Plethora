## Why

YouTube video and transcript ingestion is a vital pipeline for multimedia learning in Plethora. However, ingestion currently fails when `yt-dlp` is older than 90 days or missing a JavaScript runtime (due to YouTube's evolving `n-sig` bot-detection challenges), age-restricted and member-only videos fail because Plethora cannot accept an exported `cookies.txt` file, playlist settings suffer from keystroke race conditions during editing (`orig_06`), and video extracts remain marked "New" even after the user has watched them (`orig_07`). Resolving these pipeline hurdles ensures reliable video study.

## What Changes

- Add custom `cookies.txt` file selection in Settings and forward it to `yt-dlp` via `--cookies` in `src-tauri/src/youtube.rs`.
- Add runtime health checks for `yt-dlp` version age and JavaScript engine (Deno/Node) availability, alerting the user with actionable upgrade instructions before ingestion fails.
- Introduce draft state and explicit save handling in `YouTubePlaylistManager.tsx` for playlist default interval and priority sliders.
- Formalize video extract lifecycles: distinguish "Seen" (watched/opened) from "Reviewed" (rated via FSRS) in `src-tauri/src/commands/queue.rs`.
- Register YouTube cookie file setting in the Settings Search Catalog (`setting-youtube-cookie-file`).

## Capabilities

### New Capabilities

- `youtube-ingestion-and-playlist-reliability`: Authenticated YouTube video and transcript ingestion using custom cookie files, runtime dependency diagnostics, and atomic playlist settings management.

### Modified Capabilities

- `playlist-settings-persistence`: Draft validation and explicit commit for playlist configuration.
- `video-extract-review-lifecycle`: Seen and reviewed are distinct persisted states.
- `settings-search-coverage`: Register YouTube cookie file in settings catalog.

## Impact

- **Backend**: `src-tauri/src/youtube.rs`, `src-tauri/src/commands/video.rs`, `src-tauri/src/commands/queue.rs`.
- **Frontend**: `src/components/media/YouTubePlaylistManager.tsx`, `src/components/settings/sections/MediaSettings.tsx`.
- **Settings Search**: `src/components/settings/search/settingsSearchCatalog.ts`, `src/components/settings/search/settingsSearchCoverage.ts`.
- **Invariants**: Stored transcripts and video extracts remain compatible. No destructive schema changes.
