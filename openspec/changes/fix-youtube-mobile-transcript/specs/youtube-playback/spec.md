## ADDED Requirements

### Requirement: Stable Platform-Appropriate Embed Host
The system SHALL select the YouTube embed host based on the runtime platform and SHALL preserve that selection across document switches. On Tauri (desktop), native mobile (iOS/Android), and Linux, the system SHALL use `https://www.youtube.com` as the embed host, because native WebViews (WKWebView, Android WebView, WebKitGTK) block `youtube-nocookie.com` iframe/postMessage exchanges and render a blank player. On other platforms the system SHALL use `https://www.youtube-nocookie.com`.

#### Scenario: Opening a YouTube video on native mobile
- **WHEN** a user opens a YouTube document from the Documents tab or the Queue on iOS or Android
- **THEN** the embed host SHALL be `https://www.youtube.com`
- **AND** the player SHALL render the video rather than a blank frame

#### Scenario: Switching between YouTube documents does not revert the host
- **GIVEN** the viewer is running on Tauri or native mobile with the embed host set to `https://www.youtube.com`
- **WHEN** the user opens a different YouTube document, changing `documentId` and `videoId`
- **THEN** the embed host SHALL remain `https://www.youtube.com`
- **AND** the system SHALL NOT reset the host to `https://www.youtube-nocookie.com`

#### Scenario: Non-native platforms retain the privacy-preserving host
- **WHEN** a user opens a YouTube document in a standard desktop browser (not Tauri, not native mobile, not Linux)
- **THEN** the embed host SHALL be `https://www.youtube-nocookie.com`

### Requirement: On-Device Caption Gating Classification
The system SHALL classify a YouTube caption track as PO-token-gated only when there is a positive indication that the track requires a proof-of-origin token or an unimplemented signature decipherment. The absence of a legacy signature parameter SHALL NOT by itself be treated as evidence of gating.

#### Scenario: Ordinary video with fetchable captions
- **WHEN** the on-device InnerTube fetcher selects a caption track whose URL carries no gating or cipher parameter
- **THEN** the system SHALL attempt to fetch the caption body
- **AND** the system SHALL NOT return a `PoTokenRequired` outcome solely because the URL lacks a `sig` parameter

#### Scenario: Genuinely gated video
- **WHEN** the selected caption track is actually PO-token-gated or requires signature decipherment
- **THEN** the system SHALL return a `PoTokenRequired` outcome
- **AND** the transcript source chain SHALL fall through to the next available source

#### Scenario: Caption fetch returns an unusable body
- **WHEN** a caption fetch is attempted and the response is empty, non-JSON, or an HTTP error
- **THEN** the system SHALL classify the outcome as a failure rather than returning an empty transcript as a success

### Requirement: Consistent On-Device Result Interpretation
All frontend call paths that read the result of the on-device transcript Tauri command SHALL interpret the response using the serialized discriminant emitted by the Rust `OnDeviceTranscriptResult` enum (`status` with values `ok` and `err`).

#### Scenario: Successful on-device fetch is recognized by every call path
- **WHEN** the on-device transcript command returns a successful result with a non-empty segment list
- **THEN** every frontend path that consumes this command SHALL recognize the result as successful
- **AND** SHALL return those segments without continuing to the hosted or Vercel fallback

#### Scenario: Failed on-device fetch is recognized as a failure
- **WHEN** the on-device transcript command returns an error result
- **THEN** the consuming path SHALL recognize it as a failure and log the reported failure kind and detail
- **AND** SHALL proceed to the next source in the chain

### Requirement: Mobile Transcripts Avoid the Bot-Blocked Fallback
For an ordinary, publicly-available YouTube video with captions, a transcript request on native mobile SHALL be satisfied by the on-device fetcher without reaching the hosted Vercel scraping endpoint.

#### Scenario: Transcript fetched on device for a captioned video
- **WHEN** a user views a captioned YouTube video in the Queue on native mobile with network connectivity
- **THEN** the transcript SHALL be resolved by the on-device source
- **AND** the user SHALL NOT see a "sign in to confirm you're not a bot" error
