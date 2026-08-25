## Purpose

Production invariants for resources that previously had no owner: synthesized audio section URLs, the TTS persistent cache's connections and eviction, the global error history, test-only timers, and desktop audio playback's byte path. Every mechanism that can hold unbounded bytes or unbounded counts in a long-running session gets an explicit bound, an eviction or revocation policy, and lifecycle cleanup.

## ADDED Requirements

### Requirement: Synthesized section audio URLs are bounded and revoked

The cache of object URLs for synthesized audio-edition sections SHALL be bounded by both a count cap and a byte cap, evicting least-recently-used entries beyond the caps and revoking the evicted URL. Replacing a section's URL (regeneration, retry) SHALL revoke the previous URL. Edition deletion, job cancellation, library reset, and application teardown SHALL revoke every URL the edition still owns. Playback SHALL hold at most a small working set of section URLs (current plus a small lookahead), prefetched across section boundaries, and SHALL never revoke a URL in active playback; playlist metadata SHALL be derived from section records rather than from live URLs.

#### Scenario: An N-section edition does not pin N blobs

- **WHEN** an edition with many sections is generated and played through
- **THEN** live section URLs at any moment are within the documented working-set bound
- **AND** advancing across section boundaries does not interrupt playback

#### Scenario: Lifecycle exits revoke what they own

- **WHEN** a section is regenerated, a job is cancelled, or an edition is deleted
- **THEN** the URLs those paths previously created are revoked and the owner's live count reflects zero for the deleted entity
- **AND** cache growth beyond either cap evicts and revicts the least-recently-used entries

### Requirement: The TTS persistent cache uses one managed connection

All operations against the TTS IndexedDB cache SHALL share a single managed database connection per application context, created lazily and reused; operations SHALL NOT open a new connection per call. The connection SHALL be closed where the application context provides an observable teardown. The number of open connections SHALL be observable to the diagnostics snapshot.

#### Scenario: Repeated lookups do not accumulate connections

- **WHEN** hundreds of sequential cache operations run
- **THEN** exactly one database open occurs and no connection accumulates per operation
- **AND** the diagnostics snapshot reports the connection count as one

### Requirement: TTS cache eviction never materializes payloads

Enforcing the cache size bound SHALL determine eviction order and delete victims using per-entry metadata (key, size, last-accessed) without reading any cached audio payload into memory. Adding an entry SHALL NOT cause the existing cache contents to be loaded, regardless of how full the cache is. Pre-existing entries without metadata SHALL remain readable and SHALL become evictable once metadata is known.

#### Scenario: A full cache stays bounded without loading it

- **WHEN** the cache is at or above its size bound and new entries are added
- **THEN** eviction selects victims via metadata only and no payload read occurs
- **AND** the cache converges under its configured bound

#### Scenario: Old-schema entries survive migration

- **WHEN** a cache written before metadata existed is opened
- **THEN** its entries remain readable and playable
- **AND** the migration is idempotent across repeated opens

### Requirement: Desktop audio playback does not materialize whole files without a bound

On desktop platforms, audio playback SHALL stream from the native media server by default rather than reading the entire file into the WebView heap. Where a blob fallback is unavoidable, it SHALL apply an explicit documented size cap and refuse (with a user-visible fallback path) to materialize files above the cap. Every source swap SHALL revoke the superseded blob URL.

#### Scenario: A long audiobook streams instead of loading

- **WHEN** a desktop user plays a large local audiobook
- **THEN** playback is served through the media server without a whole-file read into the WebView
- **AND** a file above the fallback cap is never fully materialized in the WebView heap

### Requirement: Global error history is bounded in every build

No build of the application SHALL retain an unbounded per-occurrence history of errors or rejections. Builds that record errors at all SHALL use the bounded, duplicate-aggregated recorder defined by the resource-lifecycle diagnostics capability.

#### Scenario: A hot repeating error cannot grow memory without bound

- **WHEN** an error or rejection fires continuously for hours in any build configuration
- **THEN** the memory attributable to error recording is bounded by the recorder's caps
- **AND** occurrence counts remain observable without retaining per-occurrence records

### Requirement: Test-only timers do not run in ordinary production

Timers and instrumentation that exist to serve the reliability harness or test automation SHALL be installed only when the corresponding harness/diagnostics gate is active. No interval installed by test instrumentation SHALL run for the application's lifetime in an ordinary production session.

#### Scenario: The heartbeat exists only for its harness

- **WHEN** the application runs without the harness/diagnostics gate
- **THEN** no heartbeat interval is installed
- **AND** the harness configuration still observes its liveness attribute when the gate is on
