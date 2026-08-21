## ADDED Requirements

### Requirement: Shared Occlusion Set data model and card linking
The system SHALL associate cards generated from the same authoring session with a shared `occlusionSetId` and reference the full set of diagram regions alongside each card's individual `targetRegionId`.

#### Scenario: Creating batch of cards from single image in composer
- **WHEN** a user defines regions A, B, C, and D on an image in the Image Occlusion Composer with mode "Hide other answers"
- **THEN** the system SHALL generate four learning items sharing a common `occlusionSetId` and referencing the same `imageAssetId`
- **AND** each learning item's interaction metadata SHALL store its distinct `targetRegionId` and the complete list of all four regions

### Requirement: Non-destructive occlusion geometry updates
The system MUST allow editing occlusion set regions without resetting or destroying existing cards' review history, ratings, stability, or FSRS/SM-x scheduling state.

#### Scenario: Updating a region boundary in an existing set
- **WHEN** a user opens an existing occlusion set in the editor and adjusts the geometry or label of region B
- **THEN** the system SHALL update the geometry in the set metadata
- **AND** existing learning items targeting region B SHALL immediately reflect the updated geometry on next review without clearing their review log or due dates

#### Scenario: Deleting a region from an occlusion set
- **WHEN** a user deletes region D from an occlusion set containing A, B, C, and D
- **THEN** the system SHALL remove region D from the sibling region lists of cards A, B, and C
- **AND** the card specifically targeting region D SHALL be archived or deleted according to the user's confirmation

### Requirement: Backward-compatible legacy card migration
The system MUST gracefully support legacy image occlusion cards created prior to the shared occlusion set architecture.

#### Scenario: Reviewing legacy single-mask card
- **WHEN** the review queue loads a legacy image occlusion card that contains only `imageOcclusionRegions: [region]` without an `occlusionSetId` or `targetRegionId`
- **THEN** the system SHALL treat that single region as the active target
- **AND** the card SHALL render properly without crashing or throwing errors
