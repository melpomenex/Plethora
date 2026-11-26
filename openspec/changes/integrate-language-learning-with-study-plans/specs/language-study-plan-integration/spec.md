## ADDED Requirements

### Requirement: Optional Language Profile linkage on Study Plans
Study Plans SHALL accept an optional `language_profile_id`, `target_proficiency`, and language focus metadata, incorporating profile vocabulary, coverage, generated content, practice exercises, and flashcards while keeping standalone immersive study independent and rejecting non-instructional TOC/bibliography prerequisites.

#### Scenario: Learner creates a Spanish Study Plan
- **WHEN** a learner creates a Study Plan linked to a Spanish profile with library documents and vocabulary targets
- **THEN** the plan persists the `language_profile_id`, grounds activities and assessments in source documents without TOC/bibliography prerequisites, and adapts remediation from measured practice/assessment evidence
