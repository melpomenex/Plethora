# Verification Plan: YouTube Ingestion & Playlist Reliability

## Automated Test Suites

### T01: YouTube Runtime Health Diagnostic Suite (Rust)
- File: `src-tauri/src/__tests__/youtube_health_tests.rs`
- Scenarios:
  - Mock `yt-dlp` output returning an old date (>90 days). Verify command returns `ytdlp_outdated: true`.
  - Mock absence of Deno/Node on path. Verify command returns `js_engine_missing: true`.

### T02: Custom Cookies Argument Suite (Rust)
- File: `src-tauri/src/__tests__/youtube_auth_tests.rs`
- Scenarios:
  - Provide valid temp `cookies.txt` path. Call `build_ytdlp_auth_args`. Assert output contains `["--cookies", path]`.
  - Provide non-existent path. Assert output falls back gracefully to default browser search without crashing.

### T03: Playlist Draft Persistence Suite (Vitest)
- File: `src/components/media/__tests__/YouTubePlaylistManager.draft.test.tsx`
- Scenarios:
  - Type rapidly into interval input. Assert intermediate values are stored in local draft without premature store dispatch.
  - Click Save Changes. Verify store action is invoked exactly once with final value.

### T04: Video Extract Viewed State Transition (Rust)
- File: `src-tauri/src/database/__tests__/video_extract_lifecycle_tests.rs`
- Invariant: Call `record_video_extract_view(extract_id)`. Assert `last_viewed_at` is set, `last_reviewed_at` remains NULL, and status queries report `Seen`.

## Performance Benchmark Gate

- Command: `npm run bench:check`
- Assert that cookie file validation and playlist draft reconciliation adds zero overhead to media playback start times.

## Current Issue #6 acceptance


| IDs | Task | Evidence |
| --- | --- | --- |
| Y01 | 4.1 | Existing manager persistence suite covers component behavior. Native save/refresh/import/restart remains pending. |
| Y02 | 4.2 | Version/JS health command exists without a frontend caller. Cookie setter is process-local and startup has no restore. Actual command classification, first-launch hydration and restricted-content qualification remain pending. |
