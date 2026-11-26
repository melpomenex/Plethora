# Source-Grounded Multimodal Learning Views Specification

## ADDED Requirements

### Requirement: On-Demand Source-Grounded Multimodal Representations
Mind maps, timelines/diagrams, conversational audio lessons, and narrated slide decks SHALL be generated strictly on demand, verified against the canonical source scope, rendered deterministically without executing model-generated HTML/JS, and SHALL NOT silently mutate the user's personal Knowledge Graph or mastery state.

#### Scenario: Audio lesson completion does not grant mastery
- **WHEN** a learner listens to a complete conversational audio lesson
- **THEN** playback progress is saved without recording concept mastery in `learning_evidence`.

#### Scenario: Mind map does not auto-mutate personal Knowledge Graph
- **WHEN** a source-scoped educational mind map is generated
- **THEN** unendorsed AI relationships remain scoped to the Study Mode artifact until explicitly promoted by the user.
