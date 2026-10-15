## ADDED Requirements

### Requirement: Global feature popup toggle
The system SHALL provide a global setting at `Settings -> General -> Show Feature Popups & Onboarding Hints` (boolean, default `true`) that controls whether feature tour popups and coach marks are displayed.

#### Scenario: User disables feature popups globally
- **WHEN** the user sets "Show Feature Popups & Onboarding Hints" to false
- **THEN** all feature tour popups and coach marks SHALL be suppressed across the entire application

#### Scenario: Default behavior shows popups
- **WHEN** the setting is at its default value of true
- **THEN** feature popups and coach marks SHALL display normally

### Requirement: Per-popup permanent dismissal
Each floating coach mark and popup overlay SHALL include a "Don't show again" checkbox. Checking it SHALL write the dismissal state to `settingsStore` so the specific popup never appears again.

#### Scenario: User dismisses a specific popup
- **WHEN** the user checks "Don't show again" on a feature popup
- **THEN** that specific popup SHALL never appear again, even after app restart

#### Scenario: Other popups still appear
- **WHEN** the user dismisses one specific popup via "Don't show again"
- **THEN** other feature popups that have not been dismissed SHALL still appear (if the global toggle is on)
