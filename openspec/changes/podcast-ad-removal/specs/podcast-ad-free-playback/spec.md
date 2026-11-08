## Purpose

Defines non-destructive, ad-aware audio playback within Plethora's audio controller, ensuring that detected advertisement intervals are bypassed before audio output becomes audible while preserving original media coordinates and user control.

## ADDED Requirements

### Requirement: Preemptive Ad Skipping Without Audible Leakage
The audio playback controller SHALL evaluate active advertisement skip intervals before submitting audio decoded frames to hardware output, guaranteeing that listeners do not hear the onset of an advertisement break.

#### Scenario: Playhead approaching a mid-roll advertisement
- **WHEN** audio playback position reaches a lookahead guard threshold (between 50ms and 150ms) prior to the start timestamp of an active skip interval
- **THEN** the audio controller SHALL execute a seek directly to the interval's end timestamp
- **AND** decoded audio from within the advertisement interval SHALL NOT be rendered through the audio output device

#### Scenario: Starting playback at episode beginning with pre-roll advertisement
- **WHEN** an episode begins playback and an active advertisement interval starts at time zero or within the first 3 seconds
- **THEN** the audio controller SHALL seek to the end timestamp of the pre-roll interval before transitioning the audio engine state to playing
- **AND** the listener SHALL hear episode content starting immediately after the pre-roll ad without initial advertisement sound

#### Scenario: User seeking directly into an advertisement interval
- **WHEN** the listener initiates a manual scrub or seek whose target position falls inside an active skip interval
- **THEN** the playback controller SHALL advance the seek target to the interval's end timestamp
- **AND** the controller SHALL emit a brief notification that an advertisement interval was bypassed

### Requirement: Original-Media Coordinate Preservation
All playback timelines, elapsed durations, transcript word timings, chapter positions, and bookmark anchors SHALL remain strictly anchored to original unedited media coordinates.

#### Scenario: Reversible clean-duration display
- **WHEN** ad removal is active and the player displays progress
- **THEN** the player SHALL compute clean progress and remaining time by subtracting active skip durations from total duration
- **AND** seeking, chapter clicks, and transcript lookups SHALL map directly to original media timestamps without timeline distortion

#### Scenario: Extract and bookmark anchoring integrity
- **WHEN** a user creates an extract, highlight, or bookmark while listening to an ad-skipped episode
- **THEN** the recorded timestamp SHALL match the exact original media second
- **AND** the extract SHALL retain its correct playback position even if ad skip rules are subsequently modified or disabled

### Requirement: Reversible Ad Replay and Temporary Override
The user SHALL have instantaneous access to replay any skipped advertisement segment, temporarily suspending automatic skipping for that specific playback segment.

#### Scenario: Undoing an automatic advertisement skip
- **WHEN** an advertisement interval is automatically skipped and the user taps "Replay Skipped Segment" or the undo toast within 10 seconds
- **THEN** the audio controller SHALL seek back to the start of the skipped interval
- **AND** the controller SHALL play the interval continuously without re-triggering the automatic skip during that play pass

#### Scenario: Resuming automatic skip policy after replay
- **WHEN** the user has replayed a skipped segment and playback progresses past the interval's end timestamp into normal content
- **THEN** the audio controller SHALL re-arm the automatic skip policy for subsequent advertisement intervals in the episode

### Requirement: Persistent Skip Map Storage and Invalidation
The application SHALL persist validated skip maps in local SQLite storage, reloading them across application launches and invalidating them only when source media revisions change.

#### Scenario: Resuming playback after app restart
- **WHEN** the application is closed and reopened
- **THEN** the player SHALL reload the persisted skip map for the active episode from SQLite within 50 milliseconds
- **AND** ad-aware playback SHALL remain active immediately without requiring re-classification

#### Scenario: Source media URL or hash change
- **WHEN** a podcast feed provides an updated audio enclosure URL or modified file length for an existing episode GUID
- **THEN** the system SHALL mark the existing skip map as stale
- **AND** the system SHALL prompt or schedule re-validation before applying old skip boundaries to the new audio file

### Requirement: Manual Ad Boundary Correction
The system SHALL allow users to manually mark missed advertisements, adjust boundary timestamps, or restore falsely classified content, storing corrections with highest precedence over automated classifications.

#### Scenario: User marking a missed advertisement break
- **WHEN** the listener identifies an unclassified advertisement and selects "Mark as Advertisement"
- **THEN** the system SHALL create a manual interval record in `podcast_ad_corrections`
- **AND** the player SHALL immediately apply the new interval to active playback and persist it to the episode's skip map

#### Scenario: Restoring falsely detected content
- **WHEN** the listener marks a skipped interval as "Not an Ad"
- **THEN** the system SHALL record an exclusion override in `podcast_ad_corrections`
- **AND** the interval SHALL NOT be skipped during future playback runs of that episode
