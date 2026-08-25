# adaptive-algorithm Specification

## Purpose
Implement the Plethora Adaptive (Plethora 18) spaced repetition algorithm in the Rust backend, enabling users to select it as their scheduling algorithm for learning item reviews.

## ADDED Requirements

### Requirement: Plethora Adaptive Core Review Logic
The system SHALL implement the Plethora Adaptive algorithm for computing next review intervals based on grade, stability, difficulty, and elapsed time.

#### Scenario: First review with Plethora Adaptive
- **Given** a new learning item with no prior reviews
- **And** the user has selected Plethora Adaptive as their algorithm
- **When** the user rates the item with grade 4 (Good)
- **Then** the system SHALL set initial stability to 1.2 days
- **And** the system SHALL set initial interval to 6.9 days
- **And** the system SHALL set initial difficulty based on the BW-to-difficulty mapping

#### Scenario: Successful review increases stability
- **Given** a learning item with stability S=10.0 and elapsed 10.0 days
- **And** the retrievability is approximately 0.9
- **When** the user rates the item with grade 3 (Good)
- **Then** the system SHALL multiply stability by the SInc factor from the SInc matrix
- **And** the new stability SHALL be greater than the old stability

#### Scenario: Failed review resets and reduces stability
- **Given** a learning item with stability S=50.0 and 0 prior lapses
- **When** the user rates the item with grade 0 (Again)
- **Then** the system SHALL increment the lapse count
- **And** the system SHALL reduce stability using the post-lapse formula: `max(S * 0.87 / (1 + 0.1 * lapses), 0.5)`
- **And** the system SHALL reset the repetition counter to 0

### Requirement: Plethora Adaptive State Persistence
The system SHALL persist Plethora Adaptive-specific state for each learning item so that subsequent reviews use the correct algorithm state.

#### Scenario: Plethora Adaptive state persists across reviews
- **Given** a learning item reviewed with Plethora Adaptive
- **When** the item is reviewed again
- **Then** the system SHALL restore the Plethora Adaptive state (stability, difficulty, interval, repetition, lapses) from the persisted `algorithm_state` JSON
- **And** the review SHALL use the restored state to compute the next schedule

#### Scenario: Items without algorithm type default to FSRS
- **Given** an existing learning item with no `algorithm_type` column value
- **When** the item is reviewed
- **Then** the system SHALL treat the item as using the FSRS algorithm (backward compatibility)

### Requirement: Plethora Adaptive Difficulty Update
The system SHALL update difficulty using the Plethora Adaptive trailing average formula.

#### Scenario: Difficulty adjusts based on performance
- **Given** a learning item with current difficulty D=0.3 and repetition number 5
- **When** the user rates the item
- **Then** the system SHALL compute BW from grade and retrievability
- **And** the system SHALL update difficulty using the trailing average: `D_new = f * RepDiff + (1-f) * D_old` where `f = max(0.10, 0.80 - (rep-1) * 0.06)`
- **And** the new difficulty SHALL be clamped to [0.0, 1.0]

### Requirement: Plethora Adaptive Retrievability Calculation
The system SHALL compute retrievability using the Plethora Adaptive power-decay formula.

#### Scenario: Retrievability at exact stability interval
- **Given** a learning item with stability S=10.0
- **When** the elapsed time since last review is exactly 10.0 days
- **Then** the retrievability SHALL be 0.9 (by definition: `R = 0.9^(t/S)`)

#### Scenario: Retrievability for zero elapsed time
- **Given** a learning item with any stability value
- **When** the elapsed time is 0.0 days
- **Then** the retrievability SHALL be 1.0
