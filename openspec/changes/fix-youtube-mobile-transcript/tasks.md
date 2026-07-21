## 1. Fix blank YouTube player on mobile/Tauri

- [x] 1.1 In `src/components/viewer/YouTubeViewer.tsx`, extract the platform predicate used by the `embedHost` initializer (~line 189-196) into a single named helper (e.g. `resolveEmbedHost()`) so the host choice exists in exactly one place
- [x] 1.2 Replace the hardcoded reset in the `[documentId, videoId]` effect (~line 315) with a call to that helper, so switching documents no longer reverts Tauri/native-mobile to `youtube-nocookie.com`
- [x] 1.3 Grep `YouTubeViewer.tsx` for any other `setEmbedHost(` call sites and confirm each either uses the helper or is an intentional error-recovery override (the 101/150 player-error fallback)
- [x] 1.4 Add a unit test asserting `resolveEmbedHost()` returns `https://www.youtube.com` for Tauri, native mobile, and Linux, and `https://www.youtube-nocookie.com` otherwise

## 2. Confirm the real caption-gating signal

- [x] 2.1 Capture a real InnerTube `player` response for a known-captioned, ungated video and record the exact `captionTracks[].baseUrl` query parameters
- [x] 2.2 Capture the same for a genuinely PO-token-gated video, and diff the two URL shapes to identify a positive gating marker — **result: no URL-shape marker exists; gating shows up as an empty HTTP 200 body**
- [x] 2.3 Record the finding in `design.md` under Open Questions, replacing the open question with the answer and the date tested
- [x] 2.4 Save both captured responses as test fixtures under `src-tauri/src/youtube/fixtures/`

## 3. Fix the InnerTube fetcher

> Scope expanded after the group-2 capture: the gating check is not the only fatal defect.
> All three configured client contexts return zero caption tracks, `fmt` is appended where it
> must be replaced, and the fallback API key is malformed. See `design.md` → Findings.

- [x] 3.1 Add `ANDROID_VR` as the first entry in `CLIENT_CONTEXTS` (the only context found returning fetchable caption tracks), keeping the existing contexts as ordered fallbacks
- [x] 3.2 Delete the `gating_marker` check entirely — both clauses were verified true on a working, fetchable URL, so it cannot be narrowed, only removed
- [x] 3.3 Replace the existing `fmt` query parameter on the caption `baseUrl` instead of appending a second one (the `ANDROID_VR` URL ships `fmt=srv3`, so appending leaves XML being parsed as JSON3)
- [x] 3.4 Correct `FALLBACK_API_KEY` to the real public WEB key and use it when watch-page key scraping fails (scraping returned 429 during testing — the exact mobile failure case)
- [x] 3.5 Add post-fetch validation: classify an empty body, non-JSON body, or HTTP error from the caption endpoint as a failure outcome (empty 200 → `PoTokenRequired`) rather than returning empty segments as success
- [x] 3.6 Verify a successful fetch still returns `OnDeviceTranscriptResult::Ok` with a populated `segments` list, correct `language`, and preserved per-word `tOffsetMs` timings
- [x] 3.7 Add unit tests against the 2.4 fixtures covering: caption-track selection from the real player response, JSON3 parsing with per-word timings, `fmt` replacement, and empty-body → failure classification
- [x] 3.8 Confirm `cargo check` and `cargo test` succeed for the youtube module
- [x] 3.9 Attach a `visitorData` token (context field + `X-Goog-Visitor-Id` header), sourced from `POST /youtubei/v1/visitor_id` — without it ANDROID_VR is bot-gated on 5 of 6 videos
- [x] 3.10 Widen the live test from a single control video to a 5-video spread, so per-video gating cannot masquerade as success

## 4. Fix the stale on-device result check

- [x] 4.1 In `src/utils/youtubeTranscriptBrowser.ts` (~line 570, 577), change `onDeviceRes.kind === "Ok"` / `"Err"` to read the serde tag field `status` with values `ok` / `err`
- [x] 4.2 Grep the whole frontend for any remaining `.kind === "Ok"` / `.kind === "Err"` reads of an on-device transcript result and correct them
- [x] 4.3 Confirm `src/lib/transcript/sourceChain.ts` still accepts both shapes or is narrowed consistently — do not regress the working `5a3ddc6d` fix
- [x] 4.4 Add a unit test that a mocked `{status: "ok", segments: [...]}` response is recognized as successful by `youtubeTranscriptBrowser.ts` and short-circuits before any network fallback

## 5. Verification

> Automated coverage landed: 12 Rust unit tests (`cargo test --lib youtube::innertube`),
> 9 new frontend tests, 376 existing `src/utils` tests green, no new typecheck errors.
> The live end-to-end Rust test (`cargo test --lib live_on_device_fetch -- --ignored`)
> returned 60 real segments for `dQw4w9WgXcQ` on 2026-07-21.

- [ ] 5.1 Mobile: open a YouTube video from the Documents tab — the player renders, not a blank screen — **NEEDS DEVICE**
- [ ] 5.2 Mobile: open a second YouTube video without restarting the app — the player still renders (guards against the reset-effect regression) — **NEEDS DEVICE**
- [ ] 5.3 Mobile: view a captioned YouTube video in the Queue — the transcript loads and no "sign in to confirm you're not a bot" error appears — **NEEDS DEVICE**
- [ ] 5.4 Mobile: confirm via logs that the transcript was served by the on-device source and never reached the Vercel endpoint — **NEEDS DEVICE**
- [x] 5.5 Desktop Tauri: transcript path verified — the live Rust test exercises the exact desktop backend code path natively on macOS and returned real segments. Playback on desktop Tauri still **NEEDS A LAUNCHED APP** to confirm visually.
- [x] 5.6 Desktop browser/PWA: embed host resolves to `youtube-nocookie.com` (unit test + evaluated live in the running app at `localhost:15173`); no console errors
- [x] 5.7 Verified a nonexistent/unavailable video returns `playabilityStatus=ERROR` → mapped to `VideoUnavailable`, which falls through the context chain gracefully rather than erroring hard
