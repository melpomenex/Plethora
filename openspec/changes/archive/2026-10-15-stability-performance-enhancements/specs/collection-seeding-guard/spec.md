## ADDED Requirements

### Requirement: Default collection seeding runs once
Default collection seeding SHALL execute strictly once — only when the `collections` table is empty. Subsequent app starts or migrations SHALL NOT create additional default collections.

#### Scenario: First launch seeds default collection
- **WHEN** the app launches for the first time with an empty collections table
- **THEN** exactly one default collection SHALL be created

#### Scenario: Subsequent launch does not re-seed
- **WHEN** the app launches with existing collections in the table
- **THEN** no new default collections SHALL be created

### Requirement: No auto-collection on import or tag assignment
The system SHALL NOT automatically create collections as a side effect of document import or tag assignment. Collections SHALL only be created through explicit user action.

#### Scenario: Document import without collection creation
- **WHEN** a document is imported without specifying a collection
- **THEN** the document SHALL be added to the active/default collection and no new collection SHALL be created

#### Scenario: Tag assignment without collection creation
- **WHEN** a tag is assigned to a document
- **THEN** no new collection SHALL be created as a side effect
