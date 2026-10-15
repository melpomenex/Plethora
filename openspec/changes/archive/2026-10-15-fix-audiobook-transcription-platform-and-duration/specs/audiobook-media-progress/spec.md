## ADDED Requirements

### Requirement: Audiobook media exposes a usable timeline
The audiobook viewer SHALL publish a finite, positive duration and a progressing current time for playable audiobook files, including `.m4b`, to its controls, persistence, parent sync callbacks, and follow-along alignment.

#### Scenario: M4B playback reports duration and current time
- **GIVEN** an `.m4b` audiobook is playable through the local media source
- **WHEN** media metadata loads and playback advances
- **THEN** the viewer SHALL expose a finite duration greater than zero
- **AND** SHALL publish current-time updates greater than zero as playback advances
- **AND** the progress display SHALL no longer remain at `0:00` solely because the container's media duration event was unavailable

#### Scenario: Parsed metadata supplies a temporary duration fallback
- **GIVEN** the media element reports zero, NaN, or Infinity for duration
- **AND** audiobook metadata parsing has returned a finite positive duration
- **WHEN** the viewer initializes controls or reports duration to its parent
- **THEN** the viewer SHALL use the parsed duration as a fallback until a finite media duration is available

### Requirement: Audiobook seeking and persistence use the resolved timeline
The audiobook viewer SHALL clamp seek positions and persisted playback positions to the resolved finite duration and SHALL preserve the current position across the existing playback persistence lifecycle.

#### Scenario: Seek and resume use M4B duration
- **GIVEN** an audiobook has a resolved duration and a saved position within that duration
- **WHEN** the viewer opens and the user seeks or resumes playback
- **THEN** the viewer SHALL use the saved/resolved timeline for the seek target
- **AND** SHALL publish the resulting position to follow-along synchronization
