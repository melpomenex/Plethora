## ADDED Requirements

### Requirement: Integrated Command Palette help experience
The help experience SHALL be seamlessly integrated into the existing `CommandCenter` / `GlobalSearch` UI without launching a separate chat window. The UI SHALL support instant lexical preview, progressive rendering of synthesis results, citation chips, and keyboard navigation (`↑`/`↓` to select, `Enter` to open, `Esc` to dismiss).

#### Scenario: Progressive response rendering
- **WHEN** a user asks a complex question in the Command Palette
- **THEN** the palette immediately displays matching documentation titles and relevant excerpt snippets, shows a compact loading state while the model synthesizes the answer, and streams or renders the final grounded response inline.

### Requirement: Interactive verified citation badges
Generated and direct help answers SHALL include clickable source citations linked to stable feature IDs. Clicking a citation SHALL open the full documentation view for that feature.

#### Scenario: Citation inspection
- **WHEN** a help answer displays citations `[TTS › Playback Position]` and `[Reading › Resume Behavior]`
- **THEN** clicking either badge opens the canonical documentation modal or side drawer displaying the complete code-verified article.

### Requirement: Interactive allowlisted action buttons
When a retrieved feature or synthesized answer includes safe allowlisted action references, the palette SHALL render them as interactive buttons (e.g. `[Open E-ink Settings]`, `[Switch Scheduler]`).

#### Scenario: Action execution from answer
- **WHEN** the user asks "How do I enable e-ink mode?" and presses Enter on `[Open E-ink Settings]`
- **THEN** the palette closes and immediately navigates to Settings → Appearance with the E-ink panel active.

### Requirement: Accessibility and display mode compliance
The help UI in the Command Palette SHALL support screen readers (ARIA labels, live regions for streaming answers), keyboard-only operation, high contrast modes, and e-ink display mode (zero animations, solid high-contrast borders).

#### Scenario: E-ink display mode compatibility
- **WHEN** the application is running in E-ink mode (`data-display-mode="eink"`)
- **THEN** the help results render with monochrome styling, crisp high-contrast outlines, and no animations.

### Requirement: Developer retrieval inspector overlay
The system SHALL provide an optional developer diagnostic panel (accessible via shortcut or debug menu) displaying detected intent, retrieved chunk IDs, similarity scores, token counts, and provider response times.

#### Scenario: Diagnosing retrieval ranking
- **WHEN** a developer tests a query in development mode
- **THEN** the inspector displays the exact BM25 score, cosine similarity, contextual boost multipliers, and prompt token count.
