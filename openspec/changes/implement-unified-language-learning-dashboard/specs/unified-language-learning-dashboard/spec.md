## ADDED Requirements

### Requirement: First-class navigable Language Learning dashboard
Plethora SHALL expose a lazy-loaded `language-learning` destination in primary desktop/mobile navigation, Command Palette, and shortcuts, providing a unified profile-scoped workspace with Today overview, Vocabulary Manager, Content & Generation, Practice & Tutor Hub, Analytics, Language Packs, and skippable Guided Onboarding without requiring paid cloud AI.

#### Scenario: New learner completes guided onboarding
- **WHEN** a user opens Language Learning for the first time and completes or skips optional steps in the onboarding wizard
- **THEN** a language profile is created, optional Language Learning mode is enabled, and the user can immediately open recommended or imported target-language content

#### Scenario: Learner manages persistent vocabulary
- **WHEN** a user searches, filters, inspects occurrences, bulk-updates states, imports known words, exports, or deletes entries in the Vocabulary Manager
- **THEN** changes persist per language profile in SQLite without altering unrelated profiles or silently mutating FSRS schedules
