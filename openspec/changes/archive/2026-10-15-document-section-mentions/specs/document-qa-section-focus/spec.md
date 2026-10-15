## MODIFIED Requirements

### Requirement: Autocomplete Trigger for Sections
The system SHALL display a hierarchical autocomplete popup of chapters and sections for the active document when the user enters the `#` character in the Document Q&A query input textarea, grouped by chapter with breadcrumbs and preview.

#### Scenario: User types # to open sections popup
- **WHEN** the user focuses the Document Q&A text input and types `#`
- **THEN** the system SHALL display the hierarchical tree of all detected sections (merged from PDF outline, EPUB TOC, and heading heuristics) in a popup overlay with chapter grouping

#### Scenario: Greeting state for bare #
- **WHEN** the user types `#` with no following query
- **THEN** the popup SHALL show "Sections in this document (N)" header, grouped tree, search hint, and count badge

### Requirement: Section Search Filtering
The system SHALL filter the autocomplete section list via fuzzy search on title and breadcrumb as the user continues typing after the `#` character, ranking prefix matches higher and highlighting matches.

#### Scenario: Filter sections by query text
- **WHEN** the user types `#` followed by "Intro" in the input textarea
- **THEN** the system SHALL show only sections whose title or breadcrumb contains "Intro" case-insensitive, ordered with titles starting with Intro first

### Requirement: Context Scoping by Section Reference with Surrounding Window
When a section is selected and referenced in the query via `#{id}`, the system SHALL retrieve only that specific section's content plus optional surrounding context (previous paragraph, next paragraph, parent heading) and feed it as the focused document context to the chatbot, with token count badge and truncation markers.

#### Scenario: Querying with section focus and neighbors
- **WHEN** the user selects a section "Chapter 1: Getting Started" from the # popup and submits the query
- **THEN** the system SHALL extract content under that section only, include one previous and one next paragraph wrapped with [Previous context] and [Next] labels, format as `Section: breadcrumb > title\n\n[Focused]\ncontent`, estimate tokens (chars/4), show chip badge, and truncate to 70% of maxTokens with [...] separators if over budget

#### Scenario: Multiple section mentions scope to union
- **WHEN** the user mentions two sections `#{id1}` and `#{id2}`
- **THEN** the context SHALL be the concatenation of both focused sections each with its surrounding window and breadcrumb header

#### Scenario: Token saving vs full document
- **WHEN** a 300-page document question targets a 2-page section
- **THEN** the token count of the injected context SHALL be at most 30% of full-document injection

### Requirement: Fallback Heading and TOC Heuristics Merged
If a document does not have an explicit Table of Contents structure, the system SHALL extract sections using a hierarchical heuristic parser that scans for markdown headers (`#`, `##`, `###`) and numbered section headings (e.g., `1.1 Introduction`), and when an outline exists, merge heuristic headings as children under matching outline chapters via fuzzy title match.

#### Scenario: Heading heuristic extraction
- **WHEN** the user opens a markdown document with headings but no explicit TOC
- **THEN** the system SHALL detect headings as tree nodes with level from header depth and display them grouped

#### Scenario: Merge outline and heuristic
- **WHEN** a PDF has outline "Chapter 2" and heuristic finds "2.1 Background" inside
- **THEN** "2.1 Background" SHALL appear as child of "Chapter 2" node
