## ADDED Requirements

### Requirement: Document section mention outline extraction
Section mention resolution with `#` in the document assistant SHALL bypass 0-length Table of Contents entries and correctly resolve section heading text in EPUB and PDF documents.

#### Scenario: User references a section heading in Table of Contents
- **WHEN** the user types `#{<section_title>}` referencing a section title that appears in the Table of Contents of a document
- **THEN** section resolution ignores the 0-prose TOC entry and matches the actual body heading range containing chapter prose text
