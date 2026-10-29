## MODIFIED Requirements

### Requirement: Semantic Section Model and Audio Asset Storage
The system SHALL divide an Audio Edition into ordered `AudioEditionSection` units, each retaining its source section ID, title, anchor boundaries, generation status, duration, local audio asset path, and source-to-audio anchor intervals. Generated sections SHALL become ready only after valid audio is durably published and its manifest/anchors committed. Transient object URLs and native-playback markers SHALL NOT qualify as durable assets. Inference segments SHALL retain checkpoint identity without replacing semantic chapter navigation.

#### Scenario: Section audio asset assignment
- **WHEN** audio synthesis for a section finishes
- **THEN** the system SHALL persist the generated audio file to local app storage, record actual `durationSec`, `audioFilePath`, and `audioMimeType`, commit its anchors, and only then update the section's `generationStatus` to `ready`

#### Scenario: Shutdown during audio publication
- **WHEN** the app terminates during file writing, rename or manifest commit
- **THEN** restart SHALL either recover a fully committed valid section or leave it recoverable/nonready, without treating partial output as ready

#### Scenario: Ready file missing after restart
- **WHEN** a section claims ready but its durable asset is missing or invalid
- **THEN** the system SHALL report recoverable missing audio and retain source identity/bookmarks without pretending the section can play

### Requirement: Document Revision and Stale Section Tracking
The system SHALL calculate and store a cryptographic content hash for the source document and each semantic section. When the source document is modified, the system SHALL identify modified sections, mark their audio stale, and retain unchanged sections and valid bookmarks. A pending generation result SHALL commit only against its original current source/configuration plan and epoch.

#### Scenario: Source document content updated
- **WHEN** a document with an existing Audio Edition is edited
- **THEN** the system SHALL compare new section content hashes against the stored Audio Edition manifest, mark only altered sections as `stale`, and preserve valid completed sections without regenerating them

#### Scenario: Source changes while old synthesis completes
- **WHEN** a source section changes before its prior generation result commits
- **THEN** the obsolete result SHALL NOT mark the modified section ready and unchanged valid sections SHALL remain reusable

## ADDED Requirements

### Requirement: Local edition narration provenance is immutable and complete
An LFM3 edition SHALL identify source document/revision and stable section ranges; model repository/immutable revision and artifact hashes/quantization; runtime/backend compatibility profile; voice, locale and generation/normalization/segmentation configuration; text hash; output asset identity/format/duration; and alignment precision. Defaults changed later SHALL NOT alter an existing edition's narrator. Existing manifests lacking new metadata SHALL remain readable and their audio playable when valid.

#### Scenario: Change default narrator during a book job
- **WHEN** the global LFM3 voice, language, model or generation defaults change during edition generation
- **THEN** that edition SHALL retain its original narration snapshot and SHALL NOT mix new narrator settings into later chapters

#### Scenario: Legacy manifest opened
- **WHEN** an older edition lacks new provenance/precision fields
- **THEN** its valid audio SHALL remain playable and unlabeled approximate anchors SHALL NOT be interpreted as measured word alignment

### Requirement: Permanent audio has explicit storage and deletion ownership
Permanent generated audio SHALL survive disposable cache eviction and model removal. Storage UI SHALL distinguish model weights, disposable cache and permanent edition audio. Deleting generated audio SHALL retain the source document and unrelated media, cancel/tombstone in-flight work and protect active file leases until playback retires. Crash-orphan cleanup SHALL be bounded to app-owned unreferenced assets.

#### Scenario: Cache clear and model uninstall
- **WHEN** a user clears TTS cache and uninstalls LFM3 after an edition is generated
- **THEN** its permanent audio SHALL remain playable without inference or another download

#### Scenario: Delete while generation finishes
- **WHEN** the user deletes an edition while a section is generating
- **THEN** late completions SHALL NOT recreate the edition and cleanup SHALL remove only its unleased generated assets while retaining the source document

#### Scenario: Delete currently playing edition
- **WHEN** an edition being played is deleted
- **THEN** the common playback owner SHALL retire the source and release its asset lease before final file removal
