# Pedagogical Content Verification Specification

## ADDED Requirements

### Requirement: Deterministic Source and Safety Verification
Every generated Study Mode artifact SHALL pass deterministic verification of authorized source IDs, source revision match, normalized quote/anchor validity, assessment structure validity, and safe rendering constraints before persistence.

#### Scenario: Fabricated citation rejected
- **WHEN** a generated explanation cites a quote or chunk ID not present in the authorized source scope
- **THEN** deterministic verification fails with `source_fidelity` failure
- **AND** the artifact is not persisted as verified.

### Requirement: LearnLM Appendix B Pedagogical Rubric
The system SHALL evaluate educational artifacts against the 11-criterion LearnLM Appendix B rubric (`accuracy`, `source_fidelity`, `coverage`, `emphasis`, `engagement`, `cognitive_load`, `active_learning`, `metacognition`, `motivation_curiosity`, `adaptability`, `clarity_of_intentions`) with hard-gate enforcement on `accuracy`, `source_fidelity`, and `assessment_validity`.

#### Scenario: High engagement cannot override factual inaccuracy
- **WHEN** an artifact scores `pass` on `engagement` and `motivation_curiosity` but `fail` on `accuracy` or `source_fidelity`
- **THEN** the overall quality gate outcome SHALL be `fail`
- **AND** any previously valid artifact SHALL be preserved.
