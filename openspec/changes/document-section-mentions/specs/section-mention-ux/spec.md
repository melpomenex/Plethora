## ADDED Requirements

### Requirement: Tree-aware # Autocomplete Trigger
The system SHALL show a hierarchical section popup when the user types `#` in Document Q&A or Assistant inputs tied to a document.

#### Scenario: Bare # shows greeting and tree
- **WHEN** the user types `#` with no query after it in the Q&A textarea
- **THEN** the popup SHALL open showing header "Sections in this document (N)", group headers per chapter, and up to 8 top-level nodes with children collapsed

#### Scenario: # with query filters via fuzzy search
- **WHEN** the user types `#backg` after `#`
- **THEN** the list SHALL filter to nodes whose title or breadcrumb contains "backg" case-insensitive, ranked with prefix matches first, and highlight the matched substring

#### Scenario: Row shows hierarchy context
- **WHEN** a section row is rendered
- **THEN** it SHALL display indent proportional to level, breadcrumb trail in muted text, page number if available right-aligned, and 80-char preview snippet below title

### Requirement: Keyboard Navigation and Selection
The popup SHALL support full keyboard navigation for accessibility and power users.

#### Scenario: Arrow navigation
- **WHEN** the popup is open and user presses ArrowDown
- **THEN** selection index moves down, wrapping at ends, and focused row scrolls into view

#### Scenario: Expand collapse via Tab and Arrow keys
- **WHEN** the focused row has children and user presses Tab or ArrowRight
- **THEN** children expand; on ArrowLeft they collapse

#### Scenario: Enter selects section
- **WHEN** user presses Enter while a section is focused
- **THEN** the system inserts token `#{sectionId}` into the input and closes popup, showing a chip with breadcrumb > title

#### Scenario: Escape dismisses
- **WHEN** user presses Escape
- **THEN** popup closes and input retains typed text without insertion

### Requirement: Selected Section Chip Rendering
Selected sections SHALL appear as removable chips with breadcrumb and token count badge.

#### Scenario: Chip shows breadcrumb and tokens
- **WHEN** user selects "2.1 Background" under Chapter 2
- **THEN** a chip SHALL render as "Chapter 2 > 2.1 Background (320 tokens)" with X to remove

#### Scenario: Chip removal clears context
- **WHEN** user clicks X on a chip
- **THEN** the associated `#{id}` token is removed from rawInput and focus returns to textarea

### Requirement: Virtualized Performance for Large Documents
The popup SHALL remain performant for documents with 500+ sections.

#### Scenario: Large document scroll
- **WHEN** a 60-chapter EPUB with 800 headings opens #
- **THEN** the popup SHALL virtualize rows (max 200px height, overscan 10) and filter within <100ms
