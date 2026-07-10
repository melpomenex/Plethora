## ADDED Requirements

### Requirement: Unified Hierarchical Section Index
The system SHALL build a unified tree of sections from all available sources: PDF outline, EPUB navigation TOC, and markdown/numbered heading heuristics, producing parent/child hierarchy with breadcrumbs and preview.

#### Scenario: PDF with outline produces tree
- **WHEN** a PDF document has an outline via `pdfDoc.getOutline()` with 3 chapters each containing sub-items
- **THEN** the section index SHALL contain 3 level-1 nodes with children at level 2+, each with `page`, `breadcrumb`, and `preview`

#### Scenario: EPUB with TOC produces tree
- **WHEN** an EPUB document exposes `book.loaded.navigation.toc` with nested chapters
- **THEN** the index SHALL map TOC nesting to `level` and preserve `href` for navigation, with correct `parentId` and `breadcrumb` chain

#### Scenario: Markdown document with headings produces tree
- **WHEN** a markdown document contains `# Chapter 1`, `## 1.1 Intro`, `### Details`
- **THEN** the index SHALL assign level 1,2,3 respectively and build `breadcrumb ["Chapter 1"]` for the `1.1 Intro` child

#### Scenario: Fallback heuristic when no TOC
- **WHEN** a document has no PDF outline or EPUB TOC but has numbered headings like `1. Introduction` and `1.1 Background`
- **THEN** the heuristic parser SHALL extract them with level derived from numbering depth and include `preview` of first 80 characters

### Requirement: Section Node Metadata Completeness
Each section node SHALL include stable id, title, level, breadcrumb, preview, content boundaries, and parent reference.

#### Scenario: Node metadata validation
- **WHEN** the section index is built for a document
- **THEN** every node SHALL have non-empty `id`, `title`, `level >=1`, `breadcrumb` array, `preview` string length <=100, `content` non-empty, and `parentId` null for roots

#### Scenario: Duplicate titles disambiguated via breadcrumb
- **WHEN** two sections share title "Introduction"
- **THEN** their breadcrumbs SHALL differ (e.g., ["Chapter 1"] vs ["Chapter 2"]) and their `id` SHALL differ

### Requirement: Section Index Caching
The section index SHALL be cached per document by content hash to avoid recomputation on keystrokes.

#### Scenario: Cache hit avoids re-parse
- **WHEN** the same documentId is opened twice with unchanged content and outline
- **THEN** the second build SHALL return the cached tree within 10ms without re-parsing lines

#### Scenario: Cache invalidation on content change
- **WHEN** document content changes (hash differs)
- **THEN** a new tree SHALL be built and cache updated
