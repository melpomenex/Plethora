## ADDED Requirements

### Requirement: A dedicated Image Occlusion Composer is the single authoring surface

The application SHALL provide one full-screen Image Occlusion Composer that authors occlusion cards for a single image asset. Every image-occlusion authoring flow SHALL open this composer rather than an inline form embedded in another surface. The composer SHALL show, at minimum: the image on an interactive canvas, the region list, the occlusion mode selector, a card preview, and explicit Save and Cancel actions.

#### Scenario: Composer opens with the chosen image

- **WHEN** the composer is opened for an image-registry asset id
- **THEN** the composer renders full-screen with that image loaded on the canvas
- **AND** the region list is empty unless regions were passed in

#### Scenario: Composer opens with existing regions for editing

- **WHEN** the composer is opened for a card that already has occlusion regions
- **THEN** those regions are rendered on the canvas and listed in the region list
- **AND** saving without changes leaves the card's regions unchanged

#### Scenario: Cancel discards authoring work

- **WHEN** the user cancels the composer after drawing or editing regions
- **THEN** no card is created or modified
- **AND** the user is returned to the surface that opened the composer

#### Scenario: Cancel with unsaved work asks for confirmation

- **WHEN** the user attempts to close the composer while it holds unsaved regions
- **THEN** a confirmation is shown before the work is discarded

### Requirement: The composer is reachable from every surface that has an image

The composer SHALL be openable from the document-viewer image hover control, the image registry/library, a pasted or dropped image file, the Flashcard Studio images sheet, and the Flashcard Studio `image-occlusion` draft card type. Opening from a surface that supplies an image that is not yet in the image registry SHALL ingest that image into the registry before the composer opens.

#### Scenario: Opening from a document image

- **WHEN** the user activates the occlusion control on a hovered image inside a document viewer
- **THEN** the image is ingested into the image registry
- **AND** the composer opens on that image without routing through the Flashcard Studio card-edit form

#### Scenario: Opening from a pasted image

- **WHEN** the user pastes or drops an image file into the composer entry point
- **THEN** the image is ingested into the image registry
- **AND** the composer opens on the newly ingested asset

#### Scenario: Opening from the studio draft card type

- **WHEN** the user sets a Flashcard Studio draft card's type to `image-occlusion` and edits it
- **THEN** the composer opens for that draft's image and regions
- **AND** saving the composer writes the regions back to the draft card

### Requirement: Occlusion mode determines how many cards a session produces

The composer SHALL offer two occlusion modes and SHALL default to "one card per region":

- **One card per region** — each region produces its own card in which that region alone is hidden and all other regions are visible.
- **Hide all, one card** — all regions produce a single card in which every region is hidden simultaneously.

Changing the mode SHALL NOT alter region geometry.

#### Scenario: One card per region produces N cards

- **WHEN** the user saves three regions in "one card per region" mode
- **THEN** three cards are created
- **AND** each card hides exactly one of the three regions and leaves the other two visible

#### Scenario: Hide all produces a single card

- **WHEN** the user saves three regions in "hide all, one card" mode
- **THEN** one card is created holding all three regions

#### Scenario: Switching modes preserves geometry

- **WHEN** the user switches occlusion mode after drawing regions
- **THEN** every region keeps its position, size, and label

### Requirement: The composer previews the cards that will be created

The composer SHALL display a review-accurate preview of the resulting cards showing the front (masked) and back (revealed) states. When the selected mode produces multiple cards, the preview SHALL allow stepping through each card and SHALL display the total card count.

#### Scenario: Preview reflects the current mode and regions

- **WHEN** the user has drawn two regions in "one card per region" mode
- **THEN** the preview reports that two cards will be created
- **AND** stepping to the second preview shows the second region masked and the first visible

#### Scenario: Preview updates as regions change

- **WHEN** the user moves, resizes, or deletes a region
- **THEN** the preview reflects the change without requiring a manual refresh

### Requirement: Saving requires at least one usable region

The composer SHALL disable saving while the session has no region with positive in-bounds area, and SHALL explain why saving is unavailable. Regions that clamp to zero area SHALL NOT be persisted.

#### Scenario: Save blocked with no regions

- **WHEN** the composer has no regions
- **THEN** the Save action is disabled
- **AND** a message states that at least one region is required

#### Scenario: Zero-area regions are dropped on save

- **WHEN** the user saves a session containing one usable region and one region that clamps to zero area
- **THEN** the saved card contains only the usable region

### Requirement: Saved cards carry authoring metadata

Cards created by the composer SHALL be persisted against the source image-registry asset id with percent-based region coordinates, and SHALL take the target deck, document association, and question/answer text supplied in the composer. When a card's hidden region carries a label, that label SHALL be used as the card's answer text unless the user has supplied answer text explicitly.

#### Scenario: Region label becomes the answer

- **WHEN** the user labels a region "hippocampus" and saves in "one card per region" mode without entering answer text
- **THEN** that region's card has "hippocampus" as its answer

#### Scenario: Explicit answer text wins over the label

- **WHEN** the user supplies answer text for a card and its region also has a label
- **THEN** the supplied answer text is persisted
