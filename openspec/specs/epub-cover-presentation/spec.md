# epub-cover-presentation Specification

## Purpose
Defines how EPUB book covers are displayed in mobile library dashboard cards so users can see the complete cover at a useful size on touch devices.

## Requirements

### Requirement: EPUB covers fit mobile library cards

On mobile, the library dashboard SHALL display the complete image for an EPUB cover within the existing horizontal card cover frame while preserving the image's aspect ratio. It SHALL NOT crop or enlarge the cover beyond the frame, apply a hover zoom to it, or change the frame dimensions to accommodate the image.

#### Scenario: Portrait EPUB cover in a mobile dashboard card
- **WHEN** an EPUB document with a portrait cover is displayed in a mobile library dashboard card
- **THEN** the entire cover image SHALL be visible within the card's existing cover frame
- **AND** the image SHALL retain its aspect ratio and be scaled to fit without being enlarged beyond the frame
- **AND** touch interaction SHALL NOT apply a hover zoom that crops or enlarges the cover

#### Scenario: Desktop EPUB cover retains its presentation
- **WHEN** an EPUB document with a cover is displayed in a desktop library dashboard card
- **THEN** its cover SHALL retain the existing desktop presentation behavior

#### Scenario: Non-EPUB mobile cover retains its presentation
- **WHEN** a non-EPUB document with a cover is displayed in a mobile library dashboard card
- **THEN** its cover SHALL retain the existing presentation behavior
