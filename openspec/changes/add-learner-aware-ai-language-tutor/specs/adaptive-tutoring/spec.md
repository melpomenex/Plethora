# Spec Delta: adaptive-tutoring

## MODIFIED Requirements

### Requirement: Language learner context is optional and bounded

Adaptive tutoring SHALL accept an optional language profile/learner-state packet, retrieved within context limits, while generic tutoring remains functional without it. The packet MUST NOT include the full lexicon by default.

#### Scenario: Generic tutoring
- **WHEN** Teach Me is launched without a language profile
- **THEN** existing generic adaptive tutoring behavior remains available

### Requirement: Language practice preserves generic tutoring controls

Language-specific correction, source attribution, provider choice, and privacy controls SHALL compose with existing lesson state, quotas, persistence, and graceful fallback rather than creating a second tutor runtime.

#### Scenario: Hosted quota exhausted
- **WHEN** a language lesson reaches hosted-model limits
- **THEN** it uses existing fallback/continuation behavior and preserves the lesson session
