## ADDED Requirements

### Requirement: Persisted item tag presentations are editable
Every management surface that presents the persisted tags of a document, extract, or learning item SHALL provide an add-tag action and an explicit remove action without requiring navigation to a different primary surface. Full detail surfaces SHALL expose the controls inline; compact rows and cards MAY open a focused popover or editor from the tag presentation.

#### Scenario: User encounters tags on a full detail surface
- **WHEN** a document, extract, or learning item's persisted tags are shown in an expanded row, inspector, details panel, preview panel, or review detail view
- **THEN** the same surface exposes controls to add a tag and remove each existing tag

#### Scenario: User encounters tags on a compact item surface
- **WHEN** persisted tags are shown in a compact card, table row, list row, or graph selection where inline controls would compromise scan density
- **THEN** the tag presentation exposes a keyboard- and pointer-operable edit affordance that opens add and remove controls for that item

#### Scenario: Tag-bearing surface inventory is audited
- **WHEN** the implementation inventory is reviewed across Documents, Queue/Review Queue, Schedule, extract and learning-card management, and graph/detail surfaces
- **THEN** every persisted document, extract, or learning-item tag presentation either uses the shared editor, opens it, or is documented as an allowed non-management exception

### Requirement: Users can add valid tags consistently
The shared tag editor SHALL accept a trimmed, non-empty freeform tag and persist it to the target item. Tag identity for duplicate prevention SHALL be compared case-insensitively, while the entered display casing SHALL be preserved for a new tag.

#### Scenario: Add a new tag
- **WHEN** the user enters a tag that is not already assigned and confirms with Enter or the add control
- **THEN** the tag appears immediately, is persisted to the correct document, extract, or learning item, and the input is cleared

#### Scenario: Reject empty or duplicate input
- **WHEN** the user submits whitespace-only text or a case-insensitive duplicate of an assigned tag
- **THEN** no mutation is sent and no duplicate tag is rendered

### Requirement: Users can remove tags deliberately
Each assigned tag in an editable tag presentation SHALL have a separately labeled remove control. Activating the tag body for browsing or filtering SHALL NOT remove the tag.

#### Scenario: Remove an assigned tag
- **WHEN** the user activates the remove control for a tag
- **THEN** only that tag is removed from the item and the updated tag list is persisted

#### Scenario: Avoid accidental removal from compact chips
- **WHEN** the user activates a compact tag chip or the editor trigger rather than its explicit remove control
- **THEN** the system opens the applicable browse/edit behavior without deleting the tag

### Requirement: Tag mutations recover from errors and synchronize mounted surfaces
Tag add and remove operations SHALL provide optimistic feedback, prevent conflicting submissions for the same item while a mutation is pending, restore the prior tag list if persistence fails, and reconcile all mounted views of that item after success without a full application reload.

#### Scenario: Tag persistence succeeds
- **WHEN** a tag mutation is accepted by the backend
- **THEN** mounted Queue, Schedule, Documents, review/card-management, and graph/detail consumers of that item converge on the persisted tag list

#### Scenario: Tag persistence fails
- **WHEN** the backend rejects or fails a tag add or removal
- **THEN** the initiating surface restores the last persisted tag list, re-enables editing, and presents localized error feedback

#### Scenario: User submits while a tag mutation is pending
- **WHEN** a tag update for the item is already in flight
- **THEN** controls for that item's tag editor expose a busy state and do not issue an overlapping update based on stale tags

### Requirement: Tag editing is accessible and responsive
The shared editor SHALL be fully operable by keyboard and pointer, expose localized accessible names and busy/error state, retain visible focus, and fit the host surface without causing page-level overflow. Remove controls SHALL meet the host surface's touch-target rules or provide equivalent spacing.

#### Scenario: Keyboard-only tag edit
- **WHEN** a keyboard user focuses a tag presentation
- **THEN** the user can open the editor, add a tag, focus each remove control, remove a tag, and close the editor without pointer input

#### Scenario: Tag editor opens in a narrow pane
- **WHEN** an item tag editor is invoked in a mobile or narrow split-pane layout
- **THEN** chips wrap or scroll within the editor, the input and actions remain reachable, and the application does not gain horizontal overflow

### Requirement: Non-management tag contexts preserve their domain behavior
The cross-surface editor SHALL NOT convert non-persisted source metadata, destructive confirmation summaries, print/export output, or RSS relational tags into document/extract/learning-item mutations. Existing create/edit/import forms that already provide add and remove controls SHALL remain editable but need not use the compact presentation.

#### Scenario: Tags are informational or use another data model
- **WHEN** tags are rendered in an allowed non-management context or belong to an RSS article
- **THEN** the surface preserves its informational or RSS-specific behavior and does not invoke the shared document/extract/learning-item mutation path

