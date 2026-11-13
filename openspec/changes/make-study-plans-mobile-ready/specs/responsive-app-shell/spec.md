## MODIFIED Requirements

### Requirement: Core screens adapt without content loss
Dashboard, Queue, Review, Documents, readers/viewers, Analytics, Search/Import, Settings, and every Study Plans view SHALL provide intentional phone and tablet layouts. At supported viewport widths, these surfaces MUST NOT cause page-level horizontal scrolling, hide a primary action, truncate essential status information without an accessible alternative, or require desktop-only pointer interactions. Each Study Plans flow with content beyond the visual viewport MUST provide a usable scroll path that reaches its final content and primary actions while accounting for the mobile shell's fixed controls.

#### Scenario: Dense desktop surface opens on a phone
- **WHEN** the user opens a screen that uses a table, multi-column grid, split pane, or toolbar on desktop
- **THEN** the screen substitutes a readable list, stacked sections, scroll-contained region, or progressive disclosure appropriate to the available width

#### Scenario: User performs a primary workflow one-handed
- **WHEN** the user reads or imports a document, manages a queue item, completes a review, changes a common setting, or uses a Study Plans workflow on a phone
- **THEN** the primary action is reachable, remains identifiable, and is not covered by navigation or the keyboard

#### Scenario: Tablet has intermediate space
- **WHEN** the app runs at a tablet-width viewport
- **THEN** the layout uses the additional space without forcing either a stretched phone layout or a clipped desktop layout

#### Scenario: User completes Study Plan creation on a phone
- **WHEN** the create form is taller than the available mobile content viewport
- **THEN** the user can scroll through every required field and option to the submit action, and opening the on-screen keyboard does not prevent access to the focused field or submit action

#### Scenario: User opens a long Study Plans view on a phone
- **WHEN** the user opens plan content, assessment history, results, or another Study Plans view taller than the available viewport
- **THEN** the full content has a usable scroll path, fixed shell controls remain usable, and the final content and actions can be brought into view

#### Scenario: Study Plans controls open at narrow widths
- **WHEN** the user opens a Study Plans editor, assessment, lesson, or supporting workflow at a phone width
- **THEN** its controls and status remain readable and operable without unintended horizontal page scrolling or content clipped by the view boundary
