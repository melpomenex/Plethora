## Purpose

Defines the pluggable decision-model provider that supplies the continuous, discrete, and
binary judgements the adaptive ranker consumes — topical alignment, cognitive-load tiering, and
prerequisite/pruning gates — behind one stable contract, with content-hash caching, local-first
privacy, and deterministic fallback when no model is reachable.

## ADDED Requirements

### Requirement: A configured decision provider participates in ranking, not only in the probe

The system SHALL instantiate a decision-model provider for the configured provider id whenever
one is configured, register it, and consult it during ranking. A connection probe SHALL NOT be
the only consumer of a provider: a provider the user has configured and enabled SHALL be
reachable from the ranking path. When no provider is configured, ranking SHALL proceed on local
fallbacks exactly as before.

#### Scenario: Configured provider is consulted during ranking
- **GIVEN** a decision-model provider is configured and a session goal is set
- **WHEN** the queue is ranked
- **THEN** the configured provider SHALL be consulted for the judgements it can answer
- **AND** its verdicts SHALL be used where a verdict was obtained

#### Scenario: No provider configured leaves ranking unchanged
- **GIVEN** no decision-model provider is configured
- **WHEN** the queue is ranked
- **THEN** ranking SHALL complete using local fallbacks
- **AND** the goal-relevance term SHALL still be derived locally

### Requirement: The session goal is the provider's session-dependent input

The system SHALL pass the user's current goal statement, together with the tags focused for the
session, to the provider as the goal context when requesting a continuous judgement. A judgement
whose result depends on the goal SHALL be recomputed whenever the goal changes and SHALL NOT be
served from the content-hash cache, because the goal is session-dependent rather than a property
of the item's content.

#### Scenario: Goal context reaches the provider
- **GIVEN** a session goal is set and a provider is configured
- **WHEN** the ranker requests a continuous judgement for an item
- **THEN** the provider SHALL receive the goal statement and the session's focused tags

#### Scenario: Changing the goal bypasses the cache
- **GIVEN** a goal-dependent judgement for an item has already been computed
- **WHEN** the session goal changes and the item is re-evaluated
- **THEN** the judgement SHALL be recomputed
- **AND** the previously cached value SHALL NOT be reused

#### Scenario: No goal means no goal context is claimed
- **GIVEN** no session goal is set
- **WHEN** the ranker requests a continuous judgement for an item
- **THEN** the provider SHALL receive no goal statement
- **AND** the request SHALL NOT be treated as a goal that matched nothing

### Requirement: Content-derived judgements are cached across sessions

The system SHALL persist content-derived judgements — cognitive-load tier, complexity,
prerequisite readiness — in the local content-hash cache so that a repeat evaluation of
unchanged content issues no inference. Changing an item's content or the rubric version SHALL
invalidate its cached judgements.

#### Scenario: Repeat evaluation is served from cache
- **GIVEN** an item's content and rubric version have already been evaluated
- **WHEN** the ranker evaluates that item again in a later session
- **THEN** the cached judgement SHALL be returned
- **AND** no inference SHALL be issued

#### Scenario: Content change invalidates the cache
- **GIVEN** an item's content-derived judgements are cached
- **WHEN** the item's content changes
- **THEN** its cached judgements SHALL be treated as stale
- **AND** a fresh evaluation SHALL be issued

### Requirement: The remote opt-in is enforced on the ranking path

The opt-in that permits contacting a remote decision model SHALL be checked before the ranking
path builds an outbound payload, so that with the opt-in absent a remote provider is never
contacted by ranking. The opt-in SHALL gate the ranking path and not only the connection probe;
a user who has run a probe SHALL NOT thereby have consented to ranking-time requests.

#### Scenario: Ranking does not contact a remote provider without the opt-in
- **GIVEN** a remote decision model is configured but not opted in
- **WHEN** the queue is ranked
- **THEN** no request SHALL be made to the remote provider by the ranking path
- **AND** local fallback values SHALL be used

