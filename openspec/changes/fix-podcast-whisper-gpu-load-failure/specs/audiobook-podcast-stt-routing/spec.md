## ADDED Requirements

### Requirement: Podcast Transcription Failure Offers a Recovery Path
The podcast transcription route SHALL NOT present a local engine failure as a
terminal dead end. When a podcast transcription fails after the engine's own
recovery attempts have been exhausted, the system SHALL surface a diagnostic
category and SHALL offer at least one applicable recovery action: re-running
the episode with the compute accelerator disabled, or routing the episode to a
configured cloud provider. The raw engine log SHALL NOT be the message shown to
the user, and the failure SHALL still be recorded on the episode so a later
attempt and the support log can see it.

#### Scenario: Podcast view shows a recovery action, not a raw log
- **WHEN** a podcast episode transcription fails locally and no in-engine
  fallback succeeded
- **THEN** the podcast view SHALL display the classified failure category with a
  short explanation
- **AND** SHALL NOT display the engine's raw startup log as the failure message

#### Scenario: User can retry the episode without the accelerator
- **WHEN** the podcast transcription fails because the local compute backend
  failed
- **THEN** the podcast view SHALL offer a retry action that re-runs the episode
  with the compute accelerator disabled

#### Scenario: Cloud recovery is offered only when it is available
- **WHEN** the podcast transcription fails and the user has a configured cloud
  speech-to-text provider
- **THEN** the podcast view SHALL offer to transcribe the episode with that
  provider instead
- **AND** SHALL NOT offer cloud transcription when no provider is configured

#### Scenario: Failure remains recorded on the episode
- **WHEN** a podcast episode transcription fails
- **THEN** the episode SHALL be left in the failed state with a recorded reason
  so the failure is not silently discarded when the user navigates away

#### Scenario: A successful fallback clears the failed state
- **WHEN** a podcast episode transcription that previously failed is retried via
  an offered recovery action and completes
- **THEN** the episode SHALL be left in the completed state with the new
  transcript, and the previous failure reason SHALL no longer be shown

### Requirement: Automatic Podcast Transcription Does Not Loop After Failure
The podcast transcript panel SHALL start a transcription automatically only
while no transcription has been attempted yet for the episode. After an
automatic attempt has failed, the panel SHALL NOT start another automatic
attempt for the same episode, and SHALL wait for an explicit user action.

#### Scenario: A failed automatic attempt does not re-trigger itself
- **WHEN** an automatically started podcast transcription fails and the
  transcript panel re-evaluates whether to start one
- **THEN** the panel SHALL NOT start another transcription for that episode
- **AND** SHALL NOT re-download the episode audio a second time

#### Scenario: Reopening the panel after a failure does not retry
- **WHEN** the user closes and reopens the transcript panel for an episode whose
  last transcription attempt failed
- **THEN** the panel SHALL show the failure and the available recovery actions
  rather than starting a new attempt

#### Scenario: An episode with no attempt yet still starts automatically
- **WHEN** the transcript panel is opened for an episode that has no transcript
  and no recorded attempt
- **THEN** the panel SHALL start a transcription automatically as it does today