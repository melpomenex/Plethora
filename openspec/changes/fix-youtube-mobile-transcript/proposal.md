## Why

Mobile YouTube playback and transcript fetching are both broken by regressions introduced alongside the recent on-device InnerTube work (commits `dd317bff` through `eb78cc93`). Opening a YouTube video from the Documents tab or Queue shows a blank screen, and transcript fetches on mobile still fail with "sign in to confirm you're not a bot" — the exact failure mode the on-device InnerTube fetcher (`src-tauri/src/youtube/innertube.rs`) was built to eliminate. Both are narrow, verified bugs in already-shipped code, not missing capabilities: a `useEffect` overwrites a correct platform-aware setting on every document open, and an inverted string check in the caption-gating logic rejects almost every fetchable caption track, forcing every mobile transcript request through the Vercel/yt-dlp fallback that gets bot-blocked on its datacenter IP.

## What Changes

- **Fix the blank mobile video screen**: the reset effect in `src/components/viewer/YouTubeViewer.tsx` (~line 311-316) unconditionally sets `embedHost` to `youtube-nocookie.com` on every `documentId`/`videoId` change, overriding the platform-aware initializer (~line 189-196) that correctly picks `youtube.com` for Tauri/native-mobile/Linux. The reset must reuse the same platform check instead of hardcoding the nocookie host.
- **Fix the InnerTube caption-gating false positive**: `src-tauri/src/youtube/innertube.rs` (~line 258) computes `gating_marker` from `!caption_url.contains("&sig=")`, which is true for nearly all modern (non-legacy-ciphered) caption URLs and misclassifies fetchable tracks as `PoTokenRequired`. Replace with a check that only flags URLs that are actually PO-token-gated (e.g. presence of a signature-cipher marker specific to gated URLs), so normal caption tracks are fetched successfully on-device.
- **Fix the stale on-device result check in the browser fallback path**: `src/utils/youtubeTranscriptBrowser.ts` (~line 570, 577) checks `onDeviceRes.kind === "Ok"` / `"Err"`, but the Rust `OnDeviceTranscriptResult` enum serializes with `#[serde(tag = "status")]` (`ok`/`err`), a mismatch the earlier `5a3ddc6d` fix corrected in `sourceChain.ts` but missed in this file. Correct the field/value check so a genuinely successful on-device fetch is recognized here too.
- Add regression coverage (unit tests where practical) so these three checks can't silently re-invert or re-reset again.

## Capabilities

### New Capabilities
(none — this change fixes defects in existing, already-specified behavior)

### Modified Capabilities
- `youtube-playback`: mobile/Tauri embed host selection must remain stable across document switches instead of reverting to a host that fails to load in native WebViews.

## Impact

- **Frontend**: `src/components/viewer/YouTubeViewer.tsx` (embed host reset effect), `src/utils/youtubeTranscriptBrowser.ts` (on-device result field check).
- **Rust backend**: `src-tauri/src/youtube/innertube.rs` (caption-gating detection logic).
- **No API, schema, or settings changes.** No new dependencies. Existing `on-device-youtube-transcripts` and `transcript-source-chain` capabilities (from `fix-mobile-transcripts`) are unaffected in shape — only a defect in their implementation is corrected.
- **Risk**: the gating-detection fix must not become too permissive in the other direction (accepting a genuinely PO-token-gated URL and returning a garbage/empty transcript body) — the fetch itself will still fail or return empty content in that case, which must be classified correctly rather than silently succeeding with empty segments.
