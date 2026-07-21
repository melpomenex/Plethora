## 1. Spike: establish a working Innertube caption request

- [ ] 1.1 Write a throwaway script (or `cargo` example) that POSTs to `https://www.youtube.com/youtubei/v1/player` and dumps `captions.playerCaptionsTracklistRenderer.captionTracks` for a known-captioned video
- [ ] 1.2 Determine which Innertube client contexts return caption tracks whose `baseUrl` is fetchable without a PO token; record the working ordered list and the date tested
- [ ] 1.3 Confirm the `&fmt=json3` caption response shape and capture one real response per case: manual captions, auto-captions, multi-language, and a PO-gated video
- [ ] 1.4 Save the captured responses as test fixtures under `src-tauri/src/youtube/fixtures/`
- [ ] 1.5 Record findings in `design.md` under Open Questions (replace the "which client context" question with the answer)

## 2. Rust: on-device transcript fetcher

- [ ] 2.1 Create `src-tauri/src/youtube/innertube.rs` with the client-context table from 1.2 and a `fetch_player_response(video_id)` returning parsed JSON
- [ ] 2.2 Implement `select_caption_track(tracks, requested_lang)` with the priority order from the `on-device-youtube-transcripts` spec: exact match → primary-subtag prefix match → manual over auto-generated → first available
- [ ] 2.3 Implement `parse_json3_captions(body) -> Vec<TranscriptSegment>` with HTML entity decoding, inline tag stripping, and consecutive duplicate-text collapsing
- [ ] 2.4 Define `TranscriptFetchOutcome` as a serde-tagged enum with variants `NoCaptions`, `PoTokenRequired`, `AgeRestricted`, `SignInRequired`, `VideoUnavailable`, `RateLimited`, `Network`, `Unknown`
- [ ] 2.5 Implement PO-token detection: gating marker on the track URL, or empty body on an HTTP 200 from the caption endpoint
- [ ] 2.6 Wire client-context fallback — try each context in order, advancing only on outcomes that a different context could plausibly fix
- [ ] 2.7 Unit-test 2.2, 2.3, 2.4, and 2.5 against the 1.4 fixtures, including the malformed/unknown-payload case mapping to `Unknown`

## 3. Rust: Tauri commands and caching

- [ ] 3.1 Add `fetch_youtube_transcript_on_device(video_id, language) -> TranscriptFetchResult` command returning the tagged union from 2.4
- [ ] 3.2 Add `on_device_transcript_available() -> { available: bool, platform: String }` command
- [ ] 3.3 Write successful on-device results to the existing transcript store via `repo.upsert_youtube_transcript`, matching `get_youtube_transcript_internal` (`src-tauri/src/youtube.rs:1162`)
- [ ] 3.4 Verify no cache entry is written for any failure outcome other than `NoCaptions`
- [ ] 3.5 Register both commands in `src-tauri/src/lib.rs` with no `target_os` gating, so Android and iOS builds include them
- [ ] 3.6 Confirm `cargo check --target aarch64-linux-android` succeeds

## 4. Frontend: unified source chain

- [ ] 4.1 Create `src/lib/transcript/sourceChain.ts` with source identifiers `cache`, `on-device`, `self-hosted`, `relay` and the resolution order from the `transcript-source-chain` spec
- [ ] 4.2 Implement terminal-vs-fall-through classification: `NoCaptions` and `VideoUnavailable` terminal, all others advance
- [ ] 4.3 Implement per-source timeouts — short for on-device, at least the relay's cold-fetch budget for the relay path
- [ ] 4.4 Attach source attribution and elapsed time to every resolved result
- [ ] 4.5 Add the `transcriptOnDeviceEnabled` setting to `src/stores/settingsStore.ts`, defaulting to enabled, and have the chain skip the on-device source when it is off
- [ ] 4.6 On exhaustion, throw an error enumerating every source attempted with its outcome
- [ ] 4.7 Rewrite `fetchYouTubeTranscript` in `src/utils/youtubeTranscriptBrowser.ts` to delegate to the chain, removing the `isTauri() && !isNativeMobile()` branch (`youtubeTranscriptBrowser.ts:311`) and the error-prose matching (`:350`)
- [ ] 4.8 Unit-test the chain per platform: native mobile, desktop, and PWA, covering cache hit, on-device success, terminal outcome, fall-through to relay, and full exhaustion

