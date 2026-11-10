# Technical Investigation: YouTube Ingestion & Playlist Reliability

## 1. Problem Evidence

1. **`yt-dlp` Degradation**: User logs indicated `WARNING: yt-dlp is older than 90 days ... JavaScript engine missing`, leading to `403 Forbidden` errors during transcript extraction.
2. **Age-Restricted Videos**: Videos requiring age confirmation failed because `--cookies-from-browser` failed to access locked browser keyrings.
3. **Orig_06**: Dragging or typing in the default queue interval slider in `YouTubePlaylistManager.tsx` reset the value mid-keystroke.
4. **Orig_07 & Orig_15**: Video extracts remained marked "New" after being watched, and extracts could not be rated independently of their parent video.

## 2. Root Cause Analysis

1. **YouTube's Anti-Bot Challenge Evolution**:
   YouTube regularly patches its video player JavaScript (`player.js`) requiring signature deciphering (`n-sig`). Outdated `yt-dlp` or lack of Node/Deno prevents running the extraction code.
2. **Browser Keyring Constraints (`src-tauri/src/youtube.rs:591`)**:
   `--cookies-from-browser` attempts to read the active profile's SQLite cookie database. On modern OSes (Linux Secret Service, macOS Keychain, Chrome v120+ app-bound encryption), this fails silently without elevated privileges. Supporting a decrypted `cookies.txt` file is the standard industry workaround.
3. **Unbuffered Input Binding (`src/components/media/YouTubePlaylistManager.tsx:210`)**:
   The input value was linked directly to store state without local draft buffering.
4. **Missing State Column (`src-tauri/src/commands/queue.rs:612`)**:
   Video extracts had no `last_viewed_at` tracking; only review ratings updated timestamps.

## 3. Remediation Strategy

- Add `--cookies <path>` argument support in `ytdlp_command`.
- Add runtime preflight check for `yt-dlp` age and JS engine.
- Introduce draft state in `YouTubePlaylistManager.tsx`.
- Separate `last_viewed_at` from `last_reviewed_at`.
