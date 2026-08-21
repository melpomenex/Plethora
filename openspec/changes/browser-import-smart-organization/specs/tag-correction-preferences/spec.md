# Tag Correction Preferences (Optional Phase)

## ADDED Requirements

This capability is an optional, feature-gated phase of the browser organization change. The core import workflow SHALL remain complete when it is disabled.

### Requirement: Preference memory SHALL use explicit deterministic signals

When enabled, the application SHALL learn only from explicit user actions such as accepting a suggestion, correcting a tag, creating an alias, or repeatedly dismissing a mapping. Silent non-action SHALL not be treated as a preference.

#### Scenario: A user repeatedly maps an alias

- **WHEN** the user explicitly maps the same normalized phrase to a canonical tag at the configured evidence threshold
- **THEN** the local preference store MAY record that alias with provenance and confidence

#### Scenario: A user ignores a suggestion

- **WHEN** a suggestion is left untouched
- **THEN** the preference store SHALL not infer a correction or preference from that silence

### Requirement: Preference memory SHALL be subordinate to taxonomy and user authority

Any learned hint SHALL pass canonicalization and policy, SHALL never mutate the global taxonomy automatically, and SHALL never override a manual tag or dismissal.

#### Scenario: A learned alias conflicts with a manual tag

- **WHEN** a learned hint recommends a tag that conflicts with an explicit user assignment
- **THEN** the manual assignment SHALL win and the hint SHALL not reintroduce the conflicting tag

### Requirement: Preference memory SHALL be local, transparent, and resettable

The store SHALL be local-first, visible enough to inspect or reset, and excluded from browser payloads unless the user explicitly exports it. No hidden model training or remote profile SHALL be introduced.

#### Scenario: The user resets preferences

- **WHEN** the user resets correction preferences
- **THEN** learned aliases and hints SHALL be removed while semantic tags, manual assignments, and saved content remain unchanged

### Requirement: Disabled preference memory SHALL have no behavioral effect

When the optional capability is disabled or unavailable, organization SHALL behave exactly as the canonical baseline/local/LLM policy behaves without learned hints.

#### Scenario: The optional phase is not shipped

- **WHEN** the feature flag or setting is off
- **THEN** no preference records SHALL be created and no classifier result SHALL depend on preference memory
