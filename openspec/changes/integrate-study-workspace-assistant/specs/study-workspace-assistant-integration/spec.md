# Study Workspace Assistant Integration Specification

## ADDED Requirements

### Requirement: Coordinated Existing Assistant Hosting
Study Mode SHALL reuse Plethora's existing `AssistantPanel` (desktop) and `MobileAssistantHost` (mobile) without creating a second chat implementation. Entering Study Mode SHALL hide the Assistant by default while preserving conversation history, and toggling `"with-assistant"` SHALL open the existing Assistant alongside Study Mode and replace `"with-source"`.

#### Scenario: Assistant conversation survives entering and exiting Study Mode
- **GIVEN** a user has an active Assistant conversation in Read Mode
- **WHEN** the user enters Study Mode (Focused), opens Assistant in `"with-assistant"`, closes Assistant, and exits Study Mode
- **THEN** the existing Assistant conversation history is preserved intact
- **AND** no second chat engine is mounted.

### Requirement: Study-Aware Bounded Context Without Answer-Key Leakage
When the Assistant is used in Study Mode, its context SHALL include bounded information about the active study scope, active activity, relevant artifact, and Study Plan context, while NEVER including hidden answer keys, correct indices, expected blanks, or rubrics of unanswered formative questions.

#### Scenario: Unanswered practice question answer key is excluded from Assistant context
- **GIVEN** a learner has an active unanswered multiple-choice or short-answer question in Practice
- **WHEN** `buildStudyAssistantContext` assembles context for the Assistant
- **THEN** the question prompt and scope label may be included
- **AND** `correctIndex`, `expectedBlanks`, `correctOrder`, and `requiredKeyFacts` are strictly excluded.

### Requirement: Socratic Tutor, Study Trail, and Explicit Promotion Integration
Study Mode SHALL integrate Socratic Tutor launch points from Learn, incorrect Practice answers, Concept Map nodes, and Progress recommendations; SHALL suppress competing `GuidedReadingPanel` sidebars while Study Mode is active; and SHALL require explicit user confirmation via `FlashcardStudioModal` for flashcard promotion without mutating FSRS state.

#### Scenario: Study Trail does not mount a competing GuidedReadingPanel during Study Mode
- **GIVEN** a document is opened as part of an active Study Trail
- **WHEN** the user enters Study Mode
- **THEN** `GuidedReadingPanel` is not mounted alongside `StudyModeWorkspace`
- **AND** Study Plan / Study Trail context is preserved inside Study Mode.
