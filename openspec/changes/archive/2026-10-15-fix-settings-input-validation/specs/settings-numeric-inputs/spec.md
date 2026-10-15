## ADDED Requirements

### Requirement: Allow Temporary Empty States
The system SHALL allow numeric settings input fields to be completely cleared (empty string) while the user is actively typing.

#### Scenario: User clears setting input
- **WHEN** the user selects the setting input and deletes all characters
- **THEN** the input displays as empty and the system does not immediately restore the default value

### Requirement: Validate on Blur
The system SHALL perform validation, default fallback, and bounds clamping on numeric setting inputs only when the input field loses focus (blur).

#### Scenario: User types valid value after clearing
- **WHEN** the user clears the font size input and then types '20'
- **THEN** the setting store value is updated to 20 when the input loses focus

#### Scenario: User leaves input empty
- **WHEN** the user clears the setting input and clicks outside the input to blur it
- **THEN** the input restores the previous valid value or default value

#### Scenario: User types out-of-bounds value
- **WHEN** the user types '5' (below min of 10) or '35' (above max of 30) into the EPUB font size setting and blurs it
- **THEN** the value is clamped to the minimum (10) or maximum (30) boundary respectively
