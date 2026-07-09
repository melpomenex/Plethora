## Why

On the PWA / Web App, subscribing to a podcast silently fails: every call into `src/api/podcast.ts` falls through both the Tauri path and the HTTP path (because `shouldUseHttp()` is true only on localhost, and even then the server has no `/api/podcast/*` routes) and lands in the `subscribe_podcast` stub in `src/lib/browser-backend.ts`, which returns a fake feed literally titled **"Browser Podcast"** with zero episodes and persists nothing. The user sees a broken entry, no episodes, no playback, and no persistence — while podcast *search* works fine (it hits the iTunes API directly), which makes the failure feel arbitrary. This fixes podcast parity on web/PWA the same way documents already work (real IndexedDB-backed handlers in the browser backend).

## What Changes

- **Replace the podcast browser-backend stubs with real IndexedDB-backed handlers.** `subscribe_podcast`, `get_podcast_feeds`, `get_podcast_episodes`, `refresh_podcast_feed`, `unsubscribe_podcast`, `mark_episode_played`, `update_episode_position`, `get_episode_position`, `rename_podcast_feed` will read/write IndexedDB instead of returning empty defaults.
- **Add two IndexedDB object stores** (`podcast_feeds`, `podcast_episodes`) to `src/lib/database.ts`, bumping `DB_VERSION`, plus typed accessors mirroring the existing `documents` pattern.
- **Fetch + parse the RSS feed client-side on subscribe/refresh**, reusing the existing `DOMParser`-based `parseFeed`/`parseRSSItem` logic from `src/api/rss.ts` (enclosure parsing already extracts podcast audio). Use the established CORS-proxy fallback chain (direct → allorigins → corsproxy → codetabs) that RSS fetching already uses.
- **Fix the 3-way dispatch in `src/api/podcast.ts`** so the browser path routes to the real IndexedDB-backed `browserInvoke` handlers on **any** non-Tauri host (not just localhost), and remove the dead/never-implemented `shouldUseHttp()` `/api/podcast/*` branch that 404s.
- **Stop emitting the misleading `"Browser Podcast"` placeholder** and the no-op `console.warn` stubs for the now-implemented commands.

Out of scope (explicitly): server-side `/api/podcast/*` routes (the REST sync server is deprecated and carries no podcast tables), podcast *transcription* on web (still desktop-only), and cross-device podcast sync originating from a browser (the Tauri-only `ensurePodcastSyncReady` guard is unchanged).

## Capabilities

### New Capabilities
- `podcast-browser-backend`: Client-side persistence and RSS fetch/parse for podcast subscriptions, feeds, and episodes in the PWA / web browser backend (IndexedDB-backed), mirroring how documents already work in browser mode.

### Modified Capabilities
- `podcast-position-persistence`: Playback position save/restore (pause, navigate-away, reopen) now works in the web/PWA backend, not only under Tauri.

## Impact

- **Frontend API**: `src/api/podcast.ts` — dispatch simplified to Tauri-vs-browser across ~15 functions; dead `shouldUseHttp()`/`getApiBaseUrl()` podcast branches removed.
- **Browser backend**: `src/lib/browser-backend.ts:1033-1096` — stub handlers replaced with real IndexedDB-backed implementations; new RSS-fetch+parse helper (reusing the CORS-proxy pattern already at lines 2107-2112 / 2644-2686).
- **Database**: `src/lib/database.ts` — `DB_VERSION` bump (3 → 4), two new stores (`podcast_feeds`, `podcast_episodes`) with indexes, typed accessors.
- **RSS parsing**: `src/api/rss.ts` `parseFeed`/`parseRSSItem` shared/re-exported for podcast use (no new XML dependency; `DOMParser` already used).
- **Sync layer**: `src/lib/sync/entities/podcasts.ts` — unchanged (Tauri-only guard stays); browser-originated cross-device sync remains a non-goal.
- **No server changes**, no new npm dependencies, no new external services (CORS proxies already in use for RSS).
- **No breaking changes** to Tauri/desktop behavior — all changes are behind `!isTauri()`.
