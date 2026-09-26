## Purpose

Defines one authoritative, type-safe registry of the actions offered when the user selects text in readable content, so every selection menu surface (desktop context menu, mobile anchored bar, mobile action sheet) derives its items and dispatch from a single definition instead of parallel per-surface enumerations.

## ADDED Requirements

### Requirement: Selection menus derive their actions from one shared registry

Every selection action menu surface SHALL build its action list from a single shared selection-action registry. An action's identifier, display label, availability rules, and dispatch handler SHALL be defined exactly once in that registry; menu surfaces SHALL NOT enumerate or re-implement action behavior locally.

#### Scenario: Same action appears on every applicable surface

- **GIVEN** an action is applicable to a text selection in a saved web article
- **WHEN** the user opens the desktop context menu, the mobile anchored bar, and the mobile action sheet for equivalent selections
- **THEN** the action appears in all three surfaces with the same label and behavior

#### Scenario: Adding a new action requires one registry entry and one handler route

- **WHEN** a developer adds a new selection action
- **THEN** they add one action descriptor to the shared registry and one handler route
- **AND** the action appears and works on every menu surface without further per-surface changes

### Requirement: Actions declare availability per content surface and selection

Each registry action SHALL declare the content surfaces and selection properties it applies to. Menu surfaces SHALL hide actions that do not apply to the current selection rather than showing them disabled.

#### Scenario: Inapplicable action is hidden

- **GIVEN** an action that requires an anchored selection position
- **WHEN** the current surface's selection carries no position anchor
- **THEN** the action is not shown in any menu surface for that selection

### Requirement: Action dispatch receives the full selection context

Invoking a registry action SHALL dispatch to a single handler that receives the selection's full context — source identity, selected text, and position anchor — regardless of which menu surface invoked it. No surface-specific pre- or post-processing SHALL be required for an action to behave identically across surfaces.

#### Scenario: Extract created from the bar matches extract created from the context menu

- **GIVEN** the same selection in a saved web article
- **WHEN** the user invokes the extract action once from the mobile anchored bar and once from the desktop context menu
- **THEN** both invocations produce extracts with identical text, source linkage, and anchor data

### Requirement: Existing surface action sets are unchanged by the registry migration

The registry migration SHALL be behavior-preserving for surfaces that already had selection actions: EPUB, PDF, markdown, transcript, and RSS selections SHALL expose the same actions after the migration as before it.

#### Scenario: EPUB selection menu keeps its full action set

- **WHEN** the user selects text in an EPUB after the registry migration
- **THEN** the available actions (including summarize, extract, flashcard creation, highlighting, and copy) match the pre-migration set for the same document and selection

### Requirement: The anchored bar reorders to keep the user's most-used actions easiest to reach

The compact anchored bar SHALL order its actions by the user's recorded invocation counts — most-used first — once a minimum total number of invocations has accumulated. Below that threshold, and for ties, the canonical registry order SHALL apply, and availability gating SHALL NOT be weakened by popularity. Usage counts SHALL record only which action was chosen (no selected text, no document content) and SHALL remain local to the device.

#### Scenario: A frequent extractor sees Extract first

- **GIVEN** the user has invoked selection actions enough times to cross the adaptation threshold, with extract being the most-invoked action
- **WHEN** the anchored bar appears for a new selection
- **THEN** the Extract action is the first chip, ahead of the canonical front-runners

#### Scenario: Sparse usage keeps the canonical order

- **GIVEN** fewer than the minimum total invocations have been recorded
- **WHEN** the anchored bar appears
- **THEN** the chips are in the canonical registry order

#### Scenario: Equally-used actions never jitter

- **GIVEN** two actions with equal invocation counts
- **WHEN** the bar is ordered
- **THEN** the tie resolves to the canonical registry order

#### Scenario: Popularity does not bypass availability

- **GIVEN** an action with the highest invocation count that is not available on the current surface
- **WHEN** the bar is ordered
- **THEN** that action is not shown at all

#### Scenario: Usage counts stay local and content-free

- **WHEN** an action is invoked from the bar, the action sheet, or the context menu
- **THEN** only the action identifier is counted
- **AND** the counts are persisted on the device without ever including selected text or document content
