## ADDED Requirements

### Requirement: Real Podcast Subscription in Browser Mode
The browser (PWA / Web App) backend SHALL implement podcast subscription by fetching the RSS feed at the provided URL, parsing its channel metadata and episode items, and persisting the resulting feed and episodes locally — it SHALL NOT return a synthetic placeholder feed.

#### Scenario: User subscribes to a podcast on the web app
- **WHEN** the user subscribes to a podcast feed URL while running in the PWA / Web App (non-Tauri)
- **THEN** the backend fetches the RSS feed XML from the feed URL
- **AND** parses the feed into a titled feed record with its real episodes
- **AND** persists the feed and its episodes to local browser storage (IndexedDB)
- **AND** returns a `PodcastFeed` whose `title` is the parsed feed title, never a placeholder such as `"Browser Podcast"`
- **AND** the returned `episodeCount` reflects the number of parsed episodes (greater than zero for any valid non-empty feed)

#### Scenario: Subscribe works on any non-localhost host
- **WHEN** the user subscribes to a podcast while running on a deployed PWA hostname (not localhost/127.0.0.1)
- **THEN** the subscription succeeds via the browser backend (not a no-op or HTTP 404 path)

### Requirement: Client-Side RSS Feed Fetching with Proxy Fallback
When fetching podcast feed XML in the browser backend, the system SHALL attempt a direct fetch first and, if blocked by CORS or network failure, retry through a chain of public CORS proxies until one succeeds.

#### Scenario: Feed host blocks cross-origin requests
- **WHEN** a direct browser fetch of the feed URL fails due to CORS or network error
- **THEN** the backend retries the fetch through one or more CORS proxies
- **AND** uses the first successful response to parse the feed
- **AND** only fails the subscription if every fetch attempt fails

### Requirement: Local Persistence of Feeds and Episodes
The browser backend SHALL persist subscribed podcast feeds and their episodes in IndexedDB so that they survive page reloads and app restarts, using dedicated object stores for feeds and episodes.

#### Scenario: User reloads the web app after subscribing
- **WHEN** the user has subscribed to at least one podcast and reloads the PWA / Web App
- **THEN** `get_podcast_feeds` returns the previously subscribed feeds from local storage
- **AND** `get_podcast_episodes` for each feed returns the previously parsed episodes

#### Scenario: Episode audio metadata is captured
- **WHEN** the backend parses a feed `<item>` containing an `<enclosure>` element
- **THEN** the resulting episode record stores the enclosure `url` as the audio URL, plus audio type and file size when present in the enclosure attributes

### Requirement: Feed Refresh Updates Episodes
The browser backend SHALL re-fetch and re-parse a feed on refresh, upserting the feed metadata and adding any episodes not already stored, without duplicating existing episodes.

#### Scenario: User refreshes a feed that has published new episodes
- **WHEN** the user refreshes a previously subscribed feed and the source feed contains episodes not yet stored locally
- **THEN** the backend fetches and parses the current feed XML
- **AND** inserts the new episodes while keeping existing episodes intact
- **AND** returns the updated `PodcastFeed` with the new episode count

### Requirement: Unsubscribe Removes Feed and Its Episodes
The browser backend SHALL remove a feed and all of its child episodes from local storage when the user unsubscribes.

#### Scenario: User unsubscribes from a podcast
- **WHEN** the user unsubscribes from a feed in the PWA / Web App
- **THEN** the feed record is deleted from local storage
- **AND** every episode belonging to that feed is deleted from local storage
- **AND** `get_podcast_feeds` no longer returns the removed feed

### Requirement: Episode Played State in Browser Mode
The browser backend SHALL persist per-episode played/unplayed state in local storage and reflect it in episode listings.

#### Scenario: User marks an episode as played
- **WHEN** the user marks an episode as played in the PWA / Web App
- **THEN** the episode's played flag is persisted in local storage
- **AND** subsequent `get_podcast_episodes` calls reflect the updated played state

### Requirement: Feed Renaming in Browser Mode
The browser backend SHALL persist a user-supplied custom title for a feed, overriding the parsed title, in local storage.

#### Scenario: User renames a podcast feed
- **WHEN** the user renames a feed in the PWA / Web App
- **THEN** the new title is persisted on the feed record
- **AND** `get_podcast_feeds` returns the user-supplied title instead of the parsed title

### Requirement: Stable and Idempotent Identifiers
The browser backend SHALL assign stable identifiers so that subscribing to (or refreshing) the same feed URL is idempotent and episodes are deduplicated by GUID (falling back to audio URL) rather than duplicated on each refresh.

#### Scenario: User subscribes to an already-subscribed feed
- **WHEN** the user subscribes to a feed URL that is already stored locally
- **THEN** the backend does not create a duplicate feed record
- **AND** does not duplicate any already-stored episodes

### Requirement: Dispatch Routes to Browser Backend on All Non-Tauri Hosts
The podcast API layer SHALL route every podcast command to the IndexedDB-backed browser handlers when not running under Tauri, regardless of hostname, and SHALL NOT route to non-existent `/api/podcast/*` HTTP endpoints.

#### Scenario: Deployed PWA performs a podcast operation
- **WHEN** any podcast CRUD, episode, or position operation is invoked on a deployed PWA hostname
- **THEN** the operation is dispatched to the local browser backend rather than an HTTP endpoint that does not exist
