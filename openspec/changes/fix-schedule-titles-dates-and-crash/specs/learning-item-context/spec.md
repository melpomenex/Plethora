## ADDED Requirements

### Requirement: Learning-item schedule entries SHALL have useful source context

Every learning-item entry shown in the schedule SHALL have a non-empty user-facing title that identifies its parent document when a valid parent title exists. The title SHALL NOT fall back to “Untitled Document,” “Unknown Document,” or an empty string for a learning item.

#### Scenario: Learning item has a titled parent document

- **WHEN** a learning-item queue entry has a non-blank parent document title
- **THEN** schedule cards, tables, expanded rows, and mobile rows display that document title as the source context

#### Scenario: Learning item has no usable parent title

- **WHEN** a learning-item queue entry has no parent document, or its parent title is blank or a generic unknown/untitled sentinel
- **THEN** the schedule displays a bounded preview of the question or cloze prompt prefixed as a flashcard/learning item

#### Scenario: Learning item has no usable title or prompt

- **WHEN** a learning-item queue entry has neither a usable parent title nor question/cloze content
- **THEN** the schedule displays a localized generic learning-item label and does not display “Untitled Document”

### Requirement: Title resolution SHALL not change item actions

Resolving a display title SHALL preserve the learning item’s ID, document ID, and item type so opening the source document and starting review continue to target the original records.

#### Scenario: User opens a titled learning-item schedule entry

- **WHEN** the user selects or activates a learning-item schedule row
- **THEN** the existing review or document-opening action receives the original learning-item/document identifiers
