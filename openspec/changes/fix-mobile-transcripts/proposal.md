## Why

YouTube transcripts on mobile currently depend on a fragile relay chain: the native Android/iOS app and the mobile PWA both call `readsync.org/api/youtube/transcript`, which forwards to a VPS, which forwards over Tailscale to a Mac mini running `yt-dlp` on a residential IP. If the Mac mini is asleep, offline, or the Tailscale link drops, transcripts fail everywhere on mobile — and even on the happy path a cold fetch costs 10–30s (`api/youtube/transcript.py:48`). The relay exists only because *datacenter* IPs get bot-blocked by YouTube; a phone on cellular or home Wi-Fi is already a residential IP, so the native app is paying a large reliability and latency tax for a problem it does not have.

## What Changes

- **Add an on-device transcript fetcher in the Rust backend** that works on Android and iOS (and desktop), using a pure-Rust YouTube Innertube client instead of the `yt-dlp` subprocess. Native mobile builds currently skip the Rust path entirely (`src/utils/youtubeTranscriptBrowser.ts:311`) because `yt-dlp` cannot be spawned there; a pure-Rust client has no subprocess, no Python, and no CORS constraint.
- **Make transcript resolution an explicit, ordered source chain** shared by all platforms: local cache → on-device fetch (native only) → hosted API (VPS/Mac-mini relay, kept as fallback) → user-configured self-hosted service. Each source reports a typed outcome so the next source is only tried when it can plausibly help.
- **Harden the hosted path for the mobile PWA**, which structurally cannot fetch YouTube directly (browser CORS). Transcripts fetched on-device by *any* client are uploaded to the shared service cache, so PWA users hit a warm cache instead of waking the Mac mini; relay unavailability surfaces as a distinct, actionable error rather than a generic failure.
- **Add a transcript diagnostics surface** in Integration settings showing which source served the last fetch, whether the on-device fetcher is available on this platform, and relay health — replacing today's silent fall-through where a failure could be bot detection, a sleeping Mac mini, or a missing caption track with no way to tell.
- **Keep the Mac mini + Tailscale + VPS relay in place** as the fallback for videos the on-device path cannot serve (PO-token-gated captions, age-restricted, sign-in-required). No relay code is removed in this change.

## Capabilities

### New Capabilities
- `on-device-youtube-transcripts`: Fetching YouTube caption tracks natively in the Rust backend on Android, iOS, and desktop without a `yt-dlp` subprocess, including language selection, caching, and typed failure classification.
- `transcript-source-chain`: The ordered, platform-aware resolution of a transcript request across cache, on-device, hosted relay, and self-hosted sources, including which failures advance to the next source and which terminate the request.
- `hosted-transcript-resilience`: Behavior of the hosted transcript path for clients that cannot fetch on-device (mobile PWA) — shared cache warming from on-device fetches, relay-health reporting, and distinguishable error codes.

### Modified Capabilities
<!-- No existing spec in openspec/specs/ covers transcript fetching; `youtube-playback` covers playback, not transcript acquisition. -->

## Impact

- **Rust backend** (`src-tauri/`): new transcript module wrapping a pure-Rust Innertube client; `get_youtube_transcript_by_id` / `get_youtube_transcript` gain a non-`yt-dlp` implementation path and stop being desktop-only. New crate dependency; `reqwest` with `rustls-tls` is already present (`src-tauri/Cargo.toml:86`), so no new TLS surface. Android builds via `src-tauri/gen/android`; iOS target is not yet generated (`tauri:ios:init` exists in `package.json:29`).
- **Frontend** (`src/utils/youtubeTranscriptBrowser.ts`): the `isTauri() && !isNativeMobile()` guard is replaced by capability-based source selection; error mapping extended with new typed codes.
- **Hosted service** (`api/youtube/transcript.py`, `yjs-sync/service.py`): a cache-upload endpoint reachable by app clients, and a health/status field distinguishing "relay down" from "no captions".
- **Settings** (`src/components/settings/IntegrationSettings.tsx`, `src/stores/settingsStore.ts`): transcript source diagnostics and an on-device toggle.
- **Docs**: `docs/YOUTUBE_TRANSCRIPTS.md` and `yjs-sync/TRANSCRIPT_SERVICE.md` describe the relay as the only mobile path and must be updated.
- **Risk**: YouTube increasingly gates caption `baseUrl`s behind a proof-of-origin (PO) token; on-device fetching will not cover 100% of videos, which is precisely why the relay is retained rather than removed.
