## ADDED Requirements

### Requirement: Paired audiobook and EPUB share one playback lifecycle
The system SHALL open a paired audiobook and EPUB in the split follow-along view while allowing the audiobook viewer to own local source preparation, media-server URL resolution, duration, seeking, and playback events.

#### Scenario: Desktop M4B pairing uses the prepared playable source
- **GIVEN** a desktop Tauri app has an audiobook with an `.m4b` file and a paired EPUB
- **WHEN** the user opens the pair in the follow-along view
- **THEN** the paired view SHALL mount the audiobook viewer without overriding its resolved audio source
- **AND** the audiobook viewer SHALL use the prepared/range-capable playback source before reporting playback progress

### Requirement: Follow-along alignment is discovered and reused
The system SHALL load an applicable transcript and alignment map for the audiobook/EPUB pair, compute an alignment when no usable cached map exists, and persist a successful map for subsequent opens.

#### Scenario: First open computes and caches alignment
- **GIVEN** the audiobook has a transcript and the EPUB has extractable speech sections
- **AND** no valid cached alignment exists for the current pair/content fingerprint
- **WHEN** the pair is opened
- **THEN** the system SHALL compute chapter/word alignment
- **AND** it SHALL activate the map for playback
- **AND** it SHALL persist the map keyed so it can be reused for the same pair and content

### Requirement: Aligned playback highlights words and supports text-to-audio navigation
When an active alignment map provides word locators, the system SHALL highlight the word corresponding to the current audiobook position in the EPUB and SHALL seek the audiobook when the user selects an aligned EPUB word.

#### Scenario: Audio time updates the EPUB highlight
- **GIVEN** an active alignment maps an audiobook time to an EPUB chapter, character offset, and word span
- **WHEN** the audiobook current time enters that word span
- **THEN** the EPUB renderer SHALL remove the prior sync highlight
- **AND** SHALL highlight the mapped word in the correct EPUB document
- **AND** SHALL scroll the word into view when the target chapter changes or the word is outside the visible region

#### Scenario: Selecting a highlighted word seeks audio
- **GIVEN** an aligned EPUB word has an audiobook start and end time
- **WHEN** the user selects that word in the EPUB
- **THEN** the audiobook SHALL seek to the aligned start time
- **AND** the active word state SHALL update from the new media position

### Requirement: Follow-along degrades safely when word alignment is unavailable
The system SHALL retain segment-level synchronization when word alignment is unavailable or below the established confidence threshold, and SHALL not present low-confidence word alignment as exact.

#### Scenario: Low-confidence alignment uses segment sync
- **GIVEN** an audiobook transcript is available but the alignment confidence is below the word-sync threshold
- **WHEN** the pair is played
- **THEN** the split view SHALL keep segment-level progress synchronization
- **AND** it SHALL avoid treating the low-confidence map as authoritative word-level navigation
