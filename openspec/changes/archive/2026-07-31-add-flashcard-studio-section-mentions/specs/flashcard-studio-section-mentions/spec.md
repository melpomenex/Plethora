## ADDED Requirements

### Requirement: Section mention trigger in Flashcard Studio chat input

When a document is selected in the AI Flashcard Studio, the system SHALL allow the user to trigger a section-mention menu by typing `#` in the chat instruction input, surfacing the selected document's section tree (markdown headings plus PDF/EPUB outline entries) for selection. The interaction SHALL reuse the same `SectionMentionPopup` component and section-resolution machinery used by the document Assistant, so section ranges, token estimates, and breadcrumbs are consistent across the two surfaces. When no document is selected, the `#` trigger SHALL do nothing (no popup).

#### Scenario: Triggering the section menu with a document selected

- **WHEN** a document is selected in the Flashcard Studio and the user types `#` in the chat instruction input
- **THEN** the system opens the `SectionMentionPopup` filtered to the selected document's sections, each showing its title, breadcrumb, and token-cost badge

#### Scenario: No document selected

- **WHEN** no document is selected and the user types `#` in the chat instruction input
- **THEN** the system does not open any section popup

#### Scenario: Typing filters the section list

- **WHEN** the popup is open and the user continues typing after `#`
- **THEN** the popup filters sections by fuzzy match against the typed query, consistent with the Assistant's behavior

### Requirement: Selecting a section focuses generation context

When the user selects a section from the popup, the system SHALL insert a `#{title}` token into the chat input and record the selected `SectionNode`(s) as the active section focus, which sets the context mode to `sections`. The user SHALL be able to select multiple sections, each appended to the active focus.

#### Scenario: Selecting a single section

- **WHEN** the user picks a section from the popup
- **THEN** a `#{sectionTitle}` token is inserted at the caret in the chat input and that section becomes the focused section for generation

#### Scenario: Selecting multiple sections

- **WHEN** the user triggers the popup again and selects an additional section
- **THEN** the additional `#{sectionTitle}` token is appended and the new section is added to the active section focus alongside the first

#### Scenario: Removing a section mention

- **WHEN** the user deletes a `#{title}` token from the chat input
- **THEN** the corresponding section is removed from the active section focus, and if no section tokens remain the focus is cleared

### Requirement: Sections context mode

The Flashcard Studio's Context Control panel SHALL support a `sections` mode (alongside `full`, `chapters`, `pages`, `excerpt`, `search`). When `sections` mode is active (set either by making a `#` selection or by choosing the mode directly), the LLM context for generation SHALL be produced by resolving the focused section(s) with `resolveSectionFocusedContext`, which re-resolves section ranges against freshly fetched document text, applies the configured token budget, and includes neighbor context — identical resolution to the document Assistant.

#### Scenario: Generation uses only the focused section

- **WHEN** the user has focused section(s) active and sends a generation request
- **THEN** only the resolved text of the focused section(s) (plus neighbor context, within the token budget) is passed to the LLM as document context — not the whole document

#### Scenario: Section range resolved against current document text

- **WHEN** the selected section's stored character range is stale relative to the freshly loaded document text
- **THEN** the system re-resolves the section by structural match and outline-text recovery before generating, falling back to an error if it cannot be resolved

#### Scenario: Token budget enforced

- **WHEN** the focused section(s) exceed the model's context token budget
- **THEN** the resolved context is truncated to fit the budget and the user is informed that truncation occurred

### Requirement: Section focus reflected in context summary

The Context Control panel summary and, where present, the context banner SHALL reflect the active section focus: the section labels and an estimated token count, consistent with the Assistant's "Focused: …" affordance. Selecting sections SHALL update the token estimate shown in the panel and the cost estimator in real time.

#### Scenario: Summary shows focused sections and tokens

- **WHEN** one or more sections are focused
- **THEN** the context control summary displays the section label(s) and the estimated token count for the resolved context

#### Scenario: Cost estimator updates with section focus

- **WHEN** the focused section(s) change
- **THEN** the cost estimator below the input recomputes its estimate using the resolved section context

### Requirement: Generation descriptor and provenance

When generating from focused section(s), the system SHALL emit a context-descriptor system message naming the document and the focused section label(s) (e.g. `Use the document titled "X", focusing on: <section labels>`), and SHALL attach a `sourceContext` (document id, section ids, content hash) to the resulting assistant message and/or generated cards so the section provenance of generated cards is preserved, mirroring the Assistant.

#### Scenario: Descriptor names the focused sections

- **WHEN** the user generates cards with section(s) focused
- **THEN** the context-descriptor system message includes the document title and the focused section label(s)

#### Scenario: Source context recorded for provenance

- **WHEN** cards are generated from focused section(s)
- **THEN** the resulting message/cards carry a `sourceContext` referencing the document id, the focused section ids, and the document content hash

### Requirement: Graceful handling of unresolved sections

If a focused section cannot be resolved at generation time (e.g. the document text changed and no structural match is found, or the selection is empty), the system SHALL surface a clear, actionable validation message and SHALL NOT silently fall back to whole-document generation.

#### Scenario: Empty section focus in sections mode

- **WHEN** `sections` mode is active but no sections are focused and the user attempts to generate
- **THEN** the system shows a validation message instructing the user to select a section, and does not send a generation request

#### Scenario: Section cannot be resolved

- **WHEN** a focused section cannot be matched in the current document text at generation time
- **THEN** the system reports that the section could not be resolved and does not fall back to whole-document generation
