# Spec Delta: transcript-karaoke-sync

## MODIFIED Requirements

### Requirement: Language sentence alignment reuses karaoke timing

Language sentence/audio alignment SHALL reuse current transcript/karaoke timing where it is valid, adding source-anchor/profile-aware sentence replay without changing normal karaoke behavior when Language Mode is inactive.

#### Scenario: Normal transcript playback
- **WHEN** a transcript is played without Language Mode
- **THEN** existing karaoke highlighting and playback remain unchanged

### Requirement: Confidence-safe language replay

Language replay MUST use a current validated sentence/media mapping or return a typed fallback; it SHALL not seek to an unrelated occurrence when timing/text confidence is insufficient.

#### Scenario: Ambiguous sentence
- **WHEN** two transcript candidates match a sentence with low confidence
- **THEN** language replay reports ambiguous/unavailable or uses explicit TTS fallback rather than guessing
