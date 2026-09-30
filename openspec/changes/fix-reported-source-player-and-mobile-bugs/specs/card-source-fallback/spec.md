## Purpose

Defines what "View source" does on a flashcard when the card has no exact locator, and how each degradation is worded and surfaced. A card generated from a whole document carries only a document id; the user must still reach the document, and the app must not claim the document is gone when it is not.

## ADDED Requirements

### Requirement: A known document is always reachable from a card

When a card carries a resolvable document reference, activating "View source" SHALL open that document. The absence of an exact passage locator SHALL NOT prevent navigation; the document SHALL open at the closest position the system can determine.

#### Scenario: Card generated from a whole document

- **GIVEN** a card was generated from an entire document and carries a document reference but no extract linkage and no stored passage locator
- **WHEN** the user activates "View source"
- **THEN** the source document opens
- **AND** it opens at the document's stored reading position, or at the start of the document when no reading position is stored
- **AND** no error is shown

#### Scenario: Card with a stored passage locator

- **GIVEN** a card carries a stored passage locator
- **WHEN** the user activates "View source"
- **THEN** the document opens positioned at that passage with the passage highlighted, as it does today

#### Scenario: Card with an extract linkage

- **GIVEN** a card is linked to an extract
- **WHEN** the user activates "View source"
- **THEN** the document opens at the position derived from the extract, and the extract's own metadata supplies the context shown beside the button

#### Scenario: Opening source from a scheduled card outside a review session

- **WHEN** "View source" is activated on a card that is not currently being reviewed
- **THEN** the document opens the same way, without a return-to-card affordance being required for the navigation to succeed

### Requirement: Degradation is reported accurately

The system SHALL distinguish a card that has no known document from a card whose known document no longer exists. A message asserting that the original document no longer exists SHALL be shown only when the document row is genuinely absent.

#### Scenario: Document was deleted

- **GIVEN** a card's source document has been deleted
- **WHEN** the user activates "View source"
- **THEN** the system states that the original document no longer exists
- **AND** the card's retained excerpt remains available to the user

#### Scenario: Card has no known document at all

- **GIVEN** a card has neither a document reference, an extract linkage, nor a stored passage locator
- **WHEN** the user activates "View source"
- **THEN** the system states that the card has no source rather than claiming a document was removed
- **AND** no navigation is attempted

#### Scenario: Passage could not be re-located but the document opened

- **GIVEN** a card carries a stored excerpt but the current document content no longer contains it
- **WHEN** the user activates "View source"
- **THEN** the document still opens
- **AND** the system reports that the exact passage could no longer be located, distinguishing this from both success and from a missing document

### Requirement: Source availability is consistent across surfaces

Every surface that offers "View source" SHALL offer it under the same condition, derived from one shared definition of a card having a reachable source.

#### Scenario: Card with only a document reference

- **GIVEN** a card carries only a document reference
- **THEN** the card's source context strip, the card context menu, and the keyboard shortcut all present "View source" as available

#### Scenario: Card with no source at all

- **GIVEN** a card carries no document reference, no extract linkage, and no stored passage locator
- **THEN** no surface presents "View source" as an actionable control

#### Scenario: Same rule on desktop and on a phone

- **WHEN** the same card is inspected on a phone-sized viewport and on a desktop viewport
- **THEN** the availability of "View source" is the same in both

### Requirement: Source resolution never blocks on the network

Resolving a card's source SHALL use only locally stored data, SHALL bound its own work when searching document content, and SHALL NOT make the user wait on a network request.

#### Scenario: Document is large

- **GIVEN** a card carries an excerpt and a very large document
- **WHEN** the user activates "View source"
- **THEN** resolution completes within a bounded amount of work and navigation proceeds
- **AND** the user is not blocked indefinitely if the passage cannot be found

#### Scenario: Offline

- **WHEN** the user activates "View source" with no network connectivity
- **THEN** resolution behaves identically to the online case
