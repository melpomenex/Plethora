## ADDED Requirements

### Requirement: Multi-dimensional proficiency assessment with uncertainty
Placement and adaptive proficiency assessments SHALL maintain separate skill estimates for reading, listening, writing, speaking, vocabulary, and grammar with explicit uncertainty ranges and disclosure that estimates are not accredited CEFR certifications.

#### Scenario: Placement assessment reports dimensional ranges
- **WHEN** a learner completes a placement assessment across vocabulary, reading, and writing tasks
- **THEN** the system returns per-dimension proficiency ranges with confidence/uncertainty and omits untested dimensions as unavailable rather than collapsing to an unsupported single score

### Requirement: Capability-gated voice conversation
Real-time/turn-based spoken AI conversation SHALL be enabled ONLY when genuine speech recognition and AI providers are configured with required user consent, and SHALL preserve transcripts, optional corrections, and playback speed controls.

#### Scenario: Voice conversation disabled without speech recognition
- **WHEN** no local or consented cloud STT provider is available
- **THEN** voice conversation reports unavailable with provider setup guidance and does not simulate voice support with text-only UI
