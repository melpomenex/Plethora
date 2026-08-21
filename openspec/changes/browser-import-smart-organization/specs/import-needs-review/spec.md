# Import Needs Review

## ADDED Requirements

### Requirement: Needs Review SHALL be a cross-item virtual view

The application SHALL provide a query or view over browser-created documents, extracts, Q&A/cloze items, and image-occlusion items whose organization status is uncertain, incomplete, conflicted, or explicitly marked for review. The view SHALL not move records into a separate inbox.

#### Scenario: A low-confidence card is created

- **WHEN** organization produces no meaningful tag or a below-policy-confidence result
- **THEN** the card SHALL appear in Needs Review with a reason and its original content intact

#### Scenario: A high-confidence import completes

- **WHEN** organization produces policy-approved tags and no conflict
- **THEN** the import SHALL not appear in Needs Review by default

### Requirement: Review actions SHALL preserve user authority and provenance

Review SHALL support accepting or editing a suggestion, removing a tag, adding or creating a tag, retagging, marking the result correct, dismissing a suggestion, and retrying organization. Actions SHALL use existing item-tag semantics and SHALL record manual or dismissed provenance so later jobs cannot undo them.

#### Scenario: A user accepts one suggestion

- **WHEN** the user accepts a suggested tag
- **THEN** it SHALL become a manual/user-confirmed assignment and the corresponding review reason SHALL clear if no other reason remains

#### Scenario: A user dismisses one suggestion

- **WHEN** the user dismisses a suggested tag
- **THEN** the tag SHALL remain absent and a dismissal tombstone SHALL prevent the same suggestion from returning without explicit retry/reset

### Requirement: Review actions SHALL be idempotent and support bulk work

Single-item and bulk review actions SHALL be safe to retry, SHALL skip deleted or already-resolved targets, and SHALL report partial failures without rolling back successful unrelated items.

#### Scenario: A bulk accept is repeated

- **WHEN** the same bulk action is submitted twice
- **THEN** existing manual assignments SHALL remain single assignments and the result SHALL remain resolved

#### Scenario: One item in a bulk action is unavailable

- **WHEN** a target is deleted or fails validation during a bulk operation
- **THEN** other valid targets SHALL still be processed and the unavailable target SHALL have an actionable error

### Requirement: Needs Review SHALL remain optional

The application SHALL continue to allow normal save, browsing, reading, and studying without opening or clearing the view. Review SHALL be discoverable through navigation or commands but SHALL not block capture completion.

#### Scenario: A user never opens Needs Review

- **WHEN** uncertain imports accumulate
- **THEN** they SHALL remain available in their normal collections and the application SHALL continue to function normally
