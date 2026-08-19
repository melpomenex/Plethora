## ADDED Requirements

### Requirement: Durable, correctly-keyed TTS caching prevents duplicate paid synthesis

The system SHALL persist each successfully generated cloud/paid TTS segment durably in a bounded local cache keyed by every synthesis-affecting parameter, and reuse it whenever those parameters and the underlying text are unchanged. A cache hit MUST NOT trigger a provider request; reopening a document, replaying an earlier portion, or restarting the app MUST reuse cached audio. The cache identity MUST change exactly when synthesis-affecting configuration changes (provider/model/voice/speed/format/language/instructions/preset/pronunciation dictionary/cloned-voice identity/baseUrl) and MUST NOT change for non-affecting configuration (request mode, proxy URL, favorites, recents).

#### Scenario: Cache replay survives reopen and restart

- **WHEN** a user synthesizes segment A with a paid provider, closes the document, reopens it, and requests the same segment at the same parameters
- **THEN** the audio is replayed from the persistent cache, the provider adapter invocation count stays 1, and the player can display the segment duration without re-synthesis

#### Scenario: Same text but different voice regenerates

- **WHEN** the same chunk text is requested with a different `voiceId` for the same provider/model
- **THEN** the system synthesizes again under a distinct cache key and caches the new clip independently

#### Scenario: Same text but different model regenerates

- **WHEN** the same chunk text is requested with a different `modelId` for the same provider
- **THEN** the system synthesizes again under a distinct cache key

#### Scenario: Same text but different synthesis-affecting settings regenerates

- **WHEN** the same chunk text is requested with a different non-empty `instructions`, `preset/prompt/temperature`, `language`, `pronunciationDictionary` entry, or `speakerEmbeddingUrl`/`cloneModelId`
- **THEN** the system synthesizes again under a distinct key; changing `requestMode`/`proxyUrl` alone does NOT regenerate

#### Scenario: In-memory buffer eviction does not clear persistent cache

- **WHEN** in-memory playback eviction (`EVICT_BEHIND_COUNT`) removes a chunk from the transient buffer after playback advanced several segments
- **THEN** the persistent IndexedDB entry for that chunk remains present and retrievable until LRU eviction of the persistent store

### Requirement: Cache persistence is durable, not best-effort, for paid providers

For paid/cloud providers, generation MUST NOT be considered complete until the resulting audio (and any measured word timings) has been durably committed to the persistent store. The admissible commit sequence is: `check persistent cache → miss → synthesize → persist durably → expose/play`. Immediate playback MAY overlap the pending commit, but the entry MUST NOT be reported as cached and MUST be re-requested on next miss if the commit did not succeed. Unpaid/local providers (`system`, `android`, `pocket`) MAY remain best-effort. Failures to write the cache MUST NOT block playback but MUST leave the segment uncached so the next request re-generates.

#### Scenario: App close between synthesis success and cache commit does not lose the invariant

- **WHEN** synthesis succeeds, playback begins, and the app is closed before the IndexedDB commit settles
- **THEN** on next open the same segment is treated as a cache miss and synthesized again (exactly once), and after that commit it becomes a cache hit

#### Scenario: Cache write failure does not report a cached hit

- **WHEN** `setCachedAudio` fails due to `QuotaExceededError` or `DataError` after at most one eviction-and-retry
- **THEN** playback continues without caching, no `fromCache:true` is reported, and the next request for the same key re-synthesizes without stale data

### Requirement: Concurrent duplicate synthesis is deduplicated per cache key

When two or more callers request synthesis for the same cache key concurrently (prefetch race, remount, reader with two panes, rapid seek), the system SHALL execute at most one `adapter.synthesize` invocation for that key and share its promise/result with all callers, including sharing the single resultant cache write.

#### Scenario: Simultaneous identical requests produce one provider call

- **WHEN** two simultaneous requests for the exact same cache key (same `provider/model/voice/speed/format/language/instructions/preset/pronunciationDictionary/cloned-voice/baseUrl/text`) occur and neither is in cache
- **THEN** exactly one underlying provider call occurs and both callers resolve to the same audio result and the same cached entry

### Requirement: Cache is bounded with explicit LRU eviction and corruption handling

The cache MUST remain bounded by the configured maximum (default 500 MB). Eviction MUST be at least LRU by `lastAccessed`. Corrupt entries (invalid `ArrayBuffer`, `DataError`) MUST be deleted and treated as a miss; corrupt metadata MUST NOT crash the store. Cache size and count MUST remain accurate after overwrites (overwrite size delta accounted once). `getCacheSize`/`totalSize`/`entryCount` and `clearAudioCache`/`updateMaxCacheSize` utilities stay authoritative; in-memory buffer eviction MUST NOT affect them.

#### Scenario: Eviction under pressure

- **WHEN** the total cached size would exceed `maxSize` after a durable write
- **THEN** the least-recently-used entries are evicted until `totalSize ≤ maxSize`, serialized without transaction conflicts, and the size invariant holds

#### Scenario: Corrupt entry does not poison future reads

- **WHEN** a cached entry is corrupt on read
- **THEN** the entry is deleted, the read returns `null`, and the caller synthesizes anew

### Requirement: Cache management and cache-hit visibility

Under **Settings → Text to Speech**, the system SHALL expose **Downloaded speech** with at least: cached size, maximum, segment count, explanatory copy ("Cached speech lets Plethora replay previously generated audio without sending the same text to your TTS provider again."), a size selector (250 MB / 500 MB / 1 GB / 2 GB / Unlimited/device-managed), and a **Clear cached speech** control with confirmation. For development/diagnostics the system SHALL record per played segment whether it came from memory, persistent cache, fresh synthesis, or system/native synthesis plus the canonical cache key identity, at a debug log level that is off in normal production.

#### Scenario: User manages cache

- **WHEN** the user opens the TTS settings and inspects Downloaded speech
- **THEN** the displayed size/max/count reflects `getCacheSize()`, changing the max triggers eviction when needed, and clearing removes all entries atomically after confirmation

### Requirement: Cache key migration preserves valid legacy entries

If the cache key format changes between versions, existing valid entries MUST remain usable via at least a legacy-key alias lookup on read, and newly written entries MUST use the new format. The system MUST NOT bulk-invalidate hundreds of megabytes of previously cached audio on upgrade unless technically required; migration bumps `DB_VERSION` with a handler that leaves legacy rows in place and lazily re-keys on first alias hit.

#### Scenario: Upgrade does not wipe historically correct clips

- **WHEN** a user upgrades from a build whose `makeCacheKey` omitted `instructions` to a build that includes it
- **THEN** segments whose new key includes empty/missing instructions still hit their legacy entries, while segments whose instructions are non-empty correctly miss and are written under the new key
