## MODIFIED Requirements

### Requirement: Persist selected queue strategy preset
The system SHALL persist the user's selected queue strategy preset in the settings store. The persisted value SHALL survive page navigation and app restarts. The preset set SHALL comprise the five original strategies (`maximize-retention`, `minimize-time`, `aggressive-catchup`, `exploratory`, `project-focused`) plus the four DAQE learning-mode presets (`deep-work-sprint`, `tired-mobile-commute`, `ruthless-triage`, `balanced-discovery`). The five original strategies SHALL continue to be selectable and SHALL continue to resolve to their existing five-dimension priority vectors. The four DAQE presets SHALL resolve to the six ranking knob values defined by `queue-mode-presets`. The persisted preset SHALL be reported as active only while the user's knobs exactly match it; once any knob is individually adjusted, the system SHALL report no active preset rather than continuing to attribute the knobs to the preset the user started from.

#### Scenario: Preset persists across navigation
- **WHEN** the user selects "Minimize Daily Time" in the Queue view dropdown and navigates away then returns
- **THEN** the dropdown SHALL show "Minimize Daily Time" as the active selection

#### Scenario: Preset persists across app restart
- **WHEN** the user selects "Project-Focused", closes the app, and reopens it
- **THEN** the Queue view dropdown SHALL show "Project-Focused" as the active selection

#### Scenario: Default preset for new users
- **WHEN** a user has no previously saved preset preference
- **THEN** the system SHALL default to "maximize-retention"

#### Scenario: DAQE preset persists and writes its knobs
- **WHEN** the user selects "Deep Work Sprint" and restarts the application
- **THEN** the system SHALL report "Deep Work Sprint" as active
- **AND** `energyTarget` SHALL still be `4` and `goalRelevance` SHALL still be `0.50`

#### Scenario: Adjusting a knob clears preset attribution
- **WHEN** the user selects "Ruthless Triage" and then adjusts `energyTarget`
- **THEN** the system SHALL report no active preset
- **AND** it SHALL NOT display "Ruthless Triage" as active

### Requirement: Show preset description below dropdown
The system SHALL display a one-line description below the preset dropdown that explains what the currently selected strategy optimizes for. The description SHALL update when the user changes the selection. Every selectable preset — including each of the four DAQE learning modes — SHALL have such a description, and it SHALL be visible without hover or click. Alongside the dropdown, the system SHALL present the six ranking knobs with their current values, ranges, and descriptions, and SHALL state that these controls affect queue ordering only and do not schedule reviews.

#### Scenario: Description updates on selection change
- **WHEN** the user changes the preset from "Maximize Retention" to "Aggressive Catch-Up"
- **THEN** the description line SHALL update to describe the aggressive catch-up strategy

#### Scenario: Description is visible without interaction
- **WHEN** the user views the Queue view
- **THEN** the description for the current preset SHALL be visible without requiring hover or click

#### Scenario: DAQE presets each carry a description
- **WHEN** the user opens the preset dropdown
- **THEN** each of "Deep Work Sprint", "Tired / Mobile Commute", "Ruthless Triage", and "Balanced Discovery" SHALL have a visible one-line description

#### Scenario: Knob panel states its scope
- **WHEN** the user views the ranking knob panel
- **THEN** all six knobs SHALL show their current value, range, and description
- **AND** the panel SHALL indicate that the controls affect ordering only and do not schedule reviews