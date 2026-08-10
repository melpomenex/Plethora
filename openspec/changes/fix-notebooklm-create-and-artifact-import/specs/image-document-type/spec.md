## ADDED Requirements

### Requirement: Images are a first-class document file type
The system SHALL support an image file type for documents, distinct from the generic other type, so image documents are identifiable throughout storage, listing, and display.

#### Scenario: Image document is stored with its own type
- **WHEN** an image is added to the library
- **THEN** it is stored with the image file type rather than the generic other type

#### Scenario: Image document is listed with its type
- **WHEN** the library lists an image document
- **THEN** it displays a type indicator distinct from other document types

#### Scenario: Existing documents are unaffected
- **WHEN** the new type is introduced
- **THEN** documents already stored with other file types retain their existing type and behaviour

### Requirement: Image documents open in a viewer
The system SHALL open image documents in a viewer that displays the image, rather than falling through to an unsupported or empty state.

#### Scenario: Opening an image document
- **WHEN** the user opens an image document from the library
- **THEN** the image is displayed

#### Scenario: Image cannot be rendered
- **WHEN** an image document's file is missing or cannot be decoded
- **THEN** the viewer shows an explanatory message rather than an empty or broken view

### Requirement: Image documents participate in the queue
The system SHALL make image documents eligible for the queue on the same terms as other document types.

#### Scenario: Image document enters the queue
- **WHEN** an image document is in the library and meets the queue's normal criteria
- **THEN** it appears in the queue and can be reviewed

#### Scenario: Queue routing opens the image viewer
- **WHEN** the user reaches an image document through the queue
- **THEN** it opens in the image viewer rather than an unrelated document surface

### Requirement: Unrecognized file types remain supported
The system SHALL continue to accept and display documents whose file type is not specifically handled, without regression from the introduction of the image type.

#### Scenario: Other-typed document still opens
- **WHEN** the user opens a document stored with the generic other type
- **THEN** it behaves as it did before the image type existed
