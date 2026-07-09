## Context

Podcast subscriptions work on the Tauri desktop/mobile app (`subscribe_podcast` in `src-tauri/src/commands/podcast.rs` fetches the RSS feed, parses it, and inserts feed + episodes into SQLite). On the PWA / Web App every podcast API call in `src/api/podcast.ts` fails silently:

1. `isTauri()` is false in a browser → skip the IPC path.
2. `shouldUseHttp()` (`src/api/podcast.ts:144-148`) returns true **only** for `localhost`/`127.0.0.1`, so on any deployed PWA the intended HTTP backend is skipped. Even on localhost it 404s — the Express sync server (`server/src/index.ts`) registers no `/api/podcast/*` routes and has no podcast tables (`server/src/db/schema.ts`); its REST sync is deprecated (`Sunset: 2026-12-31`).
3. The call falls through to `invokeCommand(...)` → (not Tauri) → `browserInvoke` → the stubs in `src/lib/browser-backend.ts:1033-1096`, the worst of which returns a fake feed titled literally `"Browser Podcast"` with `episodeCount: 0` and persists nothing.

Meanwhile **podcast search works fine on web** (`searchPodcasts` hits the iTunes Search API directly), and **documents work fine on web** (real IndexedDB-backed handlers in `browser-backend.ts` via the `db` wrapper in `src/lib/database.ts`). RSS feed subscriptions also already work on web — `fetch_rss_feed_url` (`browser-backend.ts:2644-2686`) fetches the feed (direct then CORS proxies) and parses it with the `DOMParser`-based `parseFeed`/`parseRSSItem` in `src/api/rss.ts`, whose enclosure parsing already extracts podcast audio URLs. So every building block needed to make podcasts work on web already exists; the podcast command handlers were simply never wired to them.

## Goals / Non-Goals

**Goals:**
- Subscribing to a podcast on PWA/Web fetches the real feed, parses episodes, persists them, and shows them — same as desktop.
- Feeds, episodes, played state, and playback position survive reloads in the browser (IndexedDB).
- Dispatch reaches the real browser backend on **any** non-Tauri host, not only localhost.
- Desktop/Tauri behavior is untouched.

