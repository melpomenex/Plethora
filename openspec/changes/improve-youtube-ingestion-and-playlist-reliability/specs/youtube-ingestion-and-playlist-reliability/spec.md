## Purpose

Enable reliable authenticated YouTube video and transcript ingestion using custom cookie files, provide preflight runtime diagnostics, and stabilize playlist settings.

## ADDED Requirements

### Requirement: Custom YouTube cookies.txt file authentication
The system SHALL support configuring an exported Netscape-format `cookies.txt` file path in Settings. For authorized imports the configured valid cookie source SHALL be available after restart to metadata, playlist and transcript commands. Diagnostic output SHALL omit credentials and cookie paths.

#### Scenario: Ingesting an age-restricted YouTube video
- **GIVEN** a configured and valid `cookies.txt` file path in Settings
- **WHEN** the user imports an age-restricted YouTube URL
- **THEN** `yt-dlp` SHALL execute with the `--cookies` argument
- **AND** the application SHALL distinguish authorized success from authentication denial, unavailable media and runtime failure

### Requirement: YouTube runtime health diagnostics
The system SHALL probe `yt-dlp` binary version age and JavaScript engine availability. When `yt-dlp` is older than 90 days or no JavaScript engine is found, the system SHALL surface an advisory banner with remediation instructions.

#### Scenario: Detecting outdated yt-dlp binary
- **GIVEN** a system where `yt-dlp` was released more than 90 days ago
- **WHEN** the user opens Media Settings or attempts a YouTube import
- **THEN** the system SHALL display an advisory notice recommending an update to prevent `n-sig` extraction failures

### Requirement: Playlist defaults persist and apply to new imports

Playlist default interval and priority SHALL persist after successful save and SHALL seed newly created subscriptions. Future imports SHALL use the active subscription configuration. A failed save SHALL retain the draft and last confirmed values.

#### Scenario: Restart after editing playlist defaults

- **WHEN** the user updates defaults, restarts, creates a subscription and imports one of its videos
- **THEN** the newly imported item uses the saved defaults while earlier items retain their state
