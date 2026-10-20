## ADDED Requirements

### Requirement: Canonical session transcript metadata
Recording-session transcription SHALL preserve stable segment identity, canonical source order, optional measured/imported timing, available confidence, speakers and valid word timing across providers. A readable document projection SHALL NOT replace structured metadata. Missing metadata SHALL remain absent.

#### Scenario: Native and desktop parity
- **WHEN** an Android and desktop session produce normalized segment results
- **THEN** both persist the same source contract and support the same downstream actions without platform-specific learning records

#### Scenario: Untimed result
- **WHEN** an eligible recognizer returns text without valid alignment
- **THEN** text is retained as untimed and source navigation uses paragraph/section/document precision without invented measured timestamps

### Requirement: Transcript reuse and corrections preserve identity
Existing valid transcripts SHALL be reused without unnecessary retranscription. Corrections SHALL version canonical text and invalidate affected derived suggestions/index locations while retaining accepted source snapshots and stable document identity.

#### Scenario: Import already transcribed media
- **WHEN** an existing session source is reopened with a valid transcript
- **THEN** no new transcription is started unless the user explicitly requests it
