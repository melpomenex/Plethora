## ADDED Requirements

### Requirement: Local transcription remains free and default-capable
whisper.cpp, sherpa-onnx, and BYO Groq transcription SHALL continue to function without subscription and remain the default where they meet the user's language/length needs. Cloud STT SHALL be an additional routed engine requiring the `transcription` capability, metered in audio minutes with pre-flight duration-based estimates.

#### Scenario: Local default for short English audio
- **WHEN** a user imports a 20-minute English recording with defaults
- **THEN** local whisper handles it with no quota interaction

#### Scenario: Cloud estimate precedes job
- **WHEN** a 2-hour lecture is routed to cloud STT
- **THEN** a dialog shows duration, minutes-quota impact, and disclosure before starting

### Requirement: Cloud transcription adds diarization and reach
The cloud tier SHALL support speaker diarization (labeled segments persisted via an additive `speaker` column on `transcript_segments`) and a broader language/model set than local engines, behind provider abstraction.

#### Scenario: Speakers labeled
- **WHEN** a diarized two-speaker transcript returns
- **THEN** segments carry speaker labels renderable as turns in the document view

### Requirement: Transcripts become first-class documents
Generated documents SHALL be ordinary Plethora documents — readable, highlightable, extractable, TTS-eligible, semantically indexed, flashcardable — with timestamp locators preserved so citations and playback jump to media. Source media SHALL remain attached and playable.

#### Scenario: Highlight becomes timestamped citation
- **WHEN** an extract created from a transcript document is later cited by RAG
- **THEN** the citation jumps to the media timestamp

### Requirement: The pipeline is resumable and non-destructive
Long-file jobs SHALL chunk with checkpoints and resume; cancellation and failure SHALL retain media and completed segments; retry SHALL not duplicate segments (unique checkpoint index enforced, extending the existing 084 constraint).

#### Scenario: Failure keeps partial work
- **WHEN** a cloud job fails at 60% of a long file
- **THEN** completed segments persist, media is intact, and retry resumes

### Requirement: Users can correct transcripts
Segment-level editing, speaker rename/merge across a document, and correction propagation to derived citations SHALL be supported. Corrections SHALL NOT silently rewrite original audio or previously created extracts (they update the transcript source; derived objects re-anchor on next interaction).

#### Scenario: Speaker rename propagates
- **WHEN** a user renames "Speaker 2" to "Prof. Chen"
- **THEN** all turns update and the document reflects the label change

### Requirement: YouTube compliance boundary is enforced
Cloud transcription SHALL refuse YouTube-flagged media sources; YouTube ingestion SHALL continue using the existing client-side documented paths only. No cloud download or acquisition features SHALL exist.

#### Scenario: Cloud STT refuses YouTube audio
- **WHEN** a cloud transcription is requested for YouTube-derived media
- **THEN** the request is rejected with a policy reason and local engines are offered

### Requirement: Privacy rules for audio
Audio SHALL leave the device only for cloud STT with prior disclosure; audio SHALL NOT be retained server-side post-job; transcript artifacts SHALL TTL-delete after delivery; logs SHALL contain no content; exclusion flags SHALL apply.

#### Scenario: Audio not retained
- **WHEN** a cloud job completes
- **THEN** the audio artifact is absent from server storage after TTL expiry (fixture-verified)
