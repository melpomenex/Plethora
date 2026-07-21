## Context

Both bugs were introduced while landing on-device YouTube support across `dd317bff` (initial InnerTube implementation) through `eb78cc93` (16:9 aspect ratio fix). They are regressions in already-shipped code, verified by direct source inspection:

1. `src/components/viewer/YouTubeViewer.tsx` initializes `embedHost` correctly per-platform (line ~189-196: `youtube.com` for Tauri/native-mobile/Linux, `youtube-nocookie.com` otherwise), but a separate `useEffect` keyed on `[documentId, videoId]` (line ~311-316) unconditionally resets it to `getPlatform() === 'linux' ? youtube.com : youtube-nocookie.com` — dropping the Tauri/native-mobile branch entirely. Every document open re-triggers this effect, so mobile/Tauri playback reverts to the host that WebKitGTK/Android WebView/iOS WKWebView block via CORS/postMessage origin mismatch, producing a blank iframe. The existing error-recovery path (flips host back to `youtube.com` on player error codes 101/150) only helps if the WebView actually surfaces those YouTube player error codes — it frequently does not for a blocked cross-origin iframe, so the user just sees blank.
2. `src-tauri/src/youtube/innertube.rs` line ~258 computes `gating_marker = caption_url.contains("signature=") || !caption_url.contains("&sig=")`. The `&sig=` substring is a legacy artifact of old signature-ciphered caption URLs; modern `baseUrl`s from `captionTracks` are typically usable without a `sig` param at all. The `!contains("&sig=")` half of the OR is therefore true for nearly all normal URLs, so almost every request is misclassified as `PoTokenRequired` regardless of whether it's actually gated. Because `PoTokenRequired` is a non-terminal outcome, `sourceChain.ts` correctly falls through to the next source — but the on-device path effectively never succeeds, so every mobile transcript request reaches the Vercel `api/youtube/transcript.py` scraper, which hits YouTube's bot-check from its datacenter IP and returns literally "Sign in to confirm you're not a bot".
3. `src/utils/youtubeTranscriptBrowser.ts` (a separate, older call path invoked directly by some call sites, distinct from `sourceChain.ts`) still checks `onDeviceRes.kind === "Ok"` / `"Err"` (line ~570, 577). The Rust `OnDeviceTranscriptResult` enum is `#[serde(tag = "status")]`, serializing as `{"status": "ok", ...}` / `{"status": "err", ...}`. The `5a3ddc6d` fix corrected this in `sourceChain.ts` but missed this file, so even after bug #2 is fixed, any caller routed through `youtubeTranscriptBrowser.ts` directly will never recognize a successful on-device result and will always continue to the fallback chain.

## Goals / Non-Goals

**Goals:**
- Make the on-device InnerTube caption fetch actually succeed for ordinary (non-gated) videos on mobile, so transcript requests stop reaching the Vercel fallback in the common case.
- Make the mobile/Tauri YouTube embed host selection stable across document switches so playback does not silently regress to a blocked host on every open.
- Ensure both call paths that read the on-device Tauri command result (`sourceChain.ts` and `youtubeTranscriptBrowser.ts`) agree on the actual response shape.

**Non-Goals:**
- Rebuilding the transcript source chain, diagnostics UI, or hosted-relay resilience work described in `fix-mobile-transcripts` — that remains separate, larger, and mostly unimplemented scope.
- Handling videos that are genuinely PO-token-gated, age-restricted, or sign-in-required — those still correctly fall through to the relay/Vercel path; this change only stops *non-gated* videos from being misclassified as gated.
- Any change to the Vercel scraper (`api/youtube/transcript.py`) itself — it remains the last-resort fallback and its behavior is correct given genuinely bot-blocked requests.

## Decisions

