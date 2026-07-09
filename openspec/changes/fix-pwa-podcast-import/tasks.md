## 1. IndexedDB Schema & Accessors

- [x] 1.1 In `src/lib/database.ts`, bump `DB_VERSION` from 3 to 4.
- [x] 1.2 Add `podcast_feeds` object store (keyPath `id`, index `by_feed_url`) and `podcast_episodes` object store (keyPath `id`, indexes `by_feed_id`, `by_guid`, `by_played`) in `onupgradeneeded` for the new version. Existing stores remain untouched.
- [x] 1.3 Add typed accessors mirroring the `documents` pattern: `subscribePodcastFeed(feed)`, `getPodcastFeeds()`, `getPodcastFeed(id)`, `getPodcastFeedByUrl(url)`, `renamePodcastFeed(id, title)`, `deletePodcastFeed(id)`; `upsertPodcastEpisodes(feedId, episodes[])`, `getPodcastEpisodes({feedId?, includePlayed})`, `getPodcastEpisode(id)`, `markPodcastEpisodePlayed(id, played)`, `updatePodcastEpisodePosition(id, position)`, `getPodcastEpisodePosition(id)`, `deleteEpisodesForFeed(feedId)`.
- [ ] 1.4 Verify the DB upgrade path runs cleanly on an existing database (no data loss in `documents`/`extracts`/etc.) — test in a browser dev session.

## 2. Client-Side RSS Fetch + Parse Helper

- [x] 2.1 In `src/api/rss.ts`, ensure `parseFeed`/`parseRSSItem` (and the enclosure/audio extraction) are exported so the browser backend can reuse them without duplicating XML parsing.
- [x] 2.2 Add (or factor out) a `fetchPodcastFeedXml(feedUrl)` helper implementing the established direct→proxy chain (direct, then `allorigins.win/raw?url=`, then `corsproxy.io/?`, then `codetabs.com/v1/proxy?quest=`), returning the feed XML text. Reuse the same list already used by `fetch_rss_feed_url`/`fetch_url_content` in `src/lib/browser-backend.ts` and `src/utils/documentImport.ts:13-18`.
- [x] 2.3 Add a mapper `parsedFeedToPodcastFeed` / `parsedItemToPodcastEpisode` that converts the `parseFeed` output into the `PodcastFeed`/`PodcastEpisode` wire shapes defined in `src/api/podcast.ts` (title, description, imageUrl, author, language, link, feedUrl, guid, audioUrl, audioType, fileSize, publishedDate, etc.).

## 3. Browser-Backend Command Handlers

- [x] 3.1 Replace the `subscribe_podcast` stub (`src/lib/browser-backend.ts:1033-1052`) with a real handler: fetch → parse → assign stable ids (`feedId` from feedUrl, episode `id` = `${feedId}:${guid || audioUrl}`) → persist feed + episodes to IndexedDB → return the `PodcastFeed` (real parsed title, real `episodeCount`, `unplayedCount`). Remove the `"Browser Podcast"` placeholder and its `console.warn`.
- [x] 3.2 Replace `get_podcast_feeds` stub to return persisted feeds from IndexedDB with live `episodeCount`/`unplayedCount`.
- [x] 3.3 Replace `get_podcast_episodes` stub to return persisted episodes for a feed (or all feeds when `feedId` is null), honoring `includePlayed`.
- [x] 3.4 Replace `refresh_podcast_feed` stub: re-fetch + parse the feed URL, upsert feed metadata, upsert new episodes (dedupe by guid → audioUrl), return the updated `PodcastFeed`.
- [x] 3.5 Replace `unsubscribe_podcast` stub: delete the feed and all its episodes (`deleteEpisodesForFeed`).
- [x] 3.6 Replace `rename_podcast_feed` stub: persist the user-supplied title.
- [x] 3.7 Replace `mark_episode_played` stub: persist played state to IndexedDB.
- [x] 3.8 Replace `update_episode_position` and `get_episode_position` stubs: persist/read playback position.

## 4. API Dispatch Simplification

- [x] 4.1 In `src/api/podcast.ts`, collapse the 3-way dispatch (`isTauri → shouldUseHttp → browserInvoke`) to 2-way (`isTauri() ? invokeCommand : browserInvoke`) for: `subscribeToPodcast`, `getSubscribedPodcasts`, `getPodcastEpisodes`, `getEpisodeQueue`, `refreshFeed`, `unsubscribeFromPodcast`, `renamePodcastFeed`, `markEpisodePlayed`, `updateEpisodePosition`, `getEpisodePosition`, and the download/download-path/delete helpers.
- [x] 4.2 Remove the now-dead `shouldUseHttp()` and `getApiBaseUrl()` podcast branches (the `/api/podcast/*` endpoints do not exist on the server). Leave `searchPodcasts` as-is (direct iTunes fetch already works on web).
- [x] 4.3 Ensure `browserInvoke` is imported/available wherever `invokeCommand` is used in `podcast.ts`.
- [x] 4.4 Verify Tauri/desktop code paths are byte-for-byte unchanged (the `isTauri()` branches keep their existing `invokeCommand` calls and sync-publish side effects).

## 5. Verification & Regression

- [ ] 5.1 Manual: on a deployed-style PWA hostname (or `--host` build, not localhost), subscribe to a known-good CORS-friendly podcast feed → confirm real title, real episode list, persisted across reload.
- [ ] 5.2 Manual: subscribe to a CORS-blocking feed → confirm proxy fallback resolves it (or surfaces a clear error, never the fake "Browser Podcast").
- [ ] 5.3 Manual: refresh a feed → new episodes appear without duplicates; unsubscribe removes feed + episodes.
- [ ] 5.4 Manual: play/pause/navigate-away/reopen an episode in the web app → position saves and restores.
- [ ] 5.5 Regression: run the desktop/Tauri app and confirm subscribe/refresh/position/search behavior is unchanged.
- [x] 5.6 Typecheck/lint the changed files (`src/lib/database.ts`, `src/lib/browser-backend.ts`, `src/api/podcast.ts`, `src/api/rss.ts`) — `pnpm typecheck` (or project equivalent).

> Automated verification done: `tsc --noEmit` passes (0 errors); `eslint` on all changed files shows 0 errors and only pre-existing warnings (none in new code); targeted unit tests pass (`podcastSearch`, `podcastTranscript`, `podcastGroqTranscription` — 22/22). The pre-existing failures in `sync.*`/`ocrCommands`/`notebooklm.integration`/`startSyncSubsystems` fail identically on the base commit (environmental: Argon2/Worker/network), so this change introduces no new test regressions. Tasks 5.1–5.5 require a running PWA + desktop app with real network and are left for manual QA.