## 5. Transcript service: validation, liveness, cache warming

- [ ] 5.1 Add payload validation to `POST /worker/upload` in `yjs-sync/service.py` — reject malformed video IDs, empty segment lists, and segments missing `text`/`start`/`duration`
- [ ] 5.2 Add the no-shrink rule: an upload with fewer segments than the cached entry does not overwrite it
- [ ] 5.3 Record the last `/worker/poll` timestamp and expose worker liveness in `GET /health` and `GET /cache/stats`
- [ ] 5.4 On a cache miss with no live worker, return a distinct relay-unavailable code instead of queueing an unservable job
- [ ] 5.5 Propagate the relay-unavailable code through `api/youtube/transcript.py` so it reaches clients unmapped (it currently falls into the generic 502 branch at `transcript.py:461`)
- [ ] 5.6 Add a client-side fire-and-forget upload after a successful on-device fetch, gated on a configured service URL and API key, that never blocks or fails the user-visible result

## 6. Settings: transcript diagnostics

- [ ] 6.1 Add a transcript diagnostics panel to `src/components/settings/IntegrationSettings.tsx` showing on-device availability, the on-device enable toggle, and the platform identifier
- [ ] 6.2 Show the source, outcome, and duration of the most recent transcript resolution, including per-source attempts on failure
- [ ] 6.3 Add a "test connection" action reporting service reachability, API-key acceptance, and worker liveness
- [ ] 6.4 State explicitly in the browser PWA that on-device fetching is unavailable and requests are served by the service
- [ ] 6.5 Add i18n strings to `src/lib/i18n/locales/en.ts` and `zh.ts`

## 7. Error surfacing

- [ ] 7.1 Map relay-unavailable to a user-facing "transcript service temporarily unavailable, retry" message, distinct from the no-captions message
- [ ] 7.2 Verify the no-captions message is only shown for a genuine `NoCaptions` outcome, never for a dead relay or a network failure
- [ ] 7.3 Check every existing transcript call site for assumptions about the old error strings

## 8. Verification

- [ ] 8.1 Desktop: transcripts resolve on-device with `yt-dlp` uninstalled or renamed
- [ ] 8.2 Desktop: `PoTokenRequired` on a gated video falls through and the relay serves it
- [ ] 8.3 Android: transcripts resolve with the Mac mini powered off — the primary acceptance criterion for this change
- [ ] 8.4 Android matrix: manual captions, auto-captions-only, no captions, age-restricted, PO-gated, airplane mode
- [ ] 8.5 PWA: a video fetched on-device by a native client is served from warm cache without queueing a worker job
- [ ] 8.6 PWA: with the home worker stopped, an uncached video produces the relay-unavailable message within seconds rather than after the 45s timeout
- [ ] 8.7 Confirm the on-device toggle rolls every platform back to relay-only behavior
- [ ] 8.8 iOS: mark as unverified — `src-tauri/gen/ios` does not exist and `tauri:ios:init` has not been run

## 9. Documentation

- [ ] 9.1 Rewrite the environment/method table in `docs/YOUTUBE_TRANSCRIPTS.md` — it currently states yt-dlp is desktop-only and the hosted API is the sole mobile path
- [ ] 9.2 Update `yjs-sync/TRANSCRIPT_SERVICE.md` to describe the relay as a fallback and document worker-liveness reporting plus client cache-warming uploads
- [ ] 9.3 Document the Innertube client-context table's maintenance burden and how to update it when YouTube changes behavior
- [ ] 9.4 Record in `design.md` that rustypipe was rejected on GPL-3.0 vs Apache-2.0 license grounds, so the decision is not silently revisited
