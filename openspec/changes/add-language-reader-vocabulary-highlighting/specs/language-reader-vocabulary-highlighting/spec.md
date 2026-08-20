# Spec: language-reader-vocabulary-highlighting

## ADDED Requirements

### Requirement: State-driven annotation

When Language Mode is active and token analysis/state is available, supported readers SHALL annotate tokens according to profile-scoped New/Encountered, Learning, Familiar, Known, and Ignored state. Known SHALL normally render without a highlight; state labels SHALL remain available to accessibility and inspection surfaces.

#### Scenario: Spanish reading states
- **WHEN** a Spanish EPUB contains New, Learning, Familiar, Known, and Ignored tokens
- **THEN** the reader applies the configured treatment to each state and leaves Known visually quiet by default

### Requirement: Mode and settings

Users SHALL be able to choose Off, Minimal, or Full vocabulary annotation per profile, with defaults that do not affect ordinary reading. Settings SHALL be persisted per profile and adapt to theme, contrast, reduced motion, and e-ink.

#### Scenario: Language Mode off
- **WHEN** Language Mode is inactive
- **THEN** no vocabulary spans, processing work, or language visual treatment is added to the reader

### Requirement: Accessible visual semantics

State treatment MUST NOT rely on color alone. Theme tokens SHALL maintain contrast, and semantic state SHALL be exposed through accessible labels/inspection without making every token noisy to screen readers by default.

#### Scenario: High-contrast theme
- **WHEN** the user uses a high-contrast theme
- **THEN** New/Learning/Familiar/Ignored remain distinguishable through compliant tokens or patterns and text selection remains usable

### Requirement: Reader coverage and confidence

The layer SHALL support EPUB, Markdown/text, HTML/article, Queue reader, PDF reflow, and fixed PDF only when canonical anchors are reliable. Unsupported or low-confidence spans SHALL be left unstyled without breaking the reader.

#### Scenario: Fixed PDF ambiguity
- **WHEN** fixed-PDF text cannot be mapped confidently to lexical spans
- **THEN** the PDF opens normally and no incorrect vocabulary highlight is drawn

### Requirement: Coexistence with existing layers

Vocabulary annotation SHALL not overwrite source content or interfere with user highlights/extracts, search results, text selection, TTS spoken-word highlighting, Queue state, or reading position. Precedence SHALL be deterministic: selection and active TTS emphasis remain visibly actionable over background vocabulary state.

#### Scenario: TTS and Learning word
- **WHEN** TTS speaks a Learning word that also has a user highlight
- **THEN** all semantics remain available with the defined combined style and the active word is identifiable

### Requirement: Incremental performance

The reader SHALL avoid rescanning/re-rendering the full document on every state change. Analysis/indexing, visible annotation, and state-map refresh SHALL be lazy/incremental, bounded for large EPUBs/PDFs/transcripts, and safe for mobile WebViews/e-ink redraw budgets.

#### Scenario: Mark one word Known
- **WHEN** the user marks one lemma Known in a long novel
- **THEN** only visible/affected occurrences update and the reader remains responsive without rebuilding the entire document

### Requirement: Interaction neutrality

Hover, tap, long-press, double-click, keyboard selection, and screen-reader navigation SHALL continue to reach the existing selection actions. Annotation rendering MUST NOT trigger Queue/review advancement or alter reader position.

#### Scenario: Queue annotation
- **WHEN** a Queue item renders vocabulary state and the user selects a word
- **THEN** normal selection/Dictionary Peek behavior remains available and the Queue item is not completed or advanced
