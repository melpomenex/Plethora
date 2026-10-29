## ADDED Requirements

### Requirement: Progressive local editions retain stable listening identity
Progressive LFM3 editions SHALL persist listening position by edition, source/configuration revision, stable section identity and actual offset. Adding newly ready sections SHALL NOT reset or shift current playback. Shared application playback ownership SHALL preserve the session through tab navigation and route global/platform controls to that session. Reading another document SHALL NOT overwrite its listening position. Cold restart SHALL restore the valid position paused.

#### Scenario: Another chapter completes while listening
- **WHEN** a later section becomes ready while the current section is playing
- **THEN** the playlist SHALL extend while retaining current section identity, offset, rate and listening progress

#### Scenario: Leave source tab and return
- **WHEN** a user navigates elsewhere or closes the edition's reader tab during playback
- **THEN** playback/global controls SHALL remain attached to the same edition and reopening SHALL show its current listening position

#### Scenario: Reopen partially generated edition
- **WHEN** the app restarts with some valid ready sections and a saved offset in one of them
- **THEN** the system SHALL restore that section/offset paused and separately recover generation without autoplay

#### Scenario: Saved section becomes stale or missing
- **WHEN** a saved position references invalid audio after source or asset changes
- **THEN** the system SHALL retain source-anchor provenance and explain the unavailable position rather than seek to an unrelated chapter or silently restart from the beginning
