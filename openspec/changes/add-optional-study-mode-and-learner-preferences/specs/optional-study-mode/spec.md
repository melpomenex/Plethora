# Optional Study Mode and Learner Preferences Specification

## ADDED Requirements

### Requirement: Non-Intrusive Optional Study Mode Activation and Exit
Study Mode SHALL be explicitly activated by the user from the reader, context menu, Command Palette, or Study Plan, and SHALL preserve ordinary reading position, zoom, selections, and annotations upon exit.

#### Scenario: Immediate exit back to ordinary reading
- **WHEN** a learner activates Study Mode while reading a document and later clicks Exit Study Mode
- **THEN** the reader returns to the exact prior reading location without prompts, overlays, or created Study Plans.

### Requirement: Optional Subject-Specific Learner Preferences
The system SHALL support optional global and subject-specific learner preferences (`study_learner_preferences`) without requiring profile configuration before using Study Mode, and SHALL construct a bounded learner context packet for AI tasks.

#### Scenario: Subject-specific expertise override
- **WHEN** a user sets `computer_science` to `advanced` and `economics` to `beginner`
- **THEN** Study Mode context packets for economics use `beginner` preferences while computer science uses `advanced` preferences.
