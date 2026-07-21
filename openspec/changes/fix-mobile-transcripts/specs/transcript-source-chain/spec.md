## ADDED Requirements

### Requirement: Ordered, platform-aware source chain

A transcript request SHALL be resolved by attempting sources in a fixed order: (1) local transcript cache, (2) on-device fetcher, (3) user-configured self-hosted transcript service, (4) hosted relay API. Sources that are unavailable on the current platform SHALL be skipped without an attempted call.

#### Scenario: Native mobile order

- **WHEN** a transcript is requested on a native Android or iOS build with no cached entry and no self-hosted service configured
- **THEN** the on-device fetcher is attempted first, and the hosted relay API is attempted only if the on-device fetcher returns a fall-through outcome

#### Scenario: Browser PWA skips on-device

- **WHEN** a transcript is requested in a browser PWA
- **THEN** the on-device fetcher is skipped entirely and resolution begins at the configured self-hosted service or the hosted relay API

#### Scenario: Self-hosted service takes precedence over the hosted relay

- **WHEN** the user has configured a self-hosted transcript service URL in Integration settings and the on-device fetcher did not produce a transcript
- **THEN** the self-hosted service is attempted before the hosted relay API

#### Scenario: Cache short-circuits the chain

- **WHEN** a cached transcript exists for the requested video and language
- **THEN** it is returned immediately and no further source is attempted

### Requirement: Terminal versus fall-through outcomes

The source chain SHALL distinguish outcomes that terminate the request from outcomes that advance to the next source. `NoCaptions` and `VideoUnavailable` SHALL be terminal. `PoTokenRequired`, `AgeRestricted`, `SignInRequired`, `RateLimited`, `Network`, and `Unknown` SHALL advance to the next source.

#### Scenario: Missing captions ends the chain

- **WHEN** the on-device fetcher returns `NoCaptions`
- **THEN** the request fails immediately with a "no captions available" message and the hosted relay is not called

#### Scenario: PO-token gating falls through to the relay

- **WHEN** the on-device fetcher returns `PoTokenRequired`
- **THEN** the hosted relay API is attempted, since the relay's `yt-dlp` worker can serve videos the on-device fetcher cannot

#### Scenario: All sources exhausted

- **WHEN** every applicable source returns a fall-through outcome
- **THEN** the request fails with an error naming each source attempted and its outcome, rather than a single generic message

### Requirement: Bounded latency per source

Each source attempt SHALL enforce its own timeout, and a source that times out SHALL be treated as a fall-through outcome rather than failing the whole request. The on-device fetcher SHALL use a shorter timeout than the hosted relay, whose cold path legitimately takes tens of seconds.

#### Scenario: On-device attempt hangs

- **WHEN** the on-device fetcher exceeds its timeout
- **THEN** the attempt is abandoned, recorded as a `Network` outcome, and the next source is attempted

#### Scenario: Relay cold fetch is given headroom

- **WHEN** the hosted relay is attempted and the video is not in the relay cache
- **THEN** the client waits at least as long as the relay's configured cold-fetch budget before declaring a timeout

### Requirement: Source attribution on every result

Every successfully resolved transcript SHALL carry the identifier of the source that produced it, and that attribution SHALL be retained for display in diagnostics.

#### Scenario: Result reports its source

- **WHEN** a transcript is resolved by the on-device fetcher
- **THEN** the result is attributed to the on-device source, distinguishable from a cache hit, a self-hosted result, and a relay result

#### Scenario: Attribution survives to the UI

- **WHEN** a transcript has been resolved for the current video
- **THEN** the diagnostics surface reports which source served it and how long that source took

### Requirement: On-device source can be disabled

Users SHALL be able to disable the on-device fetcher from Integration settings. When disabled, the chain SHALL skip it as if the platform did not support it.

#### Scenario: User disables on-device fetching

- **WHEN** the on-device source is disabled in settings and a transcript is requested on a native mobile build
- **THEN** resolution begins at the self-hosted or hosted relay source and no direct YouTube request is made from the device

#### Scenario: Default is enabled where supported

- **WHEN** a user has never changed the setting and the platform supports on-device fetching
- **THEN** the on-device source is enabled
