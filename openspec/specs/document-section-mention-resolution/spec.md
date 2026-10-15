# document-section-mention-resolution Specification

## Purpose
Users encountered several usability, filtering, and functional bugs in Issue #44: "Due All" filtering omitted learning items/extracts, NotebookLM displayed a connected status without rendering notebooks, the Knowledge Universe graph was off-center, Scroll Mode became stuck on an inescapable "Nothing to Read" state when filters were set to zero, "New Only" showed read/overdue documents, section mentions with # failed in document Q&A for EPUB Table.

## Requirements

### Requirement: Document section mention outline extraction
Section mention resolution with `#` in the document assistant SHALL bypass 0-length Table of Contents entries and correctly resolve section heading text in EPUB and PDF documents.

#### Scenario: User references a section heading in Table of Contents
- **WHEN** the user types `#{<section_title>}` referencing a section title that appears in the Table of Contents of a document
- **THEN** section resolution ignores the 0-prose TOC entry and matches the actual body heading range containing chapter prose text
