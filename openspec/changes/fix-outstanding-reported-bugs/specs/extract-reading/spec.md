## ADDED Requirements

### Requirement: Extracts open into a reading surface

The queue's primary action on an extract item SHALL open that extract in a reading surface that presents the extract's own text as the subject, not its source document.

#### Scenario: Primary action on an extract row

- **WHEN** the user activates the primary action on a queue row whose `itemType` is `extract`
- **THEN** an extract reading surface opens showing that extract's content
- **AND** the surface does not require the source document to be rendered first

#### Scenario: Primary action on a document row is unchanged

- **WHEN** the user activates the primary action on a queue row whose `itemType` is `document`
- **THEN** the source document opens in the document viewer exactly as before

### Requirement: Source document remains reachable from an extract

The extract reading surface SHALL offer an explicit action to open the source document positioned at the extract.

#### Scenario: Jumping to the source

- **WHEN** the user chooses "Open source document" from the extract reading surface
- **THEN** the source document opens with `focusedExtractId` set to that extract
- **AND** the extract card is scrolled into view and highlighted, as it is today

#### Scenario: Source document is missing

- **WHEN** the extract's source document cannot be loaded
- **THEN** the extract reading surface still displays the extract content
- **AND** the "Open source document" action is disabled with an explanation

### Requirement: Extracts are rateable from the reading surface

The extract reading surface SHALL expose the same scheduling actions the queue offers for an extract, so reading an extract can complete its review.

#### Scenario: Rating an extract

- **WHEN** the user rates an extract from the reading surface
- **THEN** the rating is submitted for that extract
- **AND** the queue reflects the new schedule without a full reload
