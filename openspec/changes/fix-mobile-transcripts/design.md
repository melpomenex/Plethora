## Context

Transcript acquisition today has three implementations and one real path on mobile:

| Client | Path | Reality |
|---|---|---|
| Desktop Tauri | `get_youtube_transcript_by_id` → `yt-dlp` subprocess | Works |
| Native Android/iOS | falls through to hosted API (`youtubeTranscriptBrowser.ts:311`) | Relay-dependent |
| Browser PWA | hosted API | Relay-dependent |

The hosted API (`api/youtube/transcript.py`) tries the VPS relay first and treats it as authoritative, because its own datacenter-IP fallbacks (`fetch_transcript_direct`) reliably fail from Vercel. The VPS (`yjs-sync/service.py`) queues jobs that a home worker on the Mac mini (`yjs-sync/home-worker.py`) polls over Tailscale and fulfils with `yt-dlp` on a residential IP. Cold fetches are budgeted at 45s (`api/youtube/transcript.py:48`).

The relay exists to launder a *datacenter* IP into a residential one. A phone is already on a residential or carrier IP. The native app is therefore paying the relay's entire reliability and latency cost for a constraint it does not have — and inherits a hard dependency on one physical machine in the user's house being awake.

The browser PWA is different in kind: same-origin policy prevents any browser from fetching `youtube.com` caption endpoints, so the PWA structurally needs a server. Both were confirmed in scope; the relay is retained as a fallback rather than removed.

Constraints that shape the design:
- **License**: this repo is Apache-2.0 (`LICENSE`).
- **No subprocess on mobile**: Android and iOS cannot spawn `yt-dlp`; iOS forbids `fork`/`exec` outright.
- **Existing crypto/HTTP stack**: `reqwest` 0.12 with `rustls-tls` plus an explicit `ring` provider is already wired and already cross-compiles for Android (`src-tauri/Cargo.toml:86-97`).
- **Android only, for now**: `src-tauri/gen/android` exists; `gen/ios` does not. The iOS init script exists (`package.json:29`) but has not been run.

## Goals / Non-Goals

**Goals:**
- Native mobile transcripts that work with the Mac mini powered off.
- One transcript-resolution policy shared by every client, instead of three divergent code paths.
- Failures that name their cause: relay down, no captions, and bot-gated must be distinguishable.
- PWA users benefit from native users' fetches via a warm shared cache.
- The relay keeps working, unchanged in behavior, as the fallback.

**Non-Goals:**
- Removing or rewriting the VPS service or home worker. Untouched except for cache validation and liveness reporting.
- Removing `yt-dlp` from desktop. It stays for video download, playlists, formats, and metadata — this change only makes it optional for *transcripts*.
- On-device audio transcription as a transcript fallback. Whisper is already in the tree (`src-tauri/src/transcription/`) but running it on a phone for a 60-minute video is a separate change with its own battery and thermal design.
- Fetching transcripts for non-YouTube sources.
- Generating proof-of-origin tokens on-device.

## Decisions

### D1. Write a minimal Innertube caption client in Rust rather than adopting an existing library

**Chosen**: a new `src-tauri/src/youtube/innertube.rs` (~300–400 lines) that POSTs to `https://www.youtube.com/youtubei/v1/player` with a synthetic client context, reads `captions.playerCaptionsTracklistRenderer.captionTracks`, GETs the selected track's `baseUrl` with `&fmt=json3`, and maps `events[]` to `TranscriptSegment`.

Rationale — every off-the-shelf option fails a hard constraint:

- **rustypipe** (pure Rust, Innertube, exposes `VideoPlayer.subtitles`) is the closest fit technically and is **GPL-3.0**. Statically linking it into an Apache-2.0 distributed binary forces the entire app to GPL-3.0. Rejected on license grounds, not technical ones. If the project ever relicenses, revisit — it would replace most of this module.
- **youtubedl-android** (yausername) bundles yt-dlp plus a Python 3.8 runtime in the APK. Android-only, no iOS path, tens of MB of APK growth, and it reintroduces the subprocess model. Rejected.
- **NewPipeExtractor** is Java, Android-only, and also GPL-3.0. Rejected twice over.
- **Bundling a `yt-dlp` binary** is impossible on iOS and impractical on Android.

The in-house client is small because the hard parts of yt-dlp — signature deciphering, format selection, throttling — are all about *media streams*. Caption tracks need none of it. The VTT/JSON parsing and language-priority logic already exist in `api/youtube/transcript.py` and `yjs-sync/home-worker.py` and are ported, not invented.

### D2. Try multiple Innertube client contexts, ordered, before giving up

YouTube gates different clients differently. The fetcher attempts a short ordered list of client contexts (an embedded/TV-style context first, then a mobile context) and uses the first that returns caption tracks. A single hardcoded context is the most likely thing to break silently when YouTube shifts policy; an ordered list degrades instead.

The specific context list is deliberately not fixed in this design — it is empirical and expected to change. It lives in one constant table with a comment explaining what each entry is for, so updating it is a one-line change rather than an archaeology exercise.

### D3. The source chain lives in TypeScript, not Rust

`src/lib/transcript/sourceChain.ts` owns the ordering, timeouts, terminal-vs-fall-through policy, and attribution. Rust exposes exactly one new command, `fetch_youtube_transcript_on_device`, returning a tagged result.

Alternative considered: putting the chain in Rust. Rejected because the PWA has no Rust, so a Rust-side chain would leave the PWA on a second, divergent policy — which is the bug we are fixing. Putting it in TypeScript means one policy, one set of tests, and the PWA simply sees the on-device source as unavailable.

