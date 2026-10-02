## Purpose

Defines the user-facing control surface for adaptive queue ranking: a validated
schema of six ranking knobs, and a set of curated presets — including the four
DAQE learning modes — that are plain knob vectors rather than a separate
mechanism, so a preset is always fully expressible and fully overridable as
individual sliders.

## ADDED Requirements

### Requirement: Ranking knobs have a validated schema

The system SHALL expose exactly six ranking knobs with these ranges and
defaults: `srsDecayWeight` (`0.0`–`1.0`, default `0.40`), `goalRelevance`
(`0.0`–`1.0`, default `0.30`), `energyTarget` (integer `1`–`5`, default `3`),
`interleavingDiversity` (`0.0`–`1.0`, default `0.20`), `pruningAggressiveness`
(`0.0`–`1.0`, default `0.10`), and `afkIdleTimeoutMs` (`15000`–`120000`, default
`45000`). Every knob SHALL be validated on write; an out-of-range or
non-numeric value SHALL be rejected and SHALL NOT overwrite the stored value.
Knob values SHALL persist across navigation and application restarts.

#### Scenario: Out-of-range weight is rejected

- **WHEN** a user sets `srsDecayWeight` to `1.4`
- **THEN** the value SHALL be rejected and the stored value SHALL remain unchanged

#### Scenario: Non-integer energy target is rejected

- **WHEN** a user sets `energyTarget` to `3.7`
- **THEN** the value SHALL be rejected and the stored value SHALL remain unchanged

#### Scenario: Knobs persist across restart

- **WHEN** the user sets `energyTarget` to `5` and restarts the application
- **THEN** `energyTarget` SHALL still be `5`

#### Scenario: Defaults apply to a new profile

- **WHEN** a profile has no stored knob values
- **THEN** all six knobs SHALL take their documented defaults

### Requirement: The knob panel is the primary ranking control surface

The system SHALL present all six knobs as labelled sliders (or a stepper for
`energyTarget`) showing each knob's current value, its range, and a one-line
description of what it optimizes for. Changing a knob SHALL re-rank the current
queue immediately without requiring a separate apply action, and SHALL NOT
change which items are in the session.

#### Scenario: Slider shows its current value

- **WHEN** the user opens the ranking knob panel
- **THEN** each of the six knobs SHALL display its current value, range, and description

#### Scenario: Dragging re-ranks immediately

- **WHEN** the user moves `goalRelevance`
- **THEN** the current queue SHALL re-order without a separate apply step
- **AND** the session's item set SHALL be unchanged

### Requirement: Curated presets are knob vectors

A preset SHALL be nothing more than a named set of knob values. Selecting a
preset SHALL write all six of its knob values, and every value it writes SHALL
remain individually editable afterwards. The system SHALL ship these four DAQE
presets in addition to the existing queue strategy presets:

- **Deep Work Sprint** — high energy target (`4`), raised `goalRelevance`
  (`0.50`), lowered `interleavingDiversity` (`0.10`).
- **Tired / Mobile Commute** — low energy target (`2`), lowered
  `srsDecayWeight` (`0.20`), raised `interleavingDiversity` (`0.40`).
- **Ruthless Triage** — raised `pruningAggressiveness` (`0.60`) with
  `srsDecayWeight` at `0.40`.
- **Balanced Discovery** — `srsDecayWeight` `0.35`, `goalRelevance` `0.25`,
  `interleavingDiversity` `0.25`, `pruningAggressiveness` `0.15`.

#### Scenario: Preset writes every knob

- **WHEN** the user selects "Tired / Mobile Commute"
- **THEN** all six knob values SHALL be written to that preset's values

#### Scenario: Preset is fully overridable

- **WHEN** the user selects "Deep Work Sprint" and then adjusts `energyTarget`
- **THEN** the adjustment SHALL persist
- **AND** the preset SHALL be reported as no longer exactly matching its defined values

#### Scenario: Preset profiles are distinguishable

- **WHEN** the user inspects the knob panel
- **THEN** each DAQE preset's one-line description SHALL be visible without requiring hover or click

### Requirement: The active preset is detectable, not assumed

The system SHALL report which preset, if any, the current knob values exactly
match. Once any knob has been individually adjusted, the system SHALL report no
matching preset rather than continuing to attribute the knobs to the preset the
user started from.

#### Scenario: Exact match is reported

- **WHEN** knob values exactly equal "Ruthless Triage"
- **THEN** the panel SHALL report "Ruthless Triage" as the active preset

#### Scenario: Divergence clears attribution

- **WHEN** the user adjusts one knob away from "Ruthless Triage"
- **THEN** the panel SHALL report that no preset is active
- **AND** it SHALL NOT continue to display "Ruthless Triage" as active

### Requirement: Preset selection is transparent about what it changes

Selecting or editing a preset SHALL NOT change FSRS memory state, due dates, or
scheduling for any item. The knob panel SHALL make clear that the controls affect
ordering only, and SHALL NOT present any knob as scheduling a review.

#### Scenario: Preset selection is order-only

- **WHEN** the user selects any preset
- **THEN** no item's stability, difficulty, interval, or due date SHALL change
- **AND** only queue order SHALL change

#### Scenario: Preset surface states its scope

- **WHEN** the user opens the knob panel
- **THEN** it SHALL indicate that the controls affect ordering only and do not schedule reviews