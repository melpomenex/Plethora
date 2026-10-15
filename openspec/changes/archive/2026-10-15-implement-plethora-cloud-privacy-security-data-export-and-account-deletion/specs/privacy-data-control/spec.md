## ADDED Requirements

### Requirement: A living data map discloses all data flows
A privacy data map (in-app privacy center + `docs/PRIVACY_ARCHITECTURE.md`) SHALL document, per feature: what data leaves the device, when, why, destination, retention, encryption state, third-party model involvement, retained metadata, deletion options, and what stays local. The map SHALL be generated from a machine-readable disclosure registry that features populate, with a CI check that every cloud-capable feature has a complete entry.

#### Scenario: Registry completeness enforced
- **WHEN** a cloud-path feature lacks a disclosure entry
- **THEN** the CI completeness check fails

### Requirement: Local-only flag is centrally enforced
A per-document "local only" flag SHALL be the single cloud-eligibility control, exposed in the privacy center and document settings, and enforced across every cloud path (embeddings, reconstruction, premium TTS, cloud transcription, remote capture). Enforcement SHALL be verifiable by a central test matrix that each cloud path registers into.

#### Scenario: Flag blocks every path
- **WHEN** a flagged document is targeted at each registered cloud path
- **THEN** every path refuses with a policy reason and performs no upload

### Requirement: Account deletion is explicit, complete, and local-safe
In-app account deletion SHALL use multi-step consent distinguishing cloud deletion from an explicitly optional local erase. Cloud deletion SHALL remove account-held data (inbox, capture, sync ciphertext, job data, usage records, webhook/token config) per the documented retention schedule, with a schema-driven completeness test that fails when content-bearing stores lack handling. Local data SHALL be untouched unless the separate local-erase opt-in is checked.

#### Scenario: Default deletion spares the library
- **WHEN** a user deletes their account without the local-erase checkbox
- **THEN** cloud data is removed and the local library remains fully intact

#### Scenario: New store breaks completeness loudly
- **WHEN** a new content-bearing server table is added without deletion handling
- **THEN** the schema-driven deletion-completeness test fails

### Requirement: Export provides verifiable portability
A unified local export (documented versioned `.plethora` archive: documents, extracts, cards, scheduling, settings, metadata) SHALL round-trip into a fresh install with fidelity (counts, scheduling state, positions) proven by tests. Cloud-held data SHALL be exportable via the export job per a published completeness contract.

#### Scenario: Round-trip fidelity
- **WHEN** a populated library is exported and imported into a fresh profile
- **THEN** document/extract/card counts, review schedules, and reading positions match

### Requirement: Telemetry and crash reporting are opt-in and content-free
Telemetry (anonymous counters) and crash reporting (stack traces, error classes) SHALL default OFF, be toggleable, never include content (titles, URLs, extracts — verified by fuzzed-content scans), and be documented in the data map.

#### Scenario: Default-off verified
- **WHEN** a fresh install runs with defaults
- **THEN** no telemetry or crash endpoint receives anything

### Requirement: Security events are audited without content
Server audit logging SHALL record login, device add/revoke, token create/rotate/revoke, account deletion, webhook config changes, and kill-switch actions (actor, time, event class) with no content fields; a user-facing account-activity view SHALL render them.

#### Scenario: Device revocation audited
- **WHEN** a device is revoked
- **THEN** an audit record exists and appears in account activity

### Requirement: Secrets follow a documented inventory and rotation runbook
`docs/SECURITY.md` SHALL inventory secrets (keychain services, server provider keys, signing keys, store credentials) with rotation procedures; no secrets SHALL be committed to the repository (CI secret-pattern scan on history going forward).

#### Scenario: Secret scan gates commits
- **WHEN** a change introduces a committed secret pattern
- **THEN** CI scanning flags it
