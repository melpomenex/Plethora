## ADDED Requirements

### Requirement: LFM3 reuses existing anchored read-aloud controls
LFM3 SHALL integrate through existing read-aloud dispatch, segmentation, start
anchors, focus and playback controls. The new provider SHALL NOT require a new
playback owner or global rollout. It SHALL omit measured word timing unless such
alignment is actually available and preserve current stale-result protections.

#### Scenario: Read from the current selection
- **WHEN** a user starts LFM3 narration from the reader's resolved selection or visible position
- **THEN** normal anchored segmentation SHALL supply the requested source text to the adapter

#### Scenario: Stop or retarget narration
- **WHEN** the user stops or changes reading location during synthesis
- **THEN** obsolete output SHALL NOT play or advance the new reading session
