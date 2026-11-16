## Purpose

Enables immediate, seekable playback of local video and media files without requiring upfront whole-file conversion, remuxing, or full-file disk duplication before playback starts.

## ADDED Requirements

### Requirement: Immediate playback without upfront whole-file conversion
The system SHALL begin local video playback immediately without requiring a full-file remux or transcode to complete on disk beforehand.

#### Scenario: Opening an MKV movie with incompatible container or bitmap subtitles
- **WHEN** a user opens a local MKV movie (such as a multi-gigabyte 4K Blu-ray rip with PGS subtitles or unsupported audio)
- **THEN** the player MUST NOT block playback with a full-file "Preparing this video for playback" progress screen
- **AND** playback MUST start within a few seconds using either native playback or on-demand live streaming.

#### Scenario: Re-opening a previously played large local movie
- **WHEN** a user closes and later re-opens a large local media file (including files larger than the compatibility cache limit)
- **THEN** playback MUST start immediately without re-converting the entire file from scratch.

### Requirement: Seekable on-demand streaming for incompatible containers or codecs
When a local video file cannot be played directly by the webview (e.g., unsupported container, bitmap subtitles, unsupported audio codec, or unsupported video codec), the local media server SHALL serve an on-demand, seekable stream that remuxes or transcodes only the active playback window.

#### Scenario: Seeking to an arbitrary timestamp in a streamed movie
- **WHEN** the user seeks to an arbitrary timestamp (e.g., 45 minutes into a 2-hour movie) during on-demand streaming playback
- **THEN** the local media server MUST serve the requested playback window around that timestamp without remuxing or transcoding all preceding media.

#### Scenario: Stopping or closing a streamed video
- **WHEN** the user closes the viewer, switches documents, or cancels playback
- **THEN** any active on-demand streaming transcode/remux worker for that session MUST be terminated promptly and ephemeral segment buffers cleaned up.

### Requirement: No artificial cache-size block for streamed local media
The system SHALL NOT fail or block playback of large local media files due to the compatibility cache size limit (`cacheLimitGb`) when on-demand streaming is used.

#### Scenario: Playing a 50 GB movie with a 25 GB cache limit
- **WHEN** a user opens a 50 GB local video file while `cacheLimitGb` is set to 25 GB
- **THEN** the system MUST NOT reject playback with `cache_limit_too_small`
- **AND** disk usage for ephemeral streaming segments MUST remain bounded to a small rolling window.

### Requirement: Respect user compatibility policy for expensive video transcoding
When a file requires full video re-encoding (e.g., unsupported video codec or HDR-to-SDR tone mapping) and the user's policy is `ask` or `never`, the system SHALL still honor that policy before starting CPU-intensive video transcoding.

#### Scenario: Policy set to Never Convert
- **WHEN** the user's compatibility policy is `never`
- **THEN** the player MUST attempt direct native playback without spawning any FFmpeg remux or transcode worker.

#### Scenario: Remux or audio-only adaptation under Automatic policy
- **WHEN** the user's compatibility policy is `automatic-inexpensive` and a file only needs container remuxing or audio transcoding
- **THEN** on-demand streaming SHALL start automatically without a consent prompt or full-file blocking modal.
