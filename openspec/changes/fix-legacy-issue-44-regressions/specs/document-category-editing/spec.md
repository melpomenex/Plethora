## ADDED Requirements

### Requirement: A document's category is editable from Library and document surfaces

The user SHALL be able to view and change (or clear) a document's category from the Library's document details surface and from the document reader's details, using preset chips derived from categories already present on documents plus free-text entry. Clearing SHALL set the category to unset, and edits SHALL persist through the existing document update path.

#### Scenario: Edit from the details popover

- **WHEN** the user opens a document's details popover and changes its category
- **THEN** the change persists and is shown immediately
- **AND** choosing the empty/clear value unsets the category

#### Scenario: Edit from the Library surface

- **WHEN** the user edits a document's category from the Library's details or context action
- **THEN** the document's category updates in place without leaving the Library

### Requirement: Category edits propagate to every consuming surface

After a category edit, all category-derived surfaces — the Library category filter (including its available-values list), queue and schedule category chips, and search filters — SHALL reflect the new value consistently on their next render, without a reload.

#### Scenario: Library filter tracks the edit

- **WHEN** a document's category changes from one value to another
- **THEN** the Library filter's available categories reflect the new value and drop the old one when no document uses it
- **AND** filtering by the new category includes the edited document

### Requirement: Category statistics include documents

The per-category statistics breakdown SHALL aggregate document categories in addition to extract categories, so the Stats view reflects how documents (not only extracts) are categorized.

#### Scenario: Documents appear in category stats

- **WHEN** documents carry categories and category statistics are requested
- **THEN** the breakdown includes counts from documents
