# algorithm-selection-ui Specification

## Purpose
Allow users to select between available spaced repetition algorithms in the Learning Settings UI, with the selection persisted and respected by the backend review dispatch.

## ADDED Requirements

### Requirement: Algorithm Selection Dropdown
The system SHALL present an algorithm selector in the Learning Settings that lists all available algorithms with name, version, and description.

#### Scenario: User views algorithm options
- **Given** the user opens Learning Settings
- **When** the algorithm selector is displayed
- **Then** the system SHALL show the following options:
  - FSRS-6 (Recommended) -- Modern free algorithm with stability/difficulty model
  - Plethora Classic -- Classic Plethora scheduler algorithm (ease factor, simple intervals)
  - Classic 5 -- Improved Plethora with modifier factor
  - Classic 8 -- Plethora with optimal intervals and lapse tracking
  - Classic 15 -- Modern Plethora with stability/difficulty model
  - Plethora Adaptive -- Latest Plethora scheduler algorithm with SInc matrix
- **And** the currently selected algorithm SHALL be indicated

#### Scenario: User selects Plethora Adaptive
- **Given** the user has FSRS-6 selected
- **When** the user selects Plethora Adaptive from the dropdown
- **Then** the system SHALL show a confirmation dialog warning that existing scheduling data will not be migrated
- **And** upon confirmation, the system SHALL persist the selection to the settings store
- **And** subsequent reviews SHALL use the Plethora Adaptive algorithm

### Requirement: Algorithm Selection Persistence
The system SHALL persist the algorithm selection across sessions and platforms.

#### Scenario: Algorithm selection persists after restart
- **Given** the user has selected Plethora Adaptive
- **When** the application is restarted
- **Then** the algorithm SHALL remain Plethora Adaptive
- **And** the settings UI SHALL reflect the saved selection

#### Scenario: Algorithm selection works in Tauri desktop and Web App
- **Given** the user selects Plethora Adaptive in the Tauri desktop app
- **When** the user accesses the Web App / PWA
- **Then** the Web App SHALL also reflect the Plethora Adaptive selection (if settings are synced)
- **And** the Web App review endpoint SHALL dispatch to Plethora Adaptive

### Requirement: Algorithm-Specific Settings Visibility
The system SHALL show or hide algorithm-specific settings based on the selected algorithm.

#### Scenario: FSRS retention slider hidden for Plethora Adaptive
- **Given** the user has selected Plethora Adaptive
- **When** the Learning Settings are displayed
- **Then** the FSRS "Desired Retention" slider SHALL be hidden (Plethora Adaptive uses its own forgetting index)
- **And** the FSRS "Personal FSRS Optimizer" button SHALL be hidden
- **And** the FSRS scoped overrides section SHALL be hidden

#### Scenario: FSRS settings visible for FSRS selection
- **Given** the user has selected FSRS-6
- **When** the Learning Settings are displayed
- **Then** the FSRS "Desired Retention" slider SHALL be visible
- **And** the FSRS "Personal FSRS Optimizer" button SHALL be visible
- **And** the FSRS scoped overrides section SHALL be visible

### Requirement: Backend Algorithm Dispatch
The backend SHALL route review commands to the selected algorithm implementation.

#### Scenario: Review dispatched to Plethora Adaptive
- **Given** the user has selected Plethora Adaptive as their algorithm
- **When** a review is submitted for a learning item
- **Then** the backend SHALL use the Plethora Adaptive algorithm to compute the next schedule
- **And** the result SHALL be persisted with `algorithm_type = "adaptive"` and `algorithm_state` containing the Plethora Adaptive state JSON

#### Scenario: Review dispatched to Plethora Classic
- **Given** the user has selected Plethora Classic as their algorithm
- **When** a review is submitted for a learning item
- **Then** the backend SHALL use the Plethora Classic algorithm to compute the next schedule
- **And** the result SHALL be persisted with `algorithm_type = "m1"` and `algorithm_state` containing the Plethora Classic state JSON
