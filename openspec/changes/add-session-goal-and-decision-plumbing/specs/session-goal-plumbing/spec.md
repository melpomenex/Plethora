## Purpose

Defines the explicit session goal as a first-class, persisted user input: where the goal is
captured in the Customize Session modal, how it survives a reload, how it crosses the Tauri
bridge into the ranker, and how the goal-relevance ranking term derives a normalized score
from it. Without this the `goalRelevance` slider weights a signal that carries none of the
user's stated objective.

## ADDED Requirements

### Requirement: Session goal is an explicit text input in the Customize Session modal

The system SHALL provide a free-text **Session Goal** field within the Adaptive Ranking section
of the Customize Session modal, positioned adjacent to the **Goal relevance** slider it feeds,
and SHALL render it with the modal's existing design tokens (border, background, foreground and
muted colours) rather than a raw palette colour. The field SHALL carry a placeholder naming
example objectives, and SHALL render helper microcopy explaining that the objective is what
the decision model ranks against. All user-visible strings on the field SHALL come from the
locale files, and every shipped locale SHALL carry them.

#### Scenario: Field is visible when adaptive ranking is on
- **GIVEN** adaptive ranking is enabled
- **WHEN** the user opens the Customize Session modal
- **THEN** the Session Goal field SHALL be rendered next to the Goal relevance slider
- **AND** helper microcopy describing its effect on ranking SHALL be rendered

#### Scenario: Field is hidden when adaptive ranking is off
- **GIVEN** adaptive ranking is disabled
- **WHEN** the user opens the Customize Session modal
- **THEN** the Session Goal field SHALL NOT be rendered
- **AND** the sliders it accompanies SHALL also be absent

#### Scenario: Every locale carries the field's strings
- **WHEN** the application is run in any shipped locale
- **THEN** the Session Goal label, placeholder and microcopy SHALL render in that locale
- **AND** none of them SHALL fall back to a raw translation key

### Requirement: The goal is edited freely and normalised at the boundary

The system SHALL accept any non-empty text as the session goal, and SHALL normalise it before
it reaches the ranker: leading and trailing whitespace SHALL be stripped, a goal that is empty
after stripping SHALL be treated as **no goal** rather than an empty string, and a goal
exceeding the configured maximum length SHALL be refused rather than silently truncated.

#### Scenario: Whitespace-only input is treated as no goal
- **WHEN** the user enters only spaces or tabs in the Session Goal field
- **THEN** the system SHALL treat the session as having no goal
- **AND** the goal-relevance term SHALL report itself unavailable rather than scoring zero

#### Scenario: Over-long input is refused, not truncated
- **GIVEN** the maximum goal length has a configured value
- **WHEN** the user enters a goal longer than that maximum
- **THEN** the system SHALL refuse the value
- **AND** the previously accepted goal SHALL remain in effect
- **AND** the user SHALL be told the value was refused and why

### Requirement: The goal is persisted and restored across reloads

The system SHALL persist the last accepted session goal in the settings store, alongside a
capped, most-recent-first list of recently used goals. The persisted goal SHALL be restored
into the field when the modal is next opened and SHALL be sent on every subsequent ranking pass.
This is a deliberate exception to the rest of the session customization state, which is
transient, because ranking reads the goal on every re-rank.

#### Scenario: Goal survives an app restart
- **GIVEN** the user set a session goal and restarted the application
- **WHEN** the user opens the Customize Session modal
- **THEN** the Session Goal field SHALL show the goal they set

#### Scenario: An unset goal defaults to empty rather than a placeholder string
- **GIVEN** no goal has ever been set
- **WHEN** the user opens the Customize Session modal
- **THEN** the Session Goal field SHALL be empty
- **AND** the placeholder SHALL be shown rather than being stored as a value

### Requirement: Recently used goals drive a quick-select control

The system SHALL render a quick-select row of chips beside the Session Goal field, populated
from the persisted list of recently used goals. Selecting a chip SHALL set the field to that
goal. The control SHALL be omitted entirely when the list is empty, SHALL NOT invent suggestions
from other data, and SHALL NOT force any specific candidate into the field.

