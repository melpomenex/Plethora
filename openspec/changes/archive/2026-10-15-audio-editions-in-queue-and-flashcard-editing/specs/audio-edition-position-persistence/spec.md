## Purpose

Persists and restores the user's exact playback position within an Audio Edition across app sessions, multi-part section boundaries, and device restarts.

## ADDED Requirements

### Requirement: Exact Audio Edition playback location persistence

The system SHALL track and persist the user's current playback location within an Audio Edition, including the active section index (`partIndex`), elapsed time within that section (`timeInPart`), cumulative playback timestamp (`globalTimeSec`), total duration, and modification timestamp. The Audio Edition listening position SHALL be stored independently from visual reading positions (such as EPUB CFI or page numbers) so that reading the text document does not corrupt or overwrite audio playback progress.

#### Scenario: User pauses playback in multi-part edition
- **WHEN** the user is listening to an Audio Edition, reaches halfway through part 2 (section index 1), and pauses or stops playback
- **THEN** the system persists the position recording partIndex 1 and the elapsed time within part 2
- **AND** the cumulative global seconds and last updated timestamp are updated

#### Scenario: Periodic auto-save during continuous playback
- **WHEN** an Audio Edition is actively playing
- **THEN** the playback position is persisted periodically at least every 5 seconds
- **AND** the latest position is flushed immediately on component unmount or window unload

#### Scenario: Position persistence on section jump
- **WHEN** the user seeks to a different chapter or jumps directly to another section
- **THEN** the system updates the persisted position with the new section index and initial seek offset

### Requirement: Seamless multi-part Audio Edition resume

When the user launches or reopens an Audio Edition, the system SHALL automatically load the saved position once the edition playlist is initialized, set the active part to the saved `partIndex`, resolve the audio source for that section, and seek playback to `timeInPart`.

#### Scenario: Resuming playback from library or player
- **WHEN** the user selects "Listen to Audio Edition" for a document with an existing saved position halfway through part 2
- **THEN** the player opens and loads section 2 (index 1)
- **AND** playback seeks directly to the saved offset within part 2 rather than restarting from the beginning of part 1

#### Scenario: Explicit restart from beginning
- **WHEN** the user explicitly selects "Listen from Beginning" from the options menu
- **THEN** the player resets playback to section index 0 and 0.0 seconds
- **AND** begins playback from the start of the entire Audio Edition

### Requirement: Listening progress reporting

The system SHALL compute listening progress as a percentage derived from cumulative elapsed audio seconds divided by total edition duration, and display this progress indicator on Audio Edition cards in the library and queue views.

#### Scenario: Viewing Audio Edition cards in Audiobooks tab
- **WHEN** an Audio Edition has saved listening progress
- **THEN** the card displays the listening progress bar and percentage alongside the total audio duration
- **AND** distinguishes completed listening from in-progress listening
