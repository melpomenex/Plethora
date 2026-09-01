## ADDED Requirements

### Requirement: Generated audio callbacks validate playback epoch
All `HTMLAudioElement` lifecycle callbacks (`onplay`, `onpause`, `onended`, `onerror`) in generated-audio playback SHALL verify `playbackIdRef.current` matches the epoch captured at chunk start before mutating playback state.

#### Scenario: Stale onended after retarget
- **WHEN** chunk 18 audio fires `onended` after playback retargets to chunk 47
- **THEN** auto-advance to chunk 19 does not occur and current playback remains at chunk 47

#### Scenario: Stale onpause after retarget
- **WHEN** orphaned chunk audio fires `onpause` during active chunk 47 playback
- **THEN** UI playing state is not overwritten to paused

### Requirement: Audio handler detachment on cancel
When cancelling generated audio, the system SHALL detach all element event handlers before calling `pause()`.

#### Scenario: cancelAudio detaches handlers
- **WHEN** `cancelAudio` is invoked during retarget
- **THEN** prior audio element handlers are nulled before pause

### Requirement: Legitimate auto-advance preserved
Current-epoch audio completion SHALL still advance to the next chunk exactly once when auto-advance is enabled.

#### Scenario: Normal chunk completion
- **WHEN** the current-epoch audio element ends naturally without retarget
- **THEN** playback advances to the next chunk index

### Requirement: Other TTS engines unchanged
System Web Speech and Android native TTS epoch guards SHALL remain unchanged in behavior.

#### Scenario: System speech epoch guard
- **WHEN** system speech utterance callbacks fire after epoch bump
- **THEN** stale callbacks are ignored per existing guards