- **Reuse the platform check, don't duplicate it.** Extract the platform predicate used in the `embedHost` initializer (`isTauri() || isNativeMobile() || getPlatform() === 'linux'`) into a small local helper (or inline the same expression) and use it identically in both the initializer and the reset effect, so the two can't drift again.
- **Narrow the gating check to a real gating signal rather than an absence-of-legacy-param check.** Determine gating from a positive signal that YouTube actually attaches to PO-token-gated tracks (e.g., a `pot=`/gating query parameter, or an explicit signature-cipher (`s=`) parameter requiring decipherment that this client does not implement) instead of `!contains("&sig=")`. If no reliable positive signal exists, prefer attempting the fetch and classifying based on the actual HTTP response (e.g., 403/empty body on the caption endpoint itself) over guessing from the URL shape alone — this avoids a new false-negative (treating a truly gated URL as fetchable) trading for the current false-positive.
- **Fix the `kind`/`status` mismatch at the read site, not by changing the Rust enum**, since `sourceChain.ts` already correctly reads `status`, and changing the wire format would require touching both call sites plus any cached/serialized assumptions; aligning `youtubeTranscriptBrowser.ts` to the existing serde tag is the minimal, lowest-risk fix.

## Risks / Trade-offs

- [Risk] Narrowing the gating check could flip to a false negative — treating a genuinely gated URL as fetchable, resulting in a fetch that returns an empty or garbage caption body. → Mitigation: after the URL-level gating check, still validate the actual caption response body (empty body / non-JSON / HTTP error) and classify those as `PoTokenRequired`/`Unknown` rather than silently returning an empty transcript.
- [Risk] The `embedHost` reset-effect fix could regress desktop/browser (non-Tauri) playback if the platform predicate is copied incorrectly. → Mitigation: extract the exact same expression (or a shared constant/function) used in the initializer, and manually verify both desktop web and Tauri desktop still render correctly after the change.
- [Risk] Fixing `youtubeTranscriptBrowser.ts` might expose behavior differences from `sourceChain.ts` if the two paths are used by different call sites for different purposes. → Mitigation: since this is a straightforward field-name correction (not a behavior change), the two paths should converge in outcome for the same on-device response; verify by tracing which call sites route through `youtubeTranscriptBrowser.ts` directly versus through `sourceChain.ts`.

## Migration Plan

No data migration. This is a targeted code fix to already-shipped logic. Rollout is a normal app update; no feature flag or staged rollout is needed since the change only corrects clearly-wrong logic (an inverted condition, a stale field name, an effect overriding its own initializer) with no behavior-shape change for the non-buggy paths.

## Findings from live capture (tested 2026-07-21, video `dQw4w9WgXcQ`)

The original open question — "what is the real gating marker on caption `baseUrl`s?" — was answered by capturing live InnerTube responses. **The answer is that there is no URL-shape gating marker at all**, and the capture surfaced three further defects that are each independently fatal to on-device fetching. The full picture is worse than the proposal assumed: the gating check is not the only reason on-device fetching never succeeds.

**1. All three configured client contexts are dead.** Probed against `youtubei/v1/player` with the real public WEB key:

| Context (as configured in `innertube.rs`) | Result |
| --- | --- |
| `WEB_EMBEDDED_PLAYER` | `playabilityStatus=ERROR`, 0 caption tracks |
| `ANDROID` | HTTP 400 `FAILED_PRECONDITION` (now requires attestation) |
| `TVHTML5` | `playabilityStatus=UNPLAYABLE`, 0 caption tracks |
| `WEB`, `MWEB`, `TVHTML5_SIMPLY_EMBEDDED_PLAYER` (also tried) | `UNPLAYABLE`/`ERROR`, 0 tracks |
| **`ANDROID_VR`** | **`playabilityStatus=OK`, 6 caption tracks, captions actually fetch** |

Injecting `visitorData` / `X-Goog-Visitor-Id` did not revive any of the dead contexts. `ANDROID_VR` (the Oculus/Quest YouTube client) is currently exempt from PO-token and attestation requirements and is the only working context found. Because every configured context returns zero caption tracks, the code never even reaches the gating check for most videos — it fails earlier with `NoCaptions`.

