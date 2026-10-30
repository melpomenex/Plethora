## Purpose

Define one shared `#` section picker for every document-grounded composer (Assistant desktop and mobile, Document Q&A, and Flashcard Studio), so a user can browse the active document's outline, see what each section costs in tokens, and narrow the model context to exactly the section they choose — with the picker always visible regardless of which scroll containers the composer lives in.

## ADDED Requirements

### Requirement: `#` opens the active document's section picker

With exactly one document targeted by the composer, typing `#` SHALL open a section picker listing that document's sections. When no document is targeted, or the composer is in a non-document context (general chat, web page, video), the picker SHALL open with an explicit explanation of why sections are unavailable instead of remaining closed or rendering an empty list. When the section index is still being loaded the picker SHALL show a loading state, and when the document has no extractable text it SHALL show an actionable empty state.

#### Scenario: Typing `#` with a document targeted

- **WHEN** a document is the active composer context and the user types `#` in the input
- **THEN** the section picker opens above the input and lists sections of that document

#### Scenario: No document targeted

- **WHEN** the user types `#` while no document is targeted
- **THEN** the picker opens with an explanation that `#` references sections of an open document

#### Scenario: Index still loading

- **WHEN** the document's text or outline is still being loaded and no sections are available yet
- **THEN** the picker shows a loading indicator instead of "no sections available"

#### Scenario: Document has no sections

- **WHEN** the active document has no extractable text or outline
- **THEN** the picker explains that no sections can be offered for this document

### Requirement: Picker is rendered in a non-clipping floating layer

The picker MUST be presented in a floating layer that is not visually clipped by any ancestor scroll or overflow container of the composer. It SHALL be anchored above the text input, SHALL remain within the bounds of the host panel or sheet and the visible viewport, and SHALL scroll its own result list rather than pushing the composer or being cut off. If there is insufficient room above the input, the picker MAY open below it. The picker SHALL stay anchored and visible when the composer, panel, sheet, or window is resized and when an ancestor scrolls.

#### Scenario: Composer has a scrolling container

- **WHEN** the composer is inside a container with `overflow-y: auto` and the user types `#`
- **THEN** the picker is fully visible above the input and is not clipped by that container

#### Scenario: Narrow or short host

- **WHEN** the assistant panel is narrow or the viewport is short
- **THEN** the picker is bounded to the available width and height, keeps its own list scrollable, and remains operable

#### Scenario: Layout changes while open

- **WHEN** the composer grows, the panel is resized, or the hosting sheet changes detent while the picker is open
- **THEN** the picker remains anchored to the input and stays fully visible

### Requirement: Bare `#` presents an expandable document outline

With no query text after `#`, the picker SHALL present the document outline rather than a flat list of every nested heading: top-level sections SHALL be shown first, and a section with children SHALL be expandable to reveal its child sections in place and collapsible to hide them. Each row SHALL show the section title, its token-cost badge when known, and its breadcrumb or parent path for nested sections. The header SHALL identify the document and report the number of top-level sections and total sections. Typing after `#` SHALL switch to ranked flat search results across all depths, showing matched breadcrumbs.

#### Scenario: Browsing a book outline

- **WHEN** the picker opens with a bare `#` on a book with parts, chapters, and subsections
- **THEN** only top-level sections are listed initially and expanding a part reveals its chapters in place

#### Scenario: Collapsing a branch

- **WHEN** an expanded section's disclosure is activated again
- **THEN** its child rows are hidden and the remaining outline is unchanged

#### Scenario: Filtering by title

- **WHEN** the user types `#darw` after `#`
- **THEN** the picker shows only matching sections from any depth, with their breadcrumbs

#### Scenario: Filtering has no matches

- **WHEN** the query matches no section
- **THEN** the picker shows a no-results state with a way to clear the query

### Requirement: Selecting a section states and applies its context scope

Selecting a section SHALL insert a stable section token at the caret, keep focus in the input, and record the section as the active scope. The picker SHALL make the consequence explicit: the footer SHALL state that only the chosen section is sent to the model, and each row's token badge SHALL communicate the size of that section. When more than one section is selected, every selected section SHALL be represented as a removable card with its own token cost, and the combined scope SHALL be summarized before sending. Deleting a section token SHALL remove that section from the active scope.

#### Scenario: Selecting one section

- **WHEN** the user selects a section from the picker
- **THEN** a `#{…}` token is inserted at the caret, focus returns to the input, and the section appears as a removable card showing its token cost

#### Scenario: Selecting multiple sections

- **WHEN** the user opens the picker again and selects a second section
- **THEN** both sections remain in scope and both cards show their individual token costs

#### Scenario: Section scope is honored on send

- **WHEN** the user sends a question or card-creation request with one or more selected sections
- **THEN** the model context contains those sections and excludes the rest of the document, as required by the existing section-context contracts

#### Scenario: Removing a selected section

- **WHEN** the user deletes the section token or removes its card
- **THEN** that section is no longer part of the active scope

### Requirement: Keyboard and assistive-technology operation

While the picker is open and focus remains in the text input, the keyboard SHALL be able to move through the visible rows, expand and collapse branches, select a section, and dismiss the picker. Moving the active row SHALL scroll that row into view. The picker SHALL expose listbox/combobox semantics with an active-descendant relationship, and each option SHALL expose its title, breadcrumb, and token cost to assistive technology. No selection or disclosure action SHALL be pointer-only.

#### Scenario: Keyboard traversal past the visible window

- **WHEN** the user presses the down arrow repeatedly beyond the rows currently visible in the list
- **THEN** the active row advances and the list scrolls to keep it visible

#### Scenario: Keyboard expand and collapse

- **WHEN** the active row has child sections and the user presses the expand key
- **THEN** the branch expands, and pressing the collapse key hides it again

#### Scenario: Escape dismisses the picker

- **WHEN** the picker is open and the user presses Escape
- **THEN** the picker closes and focus remains in the text input with the draft unchanged

### Requirement: One picker across all document-grounded surfaces

The Assistant (desktop and mobile presentation), Document Q&A, and Flashcard Studio SHALL use the same picker component and outline model, so section titles, breadcrumbs, token badges, filtering, keyboard behavior, and scope messaging are consistent. The picker SHALL close without changing the draft when its host surface closes or switches context.

#### Scenario: Assistant and Document Q&A agree

- **WHEN** the same document is opened in the Assistant and in Document Q&A
- **THEN** both pickers list the same sections with the same breadcrumbs and token estimates

#### Scenario: Studio parity

- **WHEN** a document is selected in Flashcard Studio and the user types `#`
- **THEN** the picker opens with the same outline and scope messaging used by the Assistant

#### Scenario: Pasting a hash arms the index

- **WHEN** `#` arrives through paste, dictation insertion, or restored draft text rather than a focus-plus-keypress sequence
- **THEN** the section index is still loaded and the picker can present the document's sections