#### Scenario: Running a probe does not imply consent to ranking
- **GIVEN** the user has run a connection probe against a remote provider
- **WHEN** the queue is ranked with the opt-in absent
- **THEN** the ranking path SHALL NOT contact that provider

#### Scenario: Opted-in payloads carry the goal but no item body text
- **GIVEN** the user has opted in to a remote decision model
- **WHEN** a judgement is requested for an item
- **THEN** the outgoing payload SHALL contain the goal statement and the item's structural outline
- **AND** the payload SHALL NOT contain the item's body text, its title verbatim, or its tags

### Requirement: Provider transport is shared with the connection probe

Endpoint resolution, request-body construction, and response envelope unwrapping SHALL have a
single implementation used by both the ranking path and the connection probe. Adding a provider
to one path SHALL NOT require a separate change to the other, and the two paths SHALL NOT
disagree about which endpoint a provider id resolves to.

#### Scenario: Probe and ranking agree on the endpoint
- **GIVEN** any configured decision provider
- **WHEN** its endpoint is resolved for a probe and for a ranking evaluation
- **THEN** both SHALL resolve to the same URL

#### Scenario: Clef's Workers AI path is resolved, not the System One path
- **GIVEN** the Clef provider and a Cloudflare account id
- **WHEN** a judgement is requested
- **THEN** the resolved endpoint SHALL be the Workers AI `ai/run` path for the selected model
- **AND** it SHALL NOT be the System One path

#### Scenario: Wrapped REST envelopes are unwrapped on the ranking path
- **GIVEN** a provider that returns `{ "result": { "answers": { ... } } }`
- **WHEN** the ranking path parses that response
- **THEN** the answers SHALL be read from `result.answers`

### Requirement: Provider credentials are resolved from the keychain at call time

The system SHALL resolve a provider's credential from the OS keychain at call time and SHALL NOT
read it from the settings store, which persists to local storage. Only the boolean "is a key
configured" SHALL be persisted in settings. The frontend SHALL NOT receive the secret.

#### Scenario: Secret is never persisted in settings
- **GIVEN** a provider credential is stored
- **WHEN** the settings are inspected
- **THEN** the secret SHALL NOT appear among them
- **AND** only a boolean indicating that a credential exists SHALL appear

#### Scenario: Ranking resolves the credential from the keychain
- **GIVEN** a configured provider with a credential in the keychain
- **WHEN** a judgement is requested
- **THEN** the credential SHALL be read from the keychain at that moment

### Requirement: Provider failure during ranking is bounded and non-fatal

Every provider call made during ranking SHALL be bounded by a timeout. A provider that is
unreachable, errors, exceeds its timeout, or returns an out-of-range or malformed value SHALL
cause that term to take its local fallback, SHALL be recorded for diagnostics, and SHALL NOT
prevent the ranking pass from completing. Repeated failure within a single ranking pass SHALL
NOT trigger repeated retries per item.

#### Scenario: Provider times out mid-ranking
- **GIVEN** a configured provider that exceeds its per-call timeout
- **WHEN** the queue is ranked
- **THEN** the affected term SHALL take its local fallback
- **AND** the ranking pass SHALL complete
- **AND** the timeout SHALL be recorded for diagnostics

#### Scenario: Failure is counted once per pass
- **WHEN** a provider has already failed within the current ranking pass
- **THEN** further provider calls in that same pass SHALL be skipped rather than retried per item

#### Scenario: Out-of-range verdict is rejected, not clamped
- **WHEN** a provider returns a continuous score outside `[0,1]`
- **THEN** the value SHALL be rejected
- **AND** the term SHALL take its local fallback rather than a clamped value

#### Scenario: Provider recovers
- **GIVEN** a provider that previously failed
- **WHEN** it becomes reachable again
- **THEN** subsequent evaluations SHALL use it without user intervention