#### Scenario: Selecting a chip sets the field
- **GIVEN** previously used goals exist
- **WHEN** the user selects one of the quick-select chips
- **THEN** the Session Goal field SHALL take that chip's text

#### Scenario: No chips when nothing has been used
- **GIVEN** no goal has ever been set
- **WHEN** the user opens the Customize Session modal
- **THEN** no quick-select chips SHALL be rendered

#### Scenario: The list stays bounded
- **GIVEN** more distinct goals have been used than the cap allows
- **WHEN** the user opens the Customize Session modal
- **THEN** at most the cap number of chips SHALL be rendered
- **AND** the most recently used goals SHALL be the ones retained

### Requirement: The goal crosses the Tauri bridge on every ranking pass

Every ranking invocation SHALL carry the current session goal in its payload, so that the
ranker receives the same goal the user last saw. A ranking invocation made while no goal is
set SHALL carry an explicit absence rather than an empty string, so the ranker can distinguish
"no goal" from "a goal that scored nothing".

#### Scenario: Payload carries the current goal
- **GIVEN** the user has set a session goal
- **WHEN** the queue is re-ranked
- **THEN** the ranking request SHALL carry that goal
- **AND** the ranker SHALL receive it as the active goal

#### Scenario: Absence is explicit, not an empty string
- **GIVEN** no goal is set
- **WHEN** the queue is re-ranked
- **THEN** the ranking request SHALL signal goal absence explicitly
- **AND** the ranker SHALL NOT treat the absence as a goal matching nothing

### Requirement: The goal-relevance term is derived from the goal statement

The ranker's goal-relevance term SHALL derive a normalized score in `[0,1]` from the goal
statement and the candidate item, so that changing the goal changes the ranking. With no goal
set the term SHALL report itself unavailable rather than a fabricated value. With a goal set
but no provider reachable, the term SHALL still derive a score locally and deterministically
from the goal and the item's own text, so the feature does not depend on a decision model being
configured.

#### Scenario: Changing the goal changes the order
- **GIVEN** a goal that matches one candidate and not another
- **WHEN** the goal is changed to one that matches the other candidate
- **THEN** the goal-relevance scores SHALL change accordingly
- **AND** the resulting queue order SHALL change

#### Scenario: No goal means unavailable, not zero
- **GIVEN** no goal is set
- **WHEN** the queue is ranked
- **THEN** the goal-relevance term SHALL report itself unavailable
- **AND** it SHALL NOT be reported as a measured score of zero

#### Scenario: A local score is available with no provider configured
- **GIVEN** a goal is set and no decision-model provider is configured or reachable
- **WHEN** the queue is ranked
- **THEN** the goal-relevance term SHALL still return a normalized score
- **AND** the score SHALL be derived deterministically from the goal and the item's text

#### Scenario: Identical goal and pool produce identical order
- **GIVEN** the same goal, the same pool and the same knob values
- **WHEN** the queue is ranked twice
- **THEN** both rankings SHALL produce the same order

#### Scenario: The goal reorders but never resizes the session
- **GIVEN** a session whose membership is fixed by its other filters
- **WHEN** the goal changes and the queue is re-ranked
- **THEN** the set of items in the session SHALL be unchanged
- **AND** only their order SHALL be affected

### Requirement: Resetting the customization clears the goal

`Reset to Defaults` SHALL restore the Session Goal field to its empty state, and the cleared
goal SHALL take effect on the next ranking pass. Reset SHALL NOT clear the recently used goals
list, which is a record of past sessions rather than part of the current session's
configuration.

#### Scenario: Reset empties the field
- **GIVEN** a session goal is set
- **WHEN** the user activates `Reset to Defaults`
- **THEN** the Session Goal field SHALL be empty
- **AND** the next ranking pass SHALL carry goal absence

#### Scenario: Reset preserves the recent-goals history
- **GIVEN** a session goal is set and appears in the recently used list
- **WHEN** the user activates `Reset to Defaults`
- **THEN** the recently used goals list SHALL be unchanged
- **AND** the chips SHALL remain available