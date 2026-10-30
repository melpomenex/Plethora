## MODIFIED Requirements

### Requirement: Tool execution confirmation
After tool execution the system SHALL report what was durably created, using committed receipts rather than requested counts. Pending, saved, and failed learning artifacts SHALL be distinct; saved status and Open actions SHALL require a persisted identity. Batch partial failures SHALL retain successful cards and identify failed candidates with readable recoverable errors. Diagnostic transport/SQL details SHALL NOT replace understandable user feedback.

#### Scenario: Flashcard creation succeeds
- **WHEN** single or batch card creation commits N cards
- **THEN** the Assistant confirms N saved cards and their persisted identities can be opened

#### Scenario: Extract creation succeeds
- **WHEN** extract creation commits
- **THEN** the Assistant confirms the persisted extract was saved to its document

#### Scenario: Tool call fails
- **WHEN** a tool fails validation or persistence
- **THEN** the Assistant shows an actionable error and does not claim its candidates were saved

#### Scenario: Mixed batch results
- **WHEN** four candidates produce two committed cards and two failures
- **THEN** the Assistant shows exactly two saved and two failed, preserving each successful identity

## ADDED Requirements

### Requirement: Learning writes validate canonical source identity
Card creation from Chat, Learning Agent acceptance, and Studio SHALL validate source document/collection existence and extract-parent relationships at the authoritative persistence boundary. A UI context namespace or model-invented ID SHALL NOT be stored as a document foreign key. Source identity/content revision SHALL be frozen for the request; a deleted/revoked source SHALL fail safely without silently creating unlinked cards. Foreign-key and supported sync/tree/count consistency SHALL remain enforced.

#### Scenario: Card creation from an active extract
- **WHEN** an extract context has a display key distinct from its stored parent document ID
- **THEN** created cards reference the actual parent document and extract, never the display key

#### Scenario: Source invalidated before save
- **WHEN** a document/extract is deleted, mismatched, unavailable, or disallowed before persistence
- **THEN** the affected card fails with a recoverable source error and no orphan or misleading saved artifact is produced

### Requirement: Candidate validation and retries preserve exactly-once creation
Malformed or unsupported card candidates SHALL be rejected before corrupt rows are inserted. Single and batch creates SHALL use the same canonical card contract, including cloze source. Each accepted candidate SHALL have a retry-stable identity; retrying a failed/uncertain batch SHALL preserve successful IDs and create no duplicate cards. Partial failure SHALL identify failed candidates individually.

#### Scenario: Retry after uncertain response
- **WHEN** creation commits but its response is lost and the accepted candidate is retried
- **THEN** the same persisted identity is returned without another card

#### Scenario: Batch cloze and malformed candidate
- **WHEN** a batch contains a valid numbered cloze and an invalid candidate
- **THEN** the cloze persists in the same canonical form as single creation and the invalid candidate is identified without corrupting successful results

### Requirement: Creation respects acceptance policy and provider availability
Learning Agent writes SHALL retain preview/validation/approval; explicit Chat create requests SHALL retain their supported act-on-request policy while preview-only requests create nothing. Selected local/on-device, Apple, and remote providers SHALL share validated scope and persistence behavior. Unavailable local inference SHALL NOT silently route remotely, and local generation SHALL NOT require an unrelated cloud API key.

#### Scenario: Preview and local provider failure
- **WHEN** a user requests only card previews or the selected local provider times out
- **THEN** no unauthorized durable cards or silent remote retries occur and recoverable drafts remain available
