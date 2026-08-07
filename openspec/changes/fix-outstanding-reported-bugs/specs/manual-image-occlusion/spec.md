## ADDED Requirements

### Requirement: Hand-authoring occlusion regions

The system SHALL provide an editor in which the user draws occlusion regions directly onto an image and saves the result as an image-occlusion learning item.

#### Scenario: Drawing a region

- **WHEN** the user drags across the image in the occlusion editor
- **THEN** a rectangular region is created following the drag
- **AND** the region is listed as a maskable area of the card

#### Scenario: Saving with at least one region

- **WHEN** the user saves an image with one or more regions
- **THEN** an `image-occlusion` learning item is persisted referencing the image asset and its regions
- **AND** it uses the same stored shape the AI-generated path already produces

#### Scenario: Saving with no regions

- **WHEN** the user attempts to save with zero regions
- **THEN** saving is refused with an explanation
- **AND** no learning item is created

### Requirement: Editing existing regions

The editor SHALL allow a region to be moved, resized, relabelled and deleted after it is created.

#### Scenario: Resizing a region

- **WHEN** the user drags a region's handle
- **THEN** the region's bounds update and stay within the image
- **AND** the change is reflected in the saved card

#### Scenario: Deleting a region

- **WHEN** the user deletes a region
- **THEN** it is removed from the card
- **AND** the remaining regions keep their identity and order

### Requirement: AI-proposed regions are correctable

Regions proposed by the AI occlusion path SHALL open in the same editor so the user can correct them instead of discarding the card.

#### Scenario: Correcting an AI proposal

- **WHEN** the AI proposes occlusion regions for an image
- **THEN** the user can open those regions in the editor
- **AND** adjust, add or delete them before saving

#### Scenario: AI returns unusable regions

- **WHEN** the AI returns no regions, or regions outside the image bounds
- **THEN** the out-of-bounds regions are clamped or dropped
- **AND** the editor opens with the image so the user can author regions manually
- **AND** no card is silently created with zero usable regions
