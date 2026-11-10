# Tasks: Improve YouTube Ingestion & Playlist Reliability

## 1. Cookie Authentication & Ingestion Robustness

- [ ] 1.1 Add `youtube_cookie_file_path: Option<String>` to settings in `src-tauri/src/models/settings.rs` and `src/stores/settingsStore.ts`.
- [ ] 1.2 Update `try_with_browser_cookies` and `ytdlp_command` in `src-tauri/src/youtube.rs` to prioritize `--cookies <path>` when a cookie file is configured.
- [ ] 1.3 Add Tauri command `check_youtube_runtime_health` in `src-tauri/src/commands/video.rs` probing `yt-dlp` version age and JS engine availability.
- [ ] 1.4 Add Rust unit tests in `src-tauri/src/youtube.rs` verifying that valid cookie paths generate appropriate `--cookies` arguments.

## 2. Playlist Settings Drafts & Video Extract State

- [ ] 2.1 Refactor `src/components/media/YouTubePlaylistManager.tsx` to use local draft state with explicit save and 800ms debounce for interval and priority sliders.
- [ ] 2.2 Add `last_viewed_at` column tracking to video extracts in `src-tauri/src/commands/video.rs`.
- [ ] 2.3 Update queue queries in `src-tauri/src/commands/queue.rs` to distinguish `New`, `Seen`, and `Reviewed` video extracts.
- [ ] 2.4 Add component test in `src/components/media/__tests__/YouTubePlaylistManager.draft.test.tsx` verifying slider typing does not trigger race condition resets.

## 3. Settings UI & Search Catalog Coverage

- [ ] 3.1 Add YouTube Cookie File picker and Runtime Health status indicator in `src/components/settings/sections/MediaSettings.tsx`.
- [ ] 3.2 Add stable DOM `id="setting-youtube-cookie-file"`.
- [ ] 3.3 Register `setting-youtube-cookie-file` in `src/components/settings/search/settingsSearchCatalog.ts` under `SettingsTab.Media`.
- [ ] 3.4 Add search coverage test in `src/components/settings/search/__tests__/settingsSearchCatalog.test.ts`.
- [ ] 3.5 Run `npm run bench:check` to ensure no performance regression.
