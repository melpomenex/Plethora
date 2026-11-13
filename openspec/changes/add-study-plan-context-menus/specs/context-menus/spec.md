## ADDED Requirements

### Requirement: Study Plan editor objects expose state-aware context actions

The Study Plan editor SHALL provide object context menus for included and removed curriculum topics, source material rows, assessment cards, and version history rows that have an available action. A menu SHALL offer only actions supported by the clicked object and current plan state, and each action SHALL use the same behavior as the corresponding Study Plan control. Opening a menu SHALL NOT select, navigate, reorder, or mutate the object until an item is chosen. A row with no available action SHALL NOT open an empty menu.

For an included topic, the menu SHALL offer Open topic, Start lesson, Move earlier, Move later, Lock or Unlock, and Remove from plan when each action is available in the current view. Reordering SHALL respect prerequisite order, topic locks, and read-only state. A removed topic SHALL offer Open topic and Restore when restoration is allowed. A source row SHALL offer Open source, and SHALL offer Remove link only when it is a topic source in an editable draft. An assessment card SHALL offer Open and Archive, and SHALL offer Delete unused assessment through the existing guarded deletion path. A version row SHALL offer View only when the current view can select that version, and SHALL offer Copy to draft only when the current view supports the action and the version and plan state allow a new draft; historical versions SHALL remain immutable.

Unavailable actions SHALL be hidden or disabled with a reason. Destructive actions SHALL retain the shared menu's danger styling, placement, and existing safety behavior.

#### Scenario: Included topic menu respects ordering and draft state

- **WHEN** a learner right-clicks an included topic in an editable draft
- **THEN** the menu offers the topic actions supported by that topic, disables or omits moves that would violate prerequisites or locks, and leaves the selected topic unchanged until an action is chosen

#### Scenario: Removed topic can be restored

- **WHEN** a learner right-clicks a removed topic in an editable draft
- **THEN** the menu offers Open topic and Restore, and choosing Restore uses the existing restore behavior

#### Scenario: Plan-wide source menu opens the source

- **WHEN** a learner right-clicks a plan-wide source row
- **THEN** the menu offers Open source and does not offer topic unlinking

#### Scenario: Topic source menu can unlink in an editable draft

- **WHEN** a learner right-clicks a source linked to a topic in an editable draft
- **THEN** the menu also offers Remove link and choosing it removes only that topic link

#### Scenario: Assessment actions preserve existing eligibility

- **WHEN** a learner right-clicks an assessment card
- **THEN** the menu offers Open and Archive, and Delete unused assessment is available only when the existing deletion handler permits it

#### Scenario: Historical version actions preserve immutability

- **WHEN** a learner right-clicks a historical version that can be copied into a draft
- **THEN** the menu offers View and Copy to draft, and choosing Copy to draft creates a draft from that version without editing the historical version

#### Scenario: Current version with no available action has no empty menu

- **WHEN** a learner right-clicks the already-viewing version and the current view offers no other version action
- **THEN** no empty version menu appears

#### Scenario: Editable fields retain native editing menus

- **WHEN** a learner right-clicks a topic input, text area, or other editable field within these views
- **THEN** no Study Plan object menu intercepts the native editing menu

#### Scenario: Blank space does not target an object menu

- **WHEN** a learner right-clicks blank space between Study Plan objects
- **THEN** no object-specific menu appears for a nearby or previously selected object

### Requirement: Plan Home cards expose contextual navigation actions

The Plan Home recommendation card SHALL expose Continue for its recommended topic and Browse path when those actions are available. The due-review card SHALL expose its existing Review action, including when the count is unavailable. Opening either menu SHALL NOT start a lesson, change study progress, or start a review until the learner chooses an item.

#### Scenario: Recommendation menu leaves navigation explicit

- **WHEN** a learner right-clicks a Plan Home recommendation card with a topic
- **THEN** the menu offers Continue and Browse path, and the learner remains on Plan Home until one is chosen

#### Scenario: Due-review menu offers the existing review route

- **WHEN** a learner right-clicks the due-review card while the review count is unavailable
- **THEN** the menu still offers Review and does not invent a due count or alter review scheduling
