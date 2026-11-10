## Purpose

Enable reliable authenticated YouTube video and transcript ingestion using custom cookie files, provide preflight runtime diagnostics, and stabilize playlist settings.

## ADDED Requirements

### Requirement: Custom YouTube cookies.txt file authentication
The system SHALL support configuring an exported Netscape-format `cookies.txt` file path in Settings. When configured, `yt-dlp` commands SHALL execute with `--cookies <path>` to access age-restricted or subscriber-only content.

#### Scenario: Ingesting an age-restricted YouTube video
- **GIVEN** a configured and valid `cookies.txt` file path in Settings
- **WHEN** the user imports an age-restricted YouTube URL
- **THEN** `yt-dlp` SHALL execute with the `--cookies` argument
- **AND** the transcript and metadata SHALL be successfully fetched without sign-in block errors

### Requirement: YouTube runtime health diagnostics
The system SHALL probe `yt-dlp` binary version age and JavaScript engine availability. When `yt-dlp` is older than 90 days or no JavaScript engine is found, the system SHALL surface an advisory banner with remediation instructions.

#### Scenario: Detecting outdated yt-dlp binary
- **GIVEN** a system where `yt-dlp` was released more than 90 days ago
- **WHEN** the user opens Media Settings or attempts a YouTube import
- **THEN** the system SHALL display an advisory notice recommending an update to prevent `n-sig` extraction failures

### Requirement: Disambiguated video extract states
The system SHALL record separate timestamps for opening/viewing a video extract (`last_viewed_at`) and rating it in review (`last_reviewed_at`). Opening an extract SHALL transition it from `New` to `Seen`, but SHALL NOT classify it as `Reviewed`.

#### Scenario: Watching a video extract without rating
- **GIVEN** a video extract with status `New`
- **WHEN** the user opens and plays the video extract for 10 seconds
- **THEN** `last_viewed_at` SHALL be populated
- **AND** the status SHALL update to `Seen`
- **AND** the extract SHALL NOT be marked `Reviewed` until rated in a review session
