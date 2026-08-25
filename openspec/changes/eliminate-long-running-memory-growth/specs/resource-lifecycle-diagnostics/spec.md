## Purpose

Defines the development/test-only surface that reports what the application itself believes is still alive: an owned object-URL registry with per-owner counts and byte estimates, bounded error aggregates, and resource counts for caches, jobs, and in-flight work. The surface is how leak assertions become testable invariants and how a failed soak attributes growth to an owner — while remaining absent from production behavior, cheap, and free of user content.

## ADDED Requirements

### Requirement: Object URL creation is registry-tracked with ownership

The application SHALL provide an owned object-URL primitive that creates an object URL and records only metadata — URL, owner category, owner identifier, byte size, creation timestamp — and a matching revoke that removes the record. The registry SHALL be able to report live URL counts and estimated live byte totals, grouped by owner category. The registry SHALL NOT retain the Blob or ArrayBuffer itself; the URL's browser-side lifetime is the only payload reference. A resource owner that is fully disposed SHALL be able to revoke all URLs it still owns in one operation.

#### Scenario: Create and revoke keep the accounting exact

- **WHEN** an owner creates URLs and later revokes them individually or via revoke-all
- **THEN** live counts and byte totals for that owner reflect exactly the URLs not yet revoked
- **AND** the global totals include the owner's entries while they live

#### Scenario: The registry never retains payloads

- **WHEN** an owned URL is created and the original Blob reference is dropped by the caller
- **THEN** the registry holds no reference that would keep the Blob's contents alive beyond the URL itself
- **AND** a diagnostic listing shows only metadata fields

#### Scenario: Teardown reaches zero

- **WHEN** a resource owner is disposed in a test
- **THEN** an assertion that the owner's live owned-URL count is zero passes
- **AND** the same assertion fails if the owner leaks any URL it created

### Requirement: Error recording is bounded and duplicate-aggregated

The application's global error and unhandled-rejection recording SHALL aggregate by error signature — storing at most one record per distinct signature with a type, truncated message, optional single sample stack, occurrence count, first-seen, and last-seen — under an explicit cap on distinct signatures. A repeating exception SHALL consume constant additional memory regardless of occurrence count. The recorder SHALL be disabled in production builds unless explicitly enabled through a diagnostics switch.

#### Scenario: Thousands of identical errors remain bounded

- **WHEN** the same error fires ten thousand times
- **THEN** exactly one aggregate record exists for it with an occurrence count of ten thousand
- **AND** the retained bytes are independent of the occurrence count

#### Scenario: Signature diversity is capped

- **WHEN** more distinct signatures arrive than the cap allows
- **THEN** the lowest-count oldest signatures are dropped from the record
- **AND** newly arriving distinct signatures are still recorded up to the cap

#### Scenario: Production builds do not record by default

- **WHEN** the application runs under a production configuration without the diagnostics switch
- **THEN** no error history is retained in memory
- **AND** enabling the switch restores aggregate recording without a rebuild

### Requirement: A composed diagnostic snapshot reports resource lifetimes

Behind the diagnostics switch, the application SHALL expose a single structured, JSON-serializable snapshot combining: owned object-URL totals by owner, error aggregates, the synthesized-section audio cache's entry count and byte estimate, TTS in-flight generation count, audio-edition job count, TTS persistent-cache entry count and total size, and the TTS IndexedDB connection count. The snapshot SHALL contain counts and byte estimates only — no document text, audio payloads, URLs to user content, or stack traces beyond the bounded error samples.

#### Scenario: The snapshot is content-free and cheap

- **WHEN** the snapshot is requested with substantial activity having occurred
- **THEN** it serializes without any user content or payload bytes
- **AND** producing it does not load cached audio or iterate document content

#### Scenario: The scenario harness can read it

- **WHEN** the memory-scenario host is active
- **THEN** a driver request can retrieve the snapshot at any stage
- **AND** the result file records it alongside the stage's process-memory sample

### Requirement: Diagnostics are gated out of ordinary production operation

The diagnostic surface SHALL be inactive — not installed, or installed and unreachable — unless the diagnostics switch or the memory-scenario environment gate is present. Production operation SHALL NOT monkey-patch browser globals to observe resource creation, SHALL NOT continuously capture stack traces, and SHALL NOT add per-operation overhead beyond what an explicitly enabled mode incurs. Developer/test diagnostics that are richer (allocation-site samples, per-owner listings) SHALL themselves be bounded.

#### Scenario: A production configuration installs none of the surface

- **WHEN** the application starts under a production configuration
- **THEN** no heartbeat test timer, error history, owned-URL bookkeeping writes, or scenario host is active
- **AND** the reliability harness configuration explicitly enables what it consumes

#### Scenario: Rich modes are themselves bounded

- **WHEN** the diagnostics switch enables allocation-site sampling or per-owner listings
- **THEN** those records are capped rings with a documented maximum
- **AND** disabling the switch stops further collection
