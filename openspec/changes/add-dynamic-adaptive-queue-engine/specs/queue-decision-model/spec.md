## Purpose

Defines the pluggable decision-model provider that supplies the continuous,
discrete, and binary judgements the adaptive ranker consumes — topical
alignment, cognitive-load tiering, and prerequisite/pruning gates — behind one
stable contract, with content-hash caching, local-first privacy, and
deterministic fallback when no model is reachable.

## ADDED Requirements

### Requirement: One provider contract exposes three evaluation primitives

The system SHALL define a single decision-model provider interface exposing
exactly three evaluation primitives, each of which SHALL return a value in
`[0,1]`:

- `evaluateScore` — a continuous judgement over item properties such as topical
  alignment to the active goal, atomic extractability, and conceptual complexity.
- `evaluateChoice` — a discrete classification of an item into a cognitive-load
  tier (`surface-skim`, `medium-analysis`, `deep-foundational`), whose tier maps
  onto the `1..5` complexity scale used by energy fit.
- `evaluateNoul` — a fast binary gate answering whether prerequisites are met,
  whether an item is stale enough to prune, or whether it is ready for review.

Providers SHALL be registered and looked up by a stable provider id, and the
ranker SHALL be able to run with no provider registered.

#### Scenario: Provider supplies all three primitives

- **GIVEN** a registered decision-model provider
- **WHEN** the ranker evaluates a candidate item
- **THEN** it SHALL obtain a score, a load tier, and a gate result for that item
- **AND** each result SHALL lie within `[0,1]` or be a valid tier identifier

#### Scenario: Ranker runs with no provider registered

- **GIVEN** no decision-model provider is registered or configured
- **WHEN** the queue is re-ranked
- **THEN** ranking SHALL complete using local fallbacks for every model-derived term
- **AND** no provider-specific error SHALL be raised

#### Scenario: Provider identity is stable

- **WHEN** a provider is registered under an id
- **THEN** that id SHALL persist across sessions and SHALL be the value the settings store persists
- **AND** re-registering the same id SHALL replace, not duplicate, the prior registration

### Requirement: Structured model output is schema-validated before use

Every provider response SHALL pass schema validation before any downstream use.
Where a backend offers native schema-enforced structured output it SHALL be
preferred; otherwise the system SHALL use a strict-JSON prompt mode followed by
validation, with **at most one** repair retry. An unresolved failure SHALL
surface the invalid-structured-output category and SHALL NOT produce a
partially valid object; the affected term SHALL take its local fallback.

#### Scenario: Malformed output is repaired at most once

- **WHEN** a provider returns malformed JSON for an evaluation
- **THEN** the system SHALL attempt at most one repair pass
- **AND** a second failure SHALL NOT trigger further retries
- **AND** the term SHALL take its local fallback value

#### Scenario: Out-of-range score is rejected

- **WHEN** a provider returns `1.7` for `evaluateScore`
- **THEN** validation SHALL fail
- **AND** the term SHALL take its local fallback rather than being clamped silently

### Requirement: Model inference is served from a content-hash cache

Item-property judgements that depend only on item content — complexity, load
tier, prerequisite readiness — SHALL be cached locally keyed by a hash of that
content plus the evaluation's rubric version. A cache hit SHALL NOT trigger
inference. Only session-dependent variables (alignment to the current goal,
fatigue-adjusted relevance) SHALL bypass the cache. Changing a cached item's
content SHALL invalidate its cached judgements.

#### Scenario: Repeat evaluation is served from cache

- **GIVEN** item `i`'s content and rubric version have already been evaluated
- **WHEN** the ranker evaluates `i` again in a later session
- **THEN** the cached judgement SHALL be returned
- **AND** no inference SHALL be issued

#### Scenario: Content change invalidates the cache

- **WHEN** item `i`'s content changes
- **THEN** its cached content-derived judgements SHALL be treated as stale
- **AND** a fresh evaluation SHALL be issued

#### Scenario: Session-dependent judgement is not cached

- **GIVEN** an evaluation whose input includes the user's current goal statement
- **WHEN** the goal changes
- **THEN** that judgement SHALL be recomputed rather than served from the content cache

### Requirement: Local-first privacy with a sanitization gate for any remote provider

Item content SHALL NOT leave the device by default. When the user configures a
remote decision model, the system SHALL require an explicit opt-in, and any
payload sent SHALL be limited to a non-identifying structural outline of the item
— its heading skeleton, type, and length — never its body text. With the opt-in
absent, a remote provider SHALL NOT be contacted.

#### Scenario: No remote call without opt-in

- **GIVEN** a remote decision model is configured but not opted in
- **WHEN** the ranker requests a judgement
- **THEN** no request SHALL be made to the remote provider
- **AND** local fallback values SHALL be used

#### Scenario: Opted-in payloads carry no body text

- **GIVEN** the user has opted in to a remote decision model
- **WHEN** a judgement is requested for an item
- **THEN** the outgoing payload SHALL contain only the item's structural outline
- **AND** the payload SHALL NOT contain the item's body text, title verbatim, or its tags

#### Scenario: Local provider needs no opt-in

- **GIVEN** a local or on-device decision model is configured
- **WHEN** a judgement is requested
- **THEN** no opt-in SHALL be required and no payload SHALL leave the device

### Requirement: Provider failure is bounded and non-fatal

Every provider call SHALL be bounded by a timeout. A provider that is
unreachable, errors, exceeds its timeout, or returns invalid output SHALL be
treated as unavailable for that evaluation: the affected term SHALL take its
local fallback, the failure SHALL be recorded for diagnostics, and ranking SHALL
complete. Repeated provider failure SHALL NOT escalate into repeated retries
within a single ranking pass.

#### Scenario: Provider times out

- **GIVEN** a provider that exceeds its per-call timeout
- **WHEN** the ranker evaluates an item
- **THEN** the affected term SHALL take its local fallback
- **AND** the ranking pass SHALL complete
- **AND** the timeout SHALL be recorded for diagnostics

#### Scenario: Failure is counted once per pass

- **WHEN** a provider has already failed within the current ranking pass
- **THEN** further provider calls in that same pass SHALL be skipped rather than retried per item

#### Scenario: Provider recovers

- **GIVEN** a provider previously failed
- **WHEN** it becomes available again
- **THEN** subsequent evaluations SHALL use it without any user intervention
- **AND** content-derived judgements SHALL repopulate the cache