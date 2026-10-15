## ADDED Requirements

### Requirement: Categories can be managed (add, rename, delete) like tags
The system SHALL provide category management with UX consistent with the existing tag-management interaction (`src/components/media/TagManagementView.tsx` / `src/stores/tagsStore.ts` for RSS tags; `ItemTagEditor.tsx` for per-item tags). The system SHALL support at minimum: creating a category, renaming/editing a category, and deleting a category. The current state has a `categories` table (`src-tauri/migrations/001_initial.sql:31–42`) and stub commands (`src-tauri/src/commands/category.rs`) but NO management UI; the implementation SHALL either implement management on the existing model or fix/expose hidden functionality — it SHALL NOT duplicate an existing management surface.

#### Scenario: Create a category
- **WHEN** the user creates a category (e.g. "Work") via the management UI
- **THEN** the category SHALL appear in the management list and SHALL be assignable to documents/extracts

#### Scenario: Rename a category
- **WHEN** the user renames a category
- **THEN** all documents/extracts assigned that category SHALL reflect the new name, and the category list SHALL update

#### Scenario: Delete a category
- **WHEN** the user deletes a category
- **THEN** the category SHALL be removed from the list and its items SHALL be handled according to the data-integrity rule below (SHALL NOT be orphaned or silently lost)

### Requirement: Category semantics preserve the existing data model
Categories are currently stored as free-form string names on documents/extracts (the `category` column), not relational FK IDs to the orphaned `categories` table. The management implementation SHALL preserve this name-identity semantics (or define and implement the migration to a relational model deliberately). The system SHALL NOT conflate categories with collections (the data-partitioning layer).

#### Scenario: Assignment uses the existing field
- **WHEN** the user assigns a category to a document/extract
- **THEN** the assignment SHALL use the existing category field/mechanism used by `ItemCategoryEditor.tsx` and the per-item category filter, and SHALL remain compatible with `get_category_stats` and `get_categories_by_collection`

### Requirement: Rename/delete do not orphan or lose data
Rename SHALL propagate to every item carrying the category (documents and extracts). Delete SHALL either (a) remove the category from all items (leaving them uncategorized) or (b) be disallowed while items reference it, with a clear prompt — but SHALL NOT orphan items or corrupt references. The exact choice SHALL be specified in the implementation and SHALL avoid accidental data loss.

#### Scenario: Rename propagates across items
- **WHEN** a category is renamed and 12 documents and 40 extracts carry the old name
- **THEN** all 52 items SHALL show the new category name

#### Scenario: Delete clears assignments safely
- **WHEN** a category is deleted
- **THEN** the items that carried it SHALL become uncategorized (or the deletion SHALL be blocked with a clear confirmation), and no item SHALL be deleted or left referencing a non-existent category

### Requirement: Management UI is consistent with tag management
The category management UI SHALL reuse existing settings/list patterns (create/rename/delete affordances consistent with `TagManagementView`), support keyboard navigation, work on mobile and desktop, and use theme tokens. Assigning categories to content SHALL continue to work through the existing per-item editor.

#### Scenario: Consistent controls and accessibility
- **WHEN** the user opens the category management UI
- **THEN** create/rename/delete controls SHALL behave like the tag-management controls, be keyboard-accessible, and be theme-consistent