**2. The gating check is a guaranteed false positive — both clauses.** On a *verified fetchable* `ANDROID_VR` caption URL:
- `caption_url.contains("signature=")` → **true**. `signature=` is a standard param on every modern `timedtext` URL (paired with `sparams`); it signs the URL, it does not gate it.
- `!caption_url.contains("&sig=")` → **true**. `&sig=` is a legacy artifact that no longer appears at all.

So `gating_marker` is unconditionally true for working URLs via *either* clause. The check cannot be repaired by narrowing it — it must be deleted. There is no positive gating signal in the URL.

**3. Real gating manifests as an empty HTTP 200 body.** The caption URLs obtained from a plain watch-page scrape (no PO token) returned `http=200, bytes=0`. That — not URL shape — is the detectable signal, confirming the "classify from the response, not the URL" decision above.

**4. `fmt` is appended where it must be replaced.** The `ANDROID_VR` `baseUrl` already carries `fmt=srv3`. The current `format!("{}&fmt=json3", caption_url)` produces a URL with two `fmt` params; the first wins, so YouTube returns **XML (srv3)** and any JSON3 parse fails. Replacing the existing param instead yields valid JSON3 (32623 bytes, 104 events) **including per-word `tOffsetMs` timings**, which the karaoke-sync feature depends on.

**5. `FALLBACK_API_KEY` is malformed.** The constant `AIzaSyAO_FJ2y1cc5J-WJ5J1cc5J-WJ5J1cc5J` has an obviously repeating tail and is not a valid key; the real public WEB key is `AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8`. This matters because watch-page key scraping *does* fail in practice — it returned HTTP 429 from this machine's residential IP during testing, which is precisely the mobile failure scenario. When scraping fails, the code falls back to a key that cannot work.

Note also that the 429 observed on the watch-page scrape is itself evidence that the key-scraping step is a fragile dependency; `ANDROID_VR` should be attempted with the known-good static key rather than gated behind a scrape.

**6. `visitorData` is required, not optional (found on-device 2026-07-21).** The fixes above were first validated against a single control video (`dQw4w9WgXcQ`) and reported as working. That was a sampling error: on a real device the very next video failed with `LOGIN_REQUIRED` / "Sign in to confirm you're not a bot". Re-measured across a 6-video sample:

| Request | Videos with usable caption tracks |
| --- | --- |
| `ANDROID_VR` alone | **1 / 6** — `dQw4w9WgXcQ` happened to be the one that worked |
| `ANDROID_VR` + `visitorData` | **5 / 6** |

A visitor token must be attached both as `context.client.visitorData` and as the `X-Goog-Visitor-Id` header. It is obtainable from `POST /youtubei/v1/visitor_id` (returns `responseContext.visitorData`), which — unlike the watch-page scrape used for the API key — is not subject to the HTTP 429 that scraping hits from flagged IPs.

Verified end-to-end through the real Rust path afterwards: Sapolsky 2325 segments, control 60, "me at the zoo" 6, Gangnam Style 67 (ko), Despacito 90.

The lesson worth keeping: a single passing video proves nothing here, because YouTube's gating is per-video. The live test now covers a spread.

## Open Questions

- `ANDROID_VR` + `visitorData` is exempt from PO-token requirements today, but this is exactly the kind of thing YouTube changes. The client-context table should stay ordered and easy to amend, and the fixtures captured here dated, so the next regression is diagnosable rather than mysterious.
- One video in the sample (`hY7m5jjJ9mM`) returned `OK` with zero caption tracks even with a visitor token — most likely genuinely caption-less, but not separately confirmed.
- `fetch_innertube_key` still scrapes the watch page on every request, costing a round trip and up to 5s, and it is the one remaining 429 vector. The static key now works for both the `visitor_id` and `player` endpoints, so this scrape could likely be dropped from the hot path entirely. Not changed here to keep the fix's blast radius small.
- Gated videos still have no working fallback on Android: `get_youtube_transcript_by_id` shells out to `yt-dlp`, which does not exist on the device ("Failed to run yt-dlp: No such file or directory"), and the browser-side path is blocked by CORS against `tauri.localhost`. On-device fetching is therefore the only viable mobile path, not merely the preferred one.
