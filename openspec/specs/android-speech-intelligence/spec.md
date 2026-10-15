# android-speech-intelligence Specification

## Purpose
Lectures and imported audio should become ordinary Plethora transcript documents without requiring a cloud STT key when Android on-device speech is available. ML Kit GenAI Speech Recognition (alpha) offers Basic (API 31+, per-locale models) and Advanced (Pixel 10 Nano). Plethora already has whisper/sherpa/Groq — this is another SpeechProvider, not a parallel product.

## Requirements

### Requirement: Lecture transcription is durable
Audio capture SHALL be persisted independently of recognizer success. Finalized segments SHALL be recoverable if the session ends unexpectedly.

#### Scenario: Partial lecture survives failure
- **GIVEN** finalized transcript segments exist on disk/DB
- **WHEN** the session terminates during post-processing
- **THEN** those segments remain
- **AND** the audio recording is not discarded solely because transcription failed

#### Scenario: Provider preference
- **GIVEN** the user selected whisper as STT
- **WHEN** ML Kit Advanced is also available
- **THEN** whisper is used

#### Scenario: Default chain when unset
- **WHEN** no explicit STT preference is set
- **THEN** the system tries Advanced → Basic → existing local → cloud-per-policy
- **AND** does not call cloud if policy forbids it

#### Scenario: PCM requirement
- **WHEN** a non-PCM file is imported
- **THEN** Plethora converts or rejects with `InvalidInput`
- **AND** does not send unsupported codecs to `fromPfd`
