# Study Mode Contextual Tutor and Personalization Specification

## ADDED Requirements

### Requirement: Contextual AI Tutor Reusing Existing Socratic Tutor
Study Mode SHALL integrate with Plethora's existing `TutorSheet` (without building a duplicate chat interface), automatically injecting current source passage/anchor, active learning objective, recent practice answers, detected misconceptions, knowledge authority bounds, and saved preferences, and exposing 7 one-click contextual prompts.

#### Scenario: Opening Tutor from Study Mode injects live context and selected prompt
- **GIVEN** a learner has an active source passage, an active learning objective, and a recent practice misconception
- **WHEN** the learner clicks "Explain why my answer was wrong" in the Contextual Tutor bar
- **THEN** Plethora's existing `TutorSheet` opens with the bounded material containing the source passage, objective, misconception, and selected prompt.

#### Scenario: Offline state prevents silent failure when launching tutor
- **GIVEN** the learner is offline
- **WHEN** the learner clicks a contextual tutor prompt
- **THEN** Study Mode surfaces a clear contextual notice or allows inspecting the prepared prompt without losing workspace state.

### Requirement: Inline Explanation Adjustment Chips with Reversible Subject Defaults
Generated explanations in the `Learn` tab SHALL display inline adjustment chips (`Simpler`, `More technical`, `Use an analogy`, `Show an example`, `Go deeper`) and an opt-in, transparent, reversible **"Save as default for this topic"** action, while keeping `StudyModePreferencesDrawer` optional.

#### Scenario: Applying an inline chip and saving as subject default with undo
- **GIVEN** a generated explanation is visible in the `Learn` tab
- **WHEN** the learner clicks `Simpler` and then clicks "Save as default for this topic"
- **THEN** a regenerated explanation is requested with plain vocabulary / concise framing, `upsertStudyLearnerPreference` persists the subject-scoped override, and an Undo button allows reverting the override immediately.
