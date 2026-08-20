# Spec Delta: transcript-karaoke-sync

## MODIFIED Requirements

### Requirement: Language annotations do not alter karaoke semantics

When Video Language Mode is active, language-state annotations/translation SHALL coexist with current karaoke sentence/word timing and MUST NOT replace the existing timing source or playback state machine.

#### Scenario: Current word with Learning state
- **WHEN** karaoke reaches a Learning word
- **THEN** the transcript can show both active karaoke emphasis and language state without changing seek/playback semantics
