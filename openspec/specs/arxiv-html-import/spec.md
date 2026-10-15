# arxiv-html-import Specification

## Purpose
The ArXiv importer currently only exposes 10 categories in its sidebar (all CS/stat/math focused), while ArXiv hosts papers across ~155 categories spanning physics, math, computer science, quantitative biology, quantitative finance, economics, electrical engineering, and statistics. Users in physics, biology, finance, and other fields cannot browse by their relevant categories — they can only search by keyword, which is a poor substitute for topical browsing.

## Requirements

### Requirement: HTML import option in ArXiv dialog
The ArXiv import dialog SHALL provide a way for users to choose between PDF and HTML format when importing a paper. The default format SHALL be PDF to preserve existing behavior.

#### Scenario: User imports a paper as HTML
- **WHEN** user selects the HTML format option and clicks "Import to Library" on a paper that has an ArXiv HTML version
- **THEN** the system downloads the HTML from `https://arxiv.org/html/<id>` and imports it as an HTML document

#### Scenario: User imports a paper as PDF (default)
- **WHEN** user clicks "Import to Library" without changing the format option
- **THEN** the system downloads the PDF (existing behavior)

### Requirement: HTML import fallback for PDF-only papers
When a user attempts to import a paper as HTML but the paper does not have an HTML version available, the system SHALL show an error message suggesting the user try PDF instead.

#### Scenario: HTML not available for a paper
- **WHEN** user selects HTML format and imports a paper that only has PDF on ArXiv
- **THEN** the system displays an error message indicating HTML is not available for this paper and suggests using the PDF option

### Requirement: HTML URL helper
The system SHALL export a `getArxivHtmlUrl(paperId: string): string` function that returns the ArXiv HTML URL for a given paper ID.

#### Scenario: Generate HTML URL
- **WHEN** `getArxivHtmlUrl("2301.07041")` is called
- **THEN** it returns `"https://arxiv.org/html/2301.07041"`
