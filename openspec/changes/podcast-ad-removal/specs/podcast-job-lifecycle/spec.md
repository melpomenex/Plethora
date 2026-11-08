## Purpose

Manages the lifecycle of podcast preparation jobs, orchestrating stage transitions, persistent checkpoints, crash resilience, cancellation, and concurrency limits across media inspection, speech-to-text, and ad classification.

## ADDED Requirements

### Requirement: Structured Resumable Preparation Lifecycle
Each podcast episode preparation job SHALL progress through explicit, persistable lifecycle stages, storing checkpoints in SQLite so interrupted jobs resume without repeating completed work.

#### Scenario: Progressing through preparation stages
- **WHEN** an episode preparation job is initiated
- **THEN** the job SHALL transition sequentially through `inspecting_metadata`, `transcribing` (if required), `classifying_ads`, `refining_boundaries`, and `ready`
- **AND** emit IPC events updating the UI with stage identity and percentage progress

#### Scenario: Resuming interrupted job after app crash or process restart
- **WHEN** the application restarts while a preparation job was in progress
- **AND** speech transcription was already completed and saved to `podcast_transcript_segments`
- **THEN** the job runner SHALL NOT re-run speech transcription
- **AND** SHALL resume directly at the ad classification stage from the saved transcript

### Requirement: Single-Flight Job Concurrency and Deduplication
The job coordinator SHALL enforce single-flight concurrency per episode, preventing duplicate parallel transcription or classification runs.

#### Scenario: Multiple triggers for the same episode
- **WHEN** a background auto-process rule and a user tap both attempt to prepare the same episode simultaneously
- **THEN** the coordinator SHALL return the existing active job promise or ID
- **AND** SHALL NOT spawn redundant ASR sidecars or model inference processes

#### Scenario: System-wide background job throttling
- **WHEN** multiple podcast episodes are queued for background preparation
- **THEN** the job manager SHALL process episodes sequentially (concurrency of 1)
- **AND** yield CPU and memory resources whenever active audio playback is playing

### Requirement: Cooperative Cancellation
Every preparation job SHALL support immediate, cooperative cancellation that cleans up temporary files and releases inference runtime handles.

#### Scenario: User cancels in-flight preparation
- **WHEN** a listener clicks "Cancel" on an active preparation job
- **THEN** the cancellation token SHALL signal the active ASR sidecar or classifier to terminate
- **AND** temporary audio and chunk files SHALL be deleted from disk
- **AND** the episode status SHALL transition to `cancelled` without leaving corrupted database records

### Requirement: Atomic Publication of Analysis Results
The results of an episode's advertising analysis (including chapters, transcript status, and skip intervals) SHALL be published in a single atomic database transaction.

#### Scenario: Committing completed analysis
- **WHEN** boundary refinement and interval validation complete successfully
- **THEN** the database transaction SHALL insert `podcast_ad_intervals`, update `podcast_episodes.transcript_status`, and set job status to `ready` within an atomic transaction
- **AND** if any database write fails, the entire transaction SHALL roll back, preventing partial or inconsistent skip maps
