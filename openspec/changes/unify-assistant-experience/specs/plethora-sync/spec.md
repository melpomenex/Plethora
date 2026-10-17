## ADDED Requirements

### Requirement: Eligible Assistant conversations replicate through existing encrypted sync

On enrolled compatible devices with permitted sync, eligible canonical conversation metadata, completed messages, source/citation references and saved artifact outcomes SHALL replicate using the existing encrypted account/collection sync domain. Local save and remote acknowledgment SHALL have distinct visible states. Device-local, local-only, AI-excluded-dependent and unauthorized cross-collection material SHALL not enter replication payloads. Credentials, raw device paths, inline image bytes and transient recognition/request state SHALL remain local. Unsupported browsers, servers or client versions SHALL report device-local availability rather than claim sync success.

#### Scenario: Continue a mobile selection thread on desktop
- **GIVEN** two compatible enrolled devices and an eligible selection-seeded conversation with acknowledged sync
- **WHEN** the user opens its History entry in the desktop research workspace
- **THEN** the same conversation ID, completed turns, selection provenance, citations and saved artifact references appear
- **AND** continuation revalidates the receiving device's source/provider permissions without executing saved tools

#### Scenario: Local-only conversation
- **GIVEN** a conversation has used local-only source content or source-derived text
- **WHEN** messages are saved or source chips are removed
- **THEN** that conversation remains visibly device-local and its private content does not enter the outbox

#### Scenario: Offline or incompatible receiving device
- **GIVEN** sync is offline, quota-limited, revoked or unsupported by a participating version
- **WHEN** a conversation is saved
- **THEN** local use and history work with an honest pending/error/unsupported state
- **AND** no unsupported record is silently skipped while reported as synchronized

### Requirement: Concurrent conversation changes preserve both devices' work

Completed turns SHALL merge idempotently by stable identity and causal ordering, preserving concurrent branches rather than replacing the whole transcript. Independent metadata changes SHALL use deterministic field conflict semantics, and meaningful unresolved edits SHALL expose recovery. Dirty local drafts SHALL not be overwritten by remote data. Conversation deletion tombstones SHALL defeat late retries/imports; source deletion SHALL retain authorized conversation history with unavailable evidence rather than resurrect a source.

#### Scenario: Two offline follow-ups
- **GIVEN** two devices independently continue the same parent turn offline
- **WHEN** they synchronize repeatedly in different orders
- **THEN** both continuations remain exactly once in a deterministic visible branch/order structure
- **AND** the user can choose a continuation without an automatic model call or replayed artifact action

#### Scenario: Remote update while composing
- **GIVEN** a local draft is dirty and a remote turn or optional draft snapshot arrives
- **WHEN** sync applies it
- **THEN** remote history becomes available without overwriting the local draft
- **AND** any alternative draft is offered separately

#### Scenario: Delete versus late answer
- **GIVEN** one device deleted a conversation while another attempt was in flight
- **WHEN** the late completion/import arrives
- **THEN** the deletion is not undone and the orphaned result is handled as recoverable data without automatic resurrection or tool execution
