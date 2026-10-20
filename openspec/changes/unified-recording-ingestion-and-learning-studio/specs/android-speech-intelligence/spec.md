## ADDED Requirements

### Requirement: Android recording and imports share session orchestration
Android recorded and imported audio SHALL use the same durable session/transcription contracts. Native speech SHALL receive bounded validated file/PCM units and SHALL NOT require whole-recording base64. Microphone capture ownership and background recording permissions SHALL remain distinct from file-transcription service capabilities.

#### Scenario: Android long recording
- **WHEN** an Android lecture is finalized and local file transcription is selected
- **THEN** the saved native recording is processed through existing eligible local decoding/transcription with bounded units and the same draft/provenance flow as desktop

#### Scenario: Microphone service not permitted
- **WHEN** background microphone capture is unavailable or permission is revoked
- **THEN** recording safely commits its prefix and reports interruption rather than assuming a file-processing service permits continued capture
