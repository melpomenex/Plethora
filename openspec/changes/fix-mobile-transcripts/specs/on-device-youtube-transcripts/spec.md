## ADDED Requirements

### Requirement: On-device transcript fetching without a yt-dlp subprocess

The Rust backend SHALL provide a YouTube transcript fetcher that runs entirely in-process, using an HTTP client against YouTube's Innertube and caption-track endpoints, with no external binary, no Python runtime, and no subprocess spawn. This fetcher SHALL be compiled into Android, iOS, macOS, Windows, and Linux builds.

#### Scenario: Native mobile build resolves a transcript locally

- **WHEN** the app runs as a native Android or iOS build and the frontend requests a transcript for a video with public captions
- **THEN** the Rust backend fetches the caption track directly over the device's own network connection and returns timed segments without contacting `readsync.org`, the VPS, or the Mac mini relay

#### Scenario: No subprocess is spawned

- **WHEN** the on-device fetcher runs on any platform
- **THEN** it completes without invoking `yt-dlp`, `python`, or any other external process, and its success does not depend on `check_ytdlp` reporting an installed binary

#### Scenario: Desktop keeps working when yt-dlp is absent

- **WHEN** the app runs on desktop, `yt-dlp` is not installed, and a transcript is requested
- **THEN** the on-device fetcher serves the request and the user is not shown a "yt-dlp not found" error

### Requirement: Language selection and track preference

The on-device fetcher SHALL accept an optional language code and select a caption track by preferring, in order: an exact language match, a prefix match on the primary subtag (e.g. `en` matching `en-US`), a manually authored track over an auto-generated one at the same language rank, and finally the first available track.

#### Scenario: Exact language requested

- **WHEN** a transcript is requested with language `de` and the video offers `en`, `de`, and `fr` tracks
- **THEN** the returned segments come from the `de` track and the response reports `language` as the selected track's code

#### Scenario: Prefix match

- **WHEN** a transcript is requested with language `en` and the video offers only `en-US` and `es`
- **THEN** the `en-US` track is selected

#### Scenario: Manual track preferred over auto-generated

- **WHEN** the video offers both a creator-authored `en` track and an auto-generated `en` track
- **THEN** the creator-authored track is selected

#### Scenario: No language requested

- **WHEN** a transcript is requested with no language code
- **THEN** the fetcher applies the app's configured default transcript language, falling back to the first available track if no configured language is present

### Requirement: Segment normalization

The on-device fetcher SHALL return segments in the same shape already produced by the existing transcript path — an ordered list of `{ text, start, duration }` with `start` and `duration` in seconds — with HTML entities decoded, inline markup tags stripped, and consecutive exact-duplicate cue texts collapsed.

#### Scenario: Segments match the existing contract

- **WHEN** the on-device fetcher returns a transcript
- **THEN** each segment has a non-empty `text`, a non-negative `start`, and a non-negative `duration`, and segments are ordered by ascending `start`

#### Scenario: Rolling auto-caption duplicates collapsed

- **WHEN** the caption track is an auto-generated rolling track whose consecutive cues repeat the previous cue's text verbatim
- **THEN** the repeated cue is omitted rather than emitted as a duplicate segment

### Requirement: Typed failure classification

The on-device fetcher SHALL classify every failure into one of the following outcomes and return it as structured data rather than an opaque string: `NoCaptions`, `PoTokenRequired`, `AgeRestricted`, `SignInRequired`, `VideoUnavailable`, `RateLimited`, `Network`, or `Unknown`.

#### Scenario: Video has no caption tracks

- **WHEN** the Innertube player response contains no caption tracks for the video
- **THEN** the fetcher returns `NoCaptions` and does not retry

#### Scenario: Caption endpoint is proof-of-origin gated

- **WHEN** the selected caption track URL is gated behind a proof-of-origin token, indicated by a gating marker on the track URL or by an empty `200` response body from the caption endpoint
- **THEN** the fetcher returns `PoTokenRequired`

#### Scenario: Device is offline

- **WHEN** the device has no network connectivity at request time
- **THEN** the fetcher returns `Network` and does not report it as a missing-captions condition

### Requirement: Transcript caching parity

The on-device fetcher SHALL write successful results to the same local transcript store used by the existing path, keyed by video ID, so that a subsequent request for the same video is served from cache without a network call.

#### Scenario: Second request served from cache

- **WHEN** a transcript for a video is fetched on-device and the same video is requested again
- **THEN** the cached transcript is returned and no HTTP request to YouTube is made

#### Scenario: Failures are not cached

- **WHEN** an on-device fetch fails with any outcome other than `NoCaptions`
- **THEN** no cache entry is written and a later request retries the fetch

### Requirement: Availability reporting

The backend SHALL expose a command reporting whether the on-device fetcher is available on the current platform and build, so the frontend can select a source chain without attempting a call that is guaranteed to fail.

#### Scenario: Frontend queries availability

- **WHEN** the frontend queries on-device transcript availability on a native Android build
- **THEN** the backend reports it as available, along with the platform identifier

#### Scenario: Non-Tauri client

- **WHEN** the app runs as a browser PWA with no Tauri backend
- **THEN** the frontend treats the on-device fetcher as unavailable without invoking a Tauri command