### D4. Outcomes cross the Tauri boundary as a tagged union, not a string

```
{ "status": "ok", "segments": [...], "language": "en" }
{ "status": "err", "kind": "PoTokenRequired", "detail": "..." }
```

Today's `Result<_, String>` forces the frontend to pattern-match on error prose (`youtubeTranscriptBrowser.ts:350`, matching on `"does not have captions"`). That is how `NoCaptions` currently gets confused with a dead relay. The chain's terminal-vs-fall-through decision depends entirely on getting this right, so it gets a real type.

`PoTokenRequired` is detected two ways: a gating marker on the track URL, or an empty body on a `200` response from the caption endpoint — the documented signature of this failure.

### D5. Reuse the existing `POST /worker/upload` endpoint for cache warming

The VPS already accepts transcript uploads from the home worker and keys them by video ID. App clients become additional upload sources. This adds no new endpoint and no new cache format.

It does widen the trust boundary: previously only the operator's own worker could write to the cache. Mitigated by keeping the existing API-key requirement, adding payload validation, and a no-shrink rule (an upload with fewer segments than the cached entry does not overwrite it). Uploads are fire-and-forget and never block display.

### D6. Relay liveness is tracked as a last-poll timestamp

`service.py` records the timestamp of the most recent `/worker/poll` and exposes it. If no worker has polled within a liveness window, `GET /transcript/<id>` on a cache miss returns a distinct relay-unavailable code immediately instead of queueing a job that nothing will ever pick up and letting the client burn its full 45s timeout.

This is the single highest-value fix for the reported symptom — "transcripts are broken on mobile" today produces a 45-second wait followed by a misleading message.

### D7. Desktop switches to on-device first, with `yt-dlp` retained as its own fallback

Desktop gets the same chain, with the on-device fetcher ahead of the `yt-dlp` path. This means desktop exercises the new code on every fetch, so regressions surface on the platform with the best debugging story rather than first appearing on a phone. `yt-dlp` remains available and is still the only path for the other YouTube features.

## Risks / Trade-offs

- **PO-token gating spreads to most caption tracks** → The relay fallback is retained precisely for this. Track the `PoTokenRequired` rate in diagnostics; if it becomes the common case, on-device fetching stops being the primary path and this change degrades to "the relay got better error reporting", which is still a net win.
- **YouTube changes the Innertube player payload and on-device silently returns nothing** → All shape assumptions are confined to one parser module with fixture-based tests. An unrecognized payload maps to `Unknown`, which is a fall-through outcome, so the relay covers it. The failure mode is slowness, not breakage.
- **In-house client means we own the maintenance** that rustypipe/yt-dlp would have carried → Accepted, and it is the direct cost of the license constraint. Kept tolerable by scoping the client to captions only — no stream URLs, no signature deciphering, no format selection.
- **Cache-warming lets a compromised client poison the shared cache** → API key required, payload validated, no-shrink rule on overwrite. Residual risk: a client with a valid key can still write a wrong-but-well-formed transcript. Acceptable for a single-operator deployment; revisit if the key is ever distributed widely.
- **Fetching Innertube directly may conflict with YouTube's terms of service** → This is not a new posture; the app already ships `yt-dlp` integration and the relay exists to evade IP blocking. The change moves where the request originates, not whether it is made.
- **APK/IPA size and cold-start** → The client adds no new dependency beyond what `reqwest` + `serde_json` already provide. Expected binary growth is negligible.
- **iOS is specified but cannot be verified** → `gen/ios` does not exist. iOS is written to be correct-by-construction (no platform-specific code) but is untestable until `tauri:ios:init` is run. Tasks mark it explicitly as unverified rather than pretending otherwise.

## Migration Plan

1. **Additive first.** Land the Rust fetcher and its command with no caller. No behavior change; verified by unit and fixture tests.
2. **Desktop opt-in.** Route desktop through the chain with the on-device source enabled. Desktop keeps `yt-dlp` as fallback, so worst case is unchanged behavior plus a wasted fast attempt.
3. **Service hardening.** Deploy `service.py` validation and liveness reporting. Independent of the client work and independently valuable — it alone fixes the misleading-error symptom.
4. **Native mobile.** Enable the on-device source on Android. Verify against a matrix: captioned video, auto-captions-only, no captions, age-restricted, PO-gated, offline device.
5. **Cache warming.** Enable uploads from native clients; confirm the PWA starts hitting warm cache and worker queue depth drops.
6. **iOS.** Deferred until an iOS target exists.

**Rollback**: the on-device source has a settings toggle (`transcript-source-chain` spec). Disabling it returns every client to today's relay-only behavior without a release. The relay is never modified in a way that depends on the new client, so steps 1–2 and 4–5 can be reverted independently of step 3.

## Open Questions

- Which Innertube client context list actually returns ungated caption tracks in July 2026? Resolved empirically in the first task, not decided here.
- Should the on-device fetcher send the user's stored YouTube cookies (`src/utils/youtubeCookies.ts`) to improve success on sign-in-gated videos? It would help, but it moves credentials into the native layer and widens the blast radius of a bug. Deferred — start cookie-free, revisit if `SignInRequired` shows up materially in diagnostics.
- Is a per-video negative cache for `NoCaptions` worth it, so that captionless videos do not re-hit the network on every open? Probably yes, but it needs an invalidation story for creators adding captions later.
- Should cache-warming uploads require the transcript service to be the *user's own* self-hosted instance, rather than the shared `readsync.org` relay, when both are configured?
