## ADDED Requirements

### Requirement: Capability descriptors hide vendor details
Capability descriptors exposed to shared UI SHALL use Plethora concepts (`ready`, `requiresDownload`, `foregroundOnly`, `onDevice`, `supportedLanguages`) and SHALL NOT require React to import Google SDK types.

#### Scenario: Descriptor for unavailable speech
- **GIVEN** an Android API 30 device
- **WHEN** the speech capability is queried (once Agent E implements detection; until then fakes/stubs report unavailable)
- **THEN** the descriptor reports unavailable with a stable reason
- **AND** Record Lecture is not presented as a broken Gemini command

### Requirement: Lightweight local-AI job policy
The system SHALL document and enforce a single in-flight native GenAI inference invariant across plugins, with job classes interactive / normal / maintenance. Maintenance work SHALL yield to interactive user jobs.

#### Scenario: User summary preempts maintenance tagging
- **GIVEN** a maintenance Smart Tagging tier-2 job would use GenAI
- **WHEN** the user starts an interactive summarize
- **THEN** the interactive job is served first or the maintenance job is paused
- **AND** neither job is marked complete if cancelled or foreground-blocked

### Requirement: Provenance for generated artifacts
When Plethora already records `ai_provenance`, generative Android/cloud runs SHALL continue to store provider id, model identity when known, timestamp, and source ids. The system SHALL NOT invent parallel provenance tables. Different Nano versions MAY produce different prose; provenance exists so regeneration and debugging can see which model served the run.

#### Scenario: Model identity recorded when native supplies it
- **WHEN** on-device Prompt returns `baseModelName`
- **THEN** accepted cards/answers store that identity in existing provenance
- **AND** user content is not written to diagnostics logs
