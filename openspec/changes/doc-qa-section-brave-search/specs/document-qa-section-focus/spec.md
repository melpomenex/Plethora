## ADDED Requirements

### Requirement: Autocomplete Trigger for Sections
The system SHALL display an autocomplete popup of chapters and sections for the active document when the user enters the `#` character in the Document Q&A query input textarea.

#### Scenario: User types # to open sections popup
- **WHEN** the user focuses the Document Q&A text input and types `#`
- **THEN** the system SHALL display a list of all detected chapters/sections in the current document in a popup overlay

### Requirement: Section Search Filtering
The system SHALL filter the autocomplete section list as the user continues typing after the `#` character.

#### Scenario: Filter sections by query text
- **WHEN** the user types `#` followed by "Intro" in the input textarea
- **THEN** the system SHALL show only the chapters or sections whose titles contain the query "Intro"

### Requirement: Context Scoping by Section Reference
When a section is selected and referenced in the query, the system SHALL retrieve only that specific section's content and feed it as the sole document context to the chatbot.

#### Scenario: Querying with section focus
- **WHEN** the user selects a section (e.g. "Chapter 1: Getting Started") from the `#` popup and submits the query
- **THEN** the system SHALL extract the content under that section only, format it as the LLM context, and not include the rest of the document content

### Requirement: Fallback Heading and TOC Heuristics
If a document does not have an explicit Table of Contents structure, the system SHALL extract sections using a heuristic parser that scans for markdown headers (`#`, `##`, `###`) and numbered section headings (e.g. `1.1 Introduction`).

#### Scenario: Heading heuristic extraction
- **WHEN** the user opens a markdown document with headings but no explicit TOC
- **THEN** the system SHALL successfully detect the headings as sections and display them in the `#` popup list
