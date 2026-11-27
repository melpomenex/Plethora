# Study Mode End-to-End Validation Specification

## ADDED Requirements

### Requirement: Cross-Wave End-to-End Verification and Read Mode Non-Regression
All 4 Study Mode overhaul waves SHALL pass automated unit, integration, typecheck, lint, and production build checks, guaranteeing zero Read Mode regression when Study Mode is closed or disabled.

#### Scenario: Disabling Study Mode leaves Read Mode untouched
- **GIVEN** `settings.studyMode.showEntryPoints` is false or Study Mode is closed
- **WHEN** a user reads a document in ordinary Read Mode
- **THEN** zero Study Mode workspace panels mount and zero Study Mode AI requests are issued.
