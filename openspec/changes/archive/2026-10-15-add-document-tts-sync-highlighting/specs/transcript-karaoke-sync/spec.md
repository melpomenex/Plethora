## ADDED Requirements

### Requirement: Shared word timing source metadata
Word timing records used for karaoke and document TTS SHALL support a `source` field distinguishing measured alignment from synthesized estimates.

#### Scenario: Synthesized timings marked
- **WHEN** word timings are synthesized from segment duration
- **THEN** each timing SHALL have `source: "synthesized"` and SHALL NOT be persisted as measured data

### Requirement: Shared active-word lookup
Karaoke and document TTS SHALL use the same `findActiveWordIndex` / `nextActiveWordIndex` helpers for playback-clock word selection.

#### Scenario: Consistent word selection
- **WHEN** audio current time falls within a word's timing window
- **THEN** `findActiveWordIndex` SHALL return the same index for karaoke and TTS consumers
