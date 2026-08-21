## ADDED Requirements

### Requirement: Structured privacy-preserving application context collection
The system SHALL provide a centralized hook (`useHelpAppContext`) that extracts a minimal, privacy-sanitized snapshot of current application state: `activeView`, `documentFormat` (e.g., `pdf`, `epub`, `html`), `platform` (`desktop`, `android`, `ios`), `ttsActive` (boolean), `ttsProvider`, `activeAlgorithm` (`fsrs`, `sm18`, `sm20`), `activeTheme`, and `einkActive` (boolean). Full document text, personal notes, and browsing histories SHALL NOT be included in this context.

#### Scenario: Privacy-safe state extraction
- **WHEN** `useHelpAppContext` captures state during reading of a private document
- **THEN** only structural metadata (e.g. format `pdf`, viewer zoom `1.25`, TTS `inactive`) is collected, and document body text is omitted.

### Requirement: Contextual "Why?" explainability actions
The application SHALL surface contextual "Why?" / "Explain this" trigger actions in key UI locations:
1. **Reading Queue items**: "Why is this item due today?" / "Why did this item return?"
2. **Review Arena / Grading**: "Why is this interval 21 days?" / "Why did SM-20 select this priority?"
3. **Reader & TTS**: "Why did TTS pause?" / "Why isn't auto-scroll moving?"
4. **Settings panels**: "Why is this setting recommended?"

#### Scenario: Explaining queue scheduling interval
- **WHEN** a user right-clicks a queue item and selects "Why is this scheduled for today?"
- **THEN** the explainability subsystem resolves the item's stability, difficulty, last review timestamp, and active algorithm formula, returning a clear grounded explanation with links to the scheduling algorithm documentation.

#### Scenario: Explaining TTS behavior
- **WHEN** TTS stops at a chapter boundary and the user triggers "Explain TTS behavior"
- **THEN** the system retrieves `tts.auto_advance` and `epub.chapter_navigation` documentation, explaining the auto-advance threshold setting.
