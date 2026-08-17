## ADDED Requirements

### Requirement: Premium TTS is an additive provider tier
Plethora-hosted voices SHALL register as an additional adapter in the existing TTS registry implementing the same provider interface (drop-in for all call sites). All existing providers (pocket, system, android, fal, groq, openrouter, elevenlabs, openai, openai-compatible) and BYO-key flows SHALL remain unchanged and free.

#### Scenario: Free tier unchanged
- **WHEN** a Free user plays TTS with any pre-existing provider
- **THEN** behavior and settings are identical to before this change

#### Scenario: Premium requires capability
- **WHEN** premium voices are selected without `premium_tts`
- **THEN** selection is unavailable with a clear reason and fallback providers remain usable

### Requirement: Long-form generation is chunked, resumable, and quota-metered
`tts_generate` jobs SHALL synthesize per chapter/chunk with checkpoints, per-chunk progress, partial usability (completed chapters playable during generation), resumption after failure without re-generating completed chunks, cancellation retaining completed audio, and character-based quota envelopes with pre-flight estimates and disclosure.

#### Scenario: Resume after failure
- **WHEN** generation fails midway through chapter 3
- **THEN** a retry resumes at the failing chunk and chapters 1–2 remain cached

#### Scenario: Quota pre-flight
- **WHEN** a user generates a full book exceeding the remaining envelope
- **THEN** the job is scoped or rejected with an accurate estimate dialog beforehand

### Requirement: Playback is gapless, positioned, and highlighted
Assembled playback SHALL be gapless at chunk boundaries; playback positions SHALL persist per item (`tts_position`) and restore across sessions/devices-local; premium voices SHALL provide word timestamps enabling karaoke-style synchronized highlighting, with sentence-level fallback via alignment for other voices.

#### Scenario: Position restores
- **WHEN** the user returns to a generated audiobook
- **THEN** playback resumes at the persisted position

#### Scenario: Word highlighting tracks premium audio
- **WHEN** premium audio plays with highlighting enabled
- **THEN** the highlighted word tracks playback using returned timestamps

### Requirement: Offline listening via managed cache
Generated audio SHALL cache locally with an eviction policy and surfaced storage usage; cached content SHALL play fully offline; caches SHALL be per-document and survive app updates.

#### Scenario: Airplane-mode listening
- **WHEN** a fully generated book is played offline
- **THEN** playback completes without network access

### Requirement: Listening queue derives from reading materials
A listening queue SHALL accept documents, extracts, and review sessions, derive from reading-list/queue filters, provide continue-listening, chapter/paragraph navigation, and integrate with existing reading-position surfaces without altering scheduling behavior.

#### Scenario: Queue derives from reading list
- **WHEN** the user enables derivation from their reading queue
- **THEN** listening items mirror the queue order/filter and respect manual reordering

### Requirement: Pronunciation handling is local text transformation
A user pronunciation dictionary (word → phoneme/alias) SHALL apply as a pre-synthesis local transform across providers, with the dictionary stored locally and never synced.

#### Scenario: Acronym expansion
- **WHEN** the dictionary maps "TLB" to "T-L-B"
- **THEN** synthesis speaks the expansion on all providers using the same transform

### Requirement: Privacy rules for premium synthesis
Synthesis text SHALL leave the device only for premium generation with prior disclosure; server artifacts SHALL TTL-delete (default 24h); logs SHALL contain no content; exclusion-flagged documents SHALL be ineligible for cloud synthesis (enforced server- and client-side).

#### Scenario: Excluded document cannot be premium-synthesized
- **WHEN** synthesis is requested for an exclusion-flagged document
- **THEN** the request is refused with reason and local voices remain offered
