# Traceability Matrix: YouTube Ingestion & Playlist Reliability

| Issue Concern | Root Cause Anchor | Requirement | Implementation Tasks | Verification Package |
|---|---|---|---|---|
| **Issue Report**: Outdated yt-dlp / JS missing warning | `src-tauri/src/youtube.rs:591` | `youtube-ingestion-and-playlist-reliability`: YouTube runtime health diagnostics | Tasks 1.3, 3.1 | T01: YouTube health diagnostic suite |
| **Issue Report**: Age-restricted video sign-in block | `src-tauri/src/youtube.rs:613` | `youtube-ingestion-and-playlist-reliability`: Custom YouTube cookies.txt file authentication | Tasks 1.1, 1.2, 1.4, 3.1 | T02: Custom cookies argument suite |
| **Orig_06**: Playlist default interval resets on typing | `src/components/media/YouTubePlaylistManager.tsx:210` | `youtube-ingestion-and-playlist-reliability`: Disambiguated video extract states | Tasks 2.1, 2.4 | T03: Playlist draft persistence test |
| **Orig_07**: Video extract remains New after open | `src-tauri/src/commands/queue.rs:612` | `youtube-ingestion-and-playlist-reliability`: Disambiguated video extract states | Tasks 2.2, 2.3 | T04: Video extract viewed state test |
| **Orig_15**: Independent extract rating vs parent video | `src-tauri/src/commands/video.rs` | `youtube-ingestion-and-playlist-reliability`: Disambiguated video extract states | Tasks 2.2, 2.3 | T04: Video extract viewed state test |
| **AGENTS.md**: Settings search discoverability | `src/components/settings/search/settingsSearchCatalog.ts` | `youtube-ingestion-and-playlist-reliability`: Custom YouTube cookies.txt file authentication | Tasks 3.1, 3.2, 3.3, 3.4 | T05: Settings search catalog coverage gate |

## Current Issue #6 crosswalk


| IDs | Task | Evidence |
| --- | --- | --- |
| Y01 | 4.1 | Existing manager persistence suite covers component behavior. Native save/refresh/import/restart remains pending. |
| Y02 | 4.2 | Version/JS health already exists. Cookie setter is process-local. Actual command classification, first-launch hydration and restricted-content qualification remain pending. |


The [current matrix](../../planning/issue-6-final-traceability.md) links the source anchors and reporter evidence. The [shared release gates](../qualify-issue-6-remediation/verification.md) define how to record results.

## Spec requirements

| IDs | OpenSpec requirement |
| --- | --- |
| Y01 | [Playlist defaults persist and apply to new imports](specs/youtube-ingestion-and-playlist-reliability/spec.md#requirement-playlist-defaults-persist-and-apply-to-new-imports) |
| Y02 | [Custom YouTube cookies.txt file authentication](specs/youtube-ingestion-and-playlist-reliability/spec.md#requirement-custom-youtube-cookiestxt-file-authentication) |
| Y02 | [YouTube runtime health diagnostics](specs/youtube-ingestion-and-playlist-reliability/spec.md#requirement-youtube-runtime-health-diagnostics) |