**Non-Goals:**
- Server-side `/api/podcast/*` routes or podcast tables (REST sync is deprecated; no structured podcast storage exists server-side and we won't add one).
- Podcast transcription on web (remains desktop-only — depends on FFmpeg/sidecar and Groq chunking via Rust commands).
- Cross-device podcast sync **originating from** a browser. `ensurePodcastSyncReady()` in `src/lib/sync/entities/podcasts.ts` stays Tauri-only; a browser device receives/sends nothing over the CRDT relay. (A browser device still gets full local functionality.)
- Downloading episode audio for offline playback in the browser (store metadata only; streaming plays from the remote audio URL).

## Decisions

### Decision 1: IndexedDB-backed browser backend (mirror documents), not server routes
**Choice:** Implement real handlers in `src/lib/browser-backend.ts` backed by IndexedDB via the existing `db` wrapper in `src/lib/database.ts`, exactly as `create_document`/`get_documents` already do.

**Alternatives considered:**
- **Server REST routes `/api/podcast/*`** (what the dead `shouldUseHttp()` branch assumed): Rejected — the REST sync server is deprecated (carries a `Sunset` header), has no podcast tables, and adding them + routes + auth is far larger than the problem needs. The frontend already calls these endpoints and they 404.
- **Pure CRDT (Yjs) storage with no local IndexedDB**: Rejected — the podcast sync entities are Tauri-only by guard (`podcasts.ts:220`), and enabling browser-origin CRDT sync is a separate, larger change with merge/replication semantics to verify. Local-first IndexedDB gives users working podcasts on web now, without coupling to sync.

**Rationale:** Documents already prove this pattern end-to-end on web. It requires no server changes, no new deps, and no sync changes.

### Decision 2: Client-side RSS fetch + parse on subscribe/refresh
**Choice:** On `subscribe_podcast`/`refresh_podcast_feed`, the browser handler fetches the feed XML and parses it with the existing `parseFeed`/`parseRSSItem` from `src/api/rss.ts` (re-exported / imported into the browser backend), reusing its enclosure parsing for podcast audio. Fetch uses the **already-established CORS-proxy fallback chain** (direct → `allorigins.win/raw` → `corsproxy.io` → `codetabs.com`) that `fetch_rss_feed_url` and `fetch_url_content` already use.

**Alternatives considered:**
- **Add an XML npm dep (`fast-xml-parser`/`rss-parser`)**: Rejected — `DOMParser` is built into browsers and already used across `rss.ts`, `arxiv.ts`, and OPML parsing. No new dependency warranted.
- **Route feed fetching through the server**: Rejected — same reasons as Decision 1.

### Decision 3: Collapse the dispatch from 3-way to 2-way (Tauri vs browser)
**Choice:** For the podcast CRUD/episode/position functions, replace the `isTauri → shouldUseHttp → browserInvoke` ladder with `isTauri() ? invokeCommand(...) : browserInvoke(...)`. Remove the dead `shouldUseHttp()`/`getApiBaseUrl()` branches for podcast CRUD (they target routes that do not exist). `searchPodcasts` keeps working as it does today (direct iTunes fetch; it already succeeds on web).

**Rationale:** The HTTP branch is dead code (404) and the `localhost`-only gate is the precise reason deployed PWAs hit the stub. Removing it makes every non-Tauri host reach the real backend.

### Decision 4: Two new IndexedDB stores, `DB_VERSION` 3 → 4
**Choice:** Add `podcast_feeds` (keyPath `id`; index `by_feed_url`) and `podcast_episodes` (keyPath `id`; indexes `by_feed_id`, `by_guid`, `by_played`) in `database.ts`'s `onupgradeneeded`, bumping `DB_VERSION`. Typed accessors (`subscribePodcastFeed`, `getPodcastFeeds`, `getPodcastEpisodes`, `upsertEpisode`, …) mirror the existing `documents` accessors.

**Alternatives considered:**
- **One combined store**: Rejected — feeds vs. episodes have different query patterns (list-all-feeds vs. episodes-by-feed) and different lifecycles (unsubscribe deletes a feed's episodes).

### Decision 5: ID generation + refresh dedupe
**Choice:** Feed `id` = stable hash/slug of `feedUrl` (so re-subscribe/refresh is idempotent); episode `id` = `${feedId}:${guid}` (or `${feedId}:${audioUrl}` when guid is missing, matching how the Rust parser falls back). On refresh, upsert by `id` and dedupe episodes by guid (then audioUrl).

## Risks / Trade-offs

- **[CORS on feed fetch]** Many podcast RSS hosts don't send CORS headers. → *Mitigation:* reuse the proven direct→proxy chain. This already works for RSS subscriptions on web; podcasts use the same XML.
- **[Audio playback CORS]** The `<audio>` element playing a remote CDN URL may hit CORS/media-CSP limits for some hosts, independent of import. → *Mitigation:* out of scope for this change (import/listing/persistence is the reported bug); note as a known playback limitation, not a regression (today playback is impossible because there are zero episodes).
- **[Large feeds]** Some feeds have thousands of items. → *Mitigation:* store all parsed episodes (metadata is tiny — no audio bytes are stored); if quota ever becomes an issue, cap to the latest N per feed in a follow-up. Mirrors desktop which stores all.
- **[Quota exhaustion]** IndexedDB is bounded. → *Mitigation:* we store only metadata/text, never audio blobs. Documents already store far more per-row data in the same DB.
- **[Proxy reliability]** Public CORS proxies can rate-limit or go down. → *Mitigation:* three fallbacks in chain, same as RSS today; direct fetch succeeds for CORS-enabled hosts.
- **[No cross-device sync from browser]** A browser-only user's subscriptions live only in that browser. → *Accepted trade-off:* matches the stated non-goal; desktop-to-desktop sync is unaffected.

## Migration Plan

- Bump `DB_VERSION` 3 → 4 in `src/lib/database.ts`; in `onupgradeneeded` for the new version, `createObjectStore` for `podcast_feeds` and `podcast_episodes` with their indexes. Existing stores are untouched.
- No data migration: the browser backend previously persisted no podcast data, so there is nothing to carry over. Users who saw the fake "Browser Podcast" entry simply won't see it anymore (it was never persisted).
- **Rollback:** revert the DB version bump and handler changes; the new stores become orphaned/empty and are harmless (or can be dropped in a later migration). Desktop is never affected.
- No server deploy, no feature flag required. The change is gated entirely by `!isTauri()`.

## Open Questions

- Should episode listing on web be capped (e.g. latest 200 per feed) for very large feeds, or always store everything to match desktop exactly? (Leaning: match desktop = store everything, revisit if quota issues appear.)
- Do we want a future follow-up to enable browser-origin podcast sync over the CRDT relay (lifting the `podcasts.ts:220` Tauri-only guard)? Tracked separately; not blocking this fix.
