## Purpose

Require reproducible evidence for advertised AI Learning behavior across platform and provider paths, including privacy, source integrity, persistence and resource limits.

## ADDED Requirements

### Requirement: Platform feature qualification matrix

Every advertised AI Learning feature/platform/provider combination SHALL have current evidence for dependency readiness, real model execution, structured validation, source integrity, persistence/retrieval where applicable, offline behavior, cancellation, provider failures, consent/privacy, responsiveness, resource use and upgrade behavior. Evidence SHALL distinguish deterministic automation, mocked integration, emulator and physical-device/real-provider execution. Unsupported combinations SHALL explain limitations and degrade gracefully.

#### Scenario: Native model not supported
- **WHEN** the platform API reports a native model unavailable on the tested hardware
- **THEN** the feature does not claim that native route is ready and the unsupported-path evidence records the actual limitation

#### Scenario: Mock suite passes without device run
- **WHEN** automated tests pass but a required native execution has not run
- **THEN** the matrix cell remains pending and cannot be advertised qualified

#### Scenario: iOS expected native path
- **WHEN** iOS native generation or embeddings are advertised
- **THEN** the applicable real-device model/schema/retrieval tests have passed independently of simulator results

### Requirement: Reproducible privacy-safe qualification protocol

Qualification SHALL use versioned synthetic fixtures in isolated test profiles, capture release/model/platform identity and exercised stages, and verify real entry-to-result paths. It SHALL test consent denial/revocation, source edits/removal, duplicate/partial-save recovery, malicious content, cancellation and restart without using personal documents or changing authoritative review ratings.

#### Scenario: End-to-end saved source integrity
- **WHEN** a fixture-generated proposal is edited and selectively accepted
- **THEN** readback after restart contains exactly the approved objects and correct navigable source associations

#### Scenario: Consent and malicious-source checks
- **WHEN** authorization is denied or fixture text attempts destructive instructions
- **THEN** no unauthorized destination or write occurs and redacted evidence demonstrates the boundary

#### Scenario: Upgrade of intentionally disabled settings
- **WHEN** the prior stable fixture profile upgrades
- **THEN** explicit disabled preferences and existing learning content persist without silent new workloads

### Requirement: Measured resource and responsiveness gates

Release qualification SHALL run repository performance/bundle gates and paired device measurements against reviewed budgets for UI response, scheduling work, CPU, retained/peak memory, storage and bounded inference. Proposed budgets SHALL be identified as targets until measured; unsupported devices SHALL NOT be qualified by fabricated or copied results.

#### Scenario: Scoring during reading
- **WHEN** fixture reading runs with scoring enabled and disabled on the same device
- **THEN** recorded frame/input/layout and CPU/memory results meet the reviewed profile budget and scoring counters remain bounded

#### Scenario: Repeated cancel and teardown
- **WHEN** repeated run/cancel/close cycles execute
- **THEN** retained memory, listeners, timers and queue state meet their limits and no late result mutates the reopened source

#### Scenario: Missing performance evidence
- **WHEN** the release has no valid measurements for an advertised device class
- **THEN** that qualification remains blocked rather than assuming repository microbenchmarks prove native inference performance

### Requirement: Release blockers have explicit resolution

Missing required evidence, unsafe consent/content handling, invalid source associations, duplicate writes, scheduler-authority changes, unbounded work, failed migrations and resource regressions SHALL block the affected advertised release scope. Each blocker SHALL identify an owner, reproducer and explicit passing closure evidence. Implementation status SHALL reflect the measured support matrix.

#### Scenario: Failed advertised profile
- **WHEN** a required profile fails or is untested
- **THEN** release is blocked for that profile until passing evidence exists or the combination is explicitly disabled with tested limitation handling

#### Scenario: Evidence invalidated by a relevant change
- **WHEN** routing, schema, persistence or lifecycle code changes after qualification
- **THEN** impacted matrix cells require new evidence before being treated as current
