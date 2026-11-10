# Architectural Design: Improve YouTube Ingestion & Playlist Reliability

## Problem Diagnosis

### 1. `yt-dlp` Deprecation & Missing JS Runtime
In `src-tauri/src/youtube.rs`:
YouTube frequently updates its JavaScript-based `n-sig` challenge to mitigate scraping. `yt-dlp` relies on external JavaScript engines (such as Deno, Node, or QuickJS) to evaluate these tokens. When `yt-dlp` is older than 90 days or no JS runtime is on the system `$PATH`, yt-dlp emits:
`WARNING: yt-dlp is older than 90 days ... JavaScript engine missing`
and fails to extract video streams or transcripts. Plethora currently lacks preflight detection of `yt-dlp` health.

### 2. Cookie Authentication & Age-Restricted Videos
In `src-tauri/src/youtube.rs:613, 1028`:
Plethora calls `ytdlp_command()` with `--cookies-from-browser <browser>`.
On Linux, containerized, or sandboxed environments, browser cookie stores are often encrypted with OS keyrings (GNOME Keyring / KWallet) or locked by running browser instances, causing `--cookies-from-browser` to fail.
Users who export a standard Netscape-formatted `cookies.txt` file had no way to configure Plethora to use `--cookies /path/to/cookies.txt`.

### 3. Playlist Slider State Racing
In `src/components/media/YouTubePlaylistManager.tsx:210`:
The playlist interval and priority sliders were bound directly to async store actions without draft buffering. Fast dragging or number input keystrokes caused out-of-order API updates and unexpected resets (`orig_06`).

### 4. Video Extract "New" vs "Seen" State
In `src-tauri/src/commands/queue.rs:612`:
Video extracts only tracked `last_reviewed_at`. Opening or playing a video extract did not record a viewing event, leaving the item permanently badged as "New" in queue views (`orig_07`).

## Architectural Solutions

### 1. Cookie File Support & Authentication Pipeline
1. Extend `UserSettings` with `youtubeCookieFilePath: string | null`.
2. In `src-tauri/src/youtube.rs`:
   ```rust
   pub fn build_ytdlp_auth_args(settings: &UserSettings) -> Vec<String> {
       if let Some(path) = &settings.youtube_cookie_file_path {
           if std::path::Path::new(path).exists() {
               return vec!["--cookies".to_string(), path.clone()];
           }
       }
       // Fallback to browser cookies
       vec![]
   }
   ```
3. Prioritize user-configured `cookies.txt` over browser probing, ensuring 100% success for age-restricted and member-only videos.

### 2. Runtime Preflight Diagnostics
Implement Tauri command `check_youtube_runtime_health`:
- Runs `yt-dlp --version`. If release date is > 90 days old, flags `ytdlp_outdated: true`.
- Checks for `deno`, `node`, or `bun` on `$PATH`. If none found, flags `js_engine_missing: true`.
- Exposes diagnostic status in Settings -> Media with a "How to resolve" modal.

### 3. Draft & Commit Pattern for Playlist Settings
In `YouTubePlaylistManager.tsx`:
- Maintain local draft state for interval and priority sliders.
- Provide "Save Changes" and "Revert" actions.
- Automatically debounce auto-save after 800ms of user idle time.

### 4. Distinct Viewing & Review States for Video Extracts
In `video_extracts` table (or external metadata):
- Column `last_viewed_at TEXT`: Updated whenever the user opens the video player and plays $\ge 5$ seconds.
- Column `last_reviewed_at TEXT`: Updated strictly when the user rates the video extract in a review session.
- UI status pills:
  - `New`: `last_viewed_at IS NULL AND last_reviewed_at IS NULL`.
  - `Seen`: `last_viewed_at IS NOT NULL AND last_reviewed_at IS NULL`.
  - `Reviewed`: `last_reviewed_at IS NOT NULL`.
