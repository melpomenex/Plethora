## MODIFIED Requirements

### Requirement: Sections context mode

The Flashcard Studio's Context Control panel SHALL support a `sections` mode (alongside `full`, `chapters`, `pages`, `excerpt`, `search`). When `sections` mode is active (set either by making a `#` selection or by choosing the mode directly), the LLM context for generation SHALL be produced by resolving the focused section(s) with `resolveSectionFocusedContext`, which re-resolves section ranges against freshly fetched document text, applies the configured token budget, and includes neighbor context — identical resolution to the document Assistant.

The resolved context SHALL contain the actual body text of the selected section(s). It SHALL NOT resolve to a document's title page, a front-matter table-of-contents entry, or any other occurrence of the section title that is not followed by the section's prose. When the document has a nested outline (e.g. Part > Chapter > Section), every outline entry SHALL be reconciled against the heading-derived section tree by both title and breadcrumb depth, so that a deep outline section resolves to its own body rather than its parent's title block. The document text used to build the section tree SHALL be the same canonical full-body text regardless of whether it was obtained via `get_document` or `extract_document_text`, so a section tree is never built from a short placeholder, legacy EPUB stub, or sparse browser-import text while the full body is available.

#### Scenario: Generation uses only the focused section

- **WHEN** the user has focused section(s) active and sends a generation request
- **THEN** only the resolved text of the focused section(s) (plus neighbor context, within the token budget) is passed to the LLM as document context — not the whole document

#### Scenario: Section range resolved against current document text

- **WHEN** the selected section's stored character range is stale relative to the freshly loaded document text
- **THEN** the system re-resolves the section by structural match and outline-text recovery before generating, falling back to an error if it cannot be resolved

#### Scenario: Resolved section yields the chapter body, not the title page

- **WHEN** a document's title or table of contents repeats a chapter's title verbatim before the chapter's actual body, and the user focuses that chapter
- **THEN** the resolved context contains the chapter's prose body (text that appears after the chapter heading and is not itself another table-of-contents or title-page line), and does not contain the front-matter/table-of-contents occurrence

#### Scenario: Deep-nested outline section resolves on first send

- **WHEN** the focused section is a multi-level outline entry (for example `Part Three > Chapter 11: Darwin's Delay`) and the document's heuristic heading tree assigns differentiated depths to part, chapter, and section headings
- **THEN** the section resolves to its own body range by matching both title and breadcrumb depth, the generation request proceeds on the first send, and the user is not asked to reselect the section

#### Scenario: Section tree built from full document text

- **WHEN** a document's stored content is a short placeholder, a legacy EPUB stub, or sparse browser-import text while the full body is recoverable (by re-extraction for Epub/Markdown/Html, or from the browser import's saved article HTML)
- **THEN** both `get_document` and `extract_document_text` return the recovered full body text, and the section tree is built from that full body so that resolved section ranges point at real prose

#### Scenario: Token budget enforced

- **WHEN** the focused section(s) exceed the model's context token budget
- **THEN** the resolved context is truncated to fit the budget and the user is informed that truncation occurred

### Requirement: Graceful handling of unresolved sections

If a focused section cannot be resolved at generation time, or can only be resolved to a range that yields no body text (an empty section, a mis-resolved table-of-contents entry, or a title-page occurrence), the system SHALL surface a clear, actionable validation message that includes the specific failure reason (the section belongs to a different document, matched multiple headings ambiguously, or had no current document-text range) and SHALL NOT silently fall back to whole-document generation. A section whose resolved range would produce empty or heading-only body SHALL be treated as unresolved and trigger this validation rather than being sent as context.

#### Scenario: Empty section focus in sections mode

- **WHEN** `sections` mode is active but no sections are focused and the user attempts to generate
- **THEN** the system shows a validation message instructing the user to select a section, and does not send a generation request

#### Scenario: Section cannot be resolved

- **WHEN** a focused section cannot be matched in the current document text at generation time
- **THEN** the system reports that the section could not be resolved, includes the failure reason (different document, ambiguous match, or no current text range) in the message, and does not fall back to whole-document generation

#### Scenario: Resolved range with no body is treated as unresolved

- **WHEN** a section's only resolvable range yields a body that is empty or shorter than its own heading line (for example a table-of-contents line immediately followed by another table-of-contents line), and no alternative candidate range yields real body text
- **THEN** the system reports the section as unresolved with that reason, and does not send the empty or heading-only text as the document context

#### Scenario: Ambiguous match reports candidate count

- **WHEN** a focused section title matches multiple current headings and the breadcrumb cannot disambiguate them
- **THEN** the validation message states that the section matched multiple headings, including the count of considered candidates, and does not pick one arbitrarily
