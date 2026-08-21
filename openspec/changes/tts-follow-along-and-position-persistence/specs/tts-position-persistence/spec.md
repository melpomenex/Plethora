## ADDED Requirements

### Requirement: TTS listening position is saved during playback and on stop/pause
The system SHALL persist the exact TTS listening position so the user resumes from where they actually stopped listening, not from where TTS began. The existing `src/utils/ttsListeningPosition.ts` module SHALL be wired into production (it currently has zero production callers). Save triggers SHALL be: throttled (the module's existing 4 s throttle) during active playback; and an immediate flush (`flush: true`) on pause, stop, component unmount, page unload, document navigation away, and before Queue advancement to the next item.

#### Scenario: Position is saved while listening and flushed on pause
- **WHEN** playback is active at segment 51 and the user pauses
- **THEN** a TTS listening position record SHALL be written (or flushed immediately) encoding segment 51, the current word index, and intra-chunk audio offset for the current document

#### Scenario: Position is saved on application close
- **WHEN** the user closes the application while TTS is paused or playing
- **THEN** the latest position SHALL be flushed before the process exits (unmount/unload flush), so a later restart can resume

#### Scenario: Queue advancement flushes the position
- **WHEN** TTS completes or advances from the current document to the next Queue item
- **THEN** the completed document's listening position SHALL be flushed before the new document begins

### Requirement: TTS listening position is restored on return
The persisted TTS listening position SHALL be used as the "saved position" (level 4) in the existing `resolveStartPosition` priority chain in `ReaderTTSControls`, so returning to a document (within the same session or after app restart) resumes from the persisted position rather than the document start. When a reconciled saved position exists and the live viewport anchor resolves to an EARLIER position in the document, the saved position SHALL win over the earlier viewport (the user manually scrolled away after TTS advanced past the viewed page); a viewport that resolves at or after the saved position SHALL win (the normal follow-sync case). Explicit queued anchors (level 1) SHALL continue to win over both.

#### Scenario: Resume after reopening the same document
- **WHEN** the user had listened to segment 51 of a document, closed it, closed Plethora, reopened Plethora, and reopened that document
- **THEN** starting TTS SHALL resume from the persisted position (near segment 51), not from the document start

#### Scenario: Return after navigating elsewhere
- **WHEN** the user had listened to segment 51, navigated away to another view/document, then returned to the original document
- **THEN** starting TTS SHALL resume from the persisted position (near segment 51)

#### Scenario: Saved position wins over an earlier viewport after manual scroll-away
- **WHEN** TTS had advanced narration to segment 51, the user manually scrolled the reading viewport back to segment 5, closed and reopened the document, and starts TTS
- **THEN** TTS SHALL resume from the saved position (segment 51), not from the earlier viewport segment 5

#### Scenario: A viewport at/after the saved position wins
- **WHEN** the user had listened to segment 51 and the reading viewport resolves at or after segment 51 on return
- **THEN** TTS SHALL resume from the resolved viewport position (the normal follow-sync case), not jump back to the saved position

### Requirement: Persisted position distinguishes TTS position from reading position
The system SHALL persist the TTS listening position as its own record (the `TTSListeningPosition` shape: document id, text fingerprint, chunk index, word index, intra-chunk ms, normalized char offset, surrounding text, stable anchor/cfi/page, provider/model/voice) and SHALL NOT overwrite or depend on the visual reading position persistence (existing `ViewState` / `get_document_position`). When TTS has advanced beyond the user's last manually viewed page, the TTS position SHALL be the meaningful resume location for TTS.

#### Scenario: TTS advanced past the viewed page
- **WHEN** the user read page 5 manually but TTS has advanced narration to segment 51 (corresponding to a later location) and the user stops and later returns to resume TTS
- **THEN** TTS SHALL resume from the persisted TTS position (segment 51) rather than page 5

#### Scenario: TTS and reading positions are independent
- **WHEN** the user reads ahead manually without starting TTS
- **THEN** no TTS listening position SHALL be written, and the reading position SHALL continue to be governed by the existing visual-position persistence

### Requirement: Document changes and regenerated TTS state are handled
The persisted position SHALL be reconciled against the current document text via `textFingerprint`. If the document text changed such that the exact anchor no longer resolves, the system SHALL fall back to the nearest resolvable position (or the document start of the relevant chapter) rather than failing.

#### Scenario: Document regenerated between sessions
- **WHEN** the persisted listening position's `textFingerprint` does not match the current document text
- **THEN** the system SHALL attempt to resolve the position by nearest anchor; if none resolves, TTS SHALL start at the beginning of the nearest resolvable section and SHALL NOT error

#### Scenario: Fingerprint matches and exact word resolves
- **WHEN** the persisted `textFingerprint` matches the current document and the chunk/word resolves
- **THEN** TTS SHALL resume at that exact chunk and word

### Requirement: Persistence is keyed per document and namespaced per profile
The persistence SHALL use the existing profile namespace (`plethora_user`) and per-document keying of `ttsListeningPosition.ts` (IndexedDB `plethora-tts-positions-db` with a localStorage fallback), so multiple documents and multiple profiles do not collide.

#### Scenario: Two documents keep independent positions
- **WHEN** the user listens to document A to segment 51 and document B to segment 3
- **THEN** resuming document A starts at segment 51 and resuming document B starts at segment 3