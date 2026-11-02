# media-compatibility Specification Delta

## Purpose

Define how Plethora identifies actual media content, determines what the current
runtime can play, selects the least expensive reliable playback strategy, handles
HDR/Dolby Vision and track layout deliberately, preserves timeline coordinates,
and reports compatibility evidence without false precision.

## ADDED Requirements

### Requirement: Media inspection reports actual container and stream content

The system SHALL inspect a local video's actual container and streams using an
FFprobe-backed inspection service. The inspection SHALL report, where available:
container format; duration; start time; bit rate; video codec, profile, level,
pixel format, bit depth, resolution, frame rate, codec tag, and HDR/Dolby Vision
metadata; audio codec, profile, channels, channel layout, sample rate, language,
title, and default/commentary disposition; subtitle codec, language, title,
default/forced disposition, and whether the codec is text or bitmap; chapter
start/end/title; whether the file is readable and valid; and a best-effort
protected/DRM signal when FFprobe exposes one.

The system SHALL distinguish a container from the codecs inside it: a `.mkv`
extension SHALL NOT be reported as a video codec, and an HEVC/DTS Matroska file
SHALL be reported as HEVC video + DTS audio inside Matroska.

#### Scenario: Matroska HEVC/DTS

- **GIVEN** a Matroska file containing HEVC video and DTS-HD MA audio
- **WHEN** the media is inspected
- **THEN** the container is `matroska`
- **AND** the video stream codec is `hevc` with its profile/pixel format/resolution
- **AND** the audio stream codec is `dts` with its profile/channels/layout
- **AND** the result does not describe `.mkv` as an unsupported codec

#### Scenario: TrueHD audio

- **GIVEN** a Matroska file with TrueHD audio
- **WHEN** the media is inspected and planned
- **THEN** the audio codec is `truehd`
- **AND** if TrueHD is unsupported by the runtime, an audio-only AAC conversion is selected when video is compatible

#### Scenario: Attached cover art

- **GIVEN** a Matroska file with an `attached_pic` MJPEG cover stream
- **WHEN** the video stream is selected
- **THEN** the attached picture is excluded from selection
- **AND** the real video stream is selected
- **AND** the cover stream is still visible in advanced details

#### Scenario: Bitmap and text subtitles

- **GIVEN** a file with PGS and SubRip subtitle tracks
- **WHEN** the subtitles are inspected
- **THEN** PGS is classified as `bitmap`
- **AND** SubRip is classified as `text`
- **AND** each track's language/default/forced state is reported

#### Scenario: Invalid or unreadable file

- **GIVEN** a file that FFprobe cannot parse or that is not readable
- **WHEN** inspection runs
- **THEN** the inspection status is `failed` or `unavailable`
- **AND** the system does not invent codec values
- **AND** the failure maps to `media_corrupt`, a source error, or `media_inspection_unavailable` as appropriate

#### Scenario: Protected media

- **GIVEN** FFprobe exposes an encryption/DRM signal for a file
- **WHEN** the compatibility plan is produced
- **THEN** the strategy is `unavailable` with `unsupported_protected_media`
- **AND** no conversion is offered or started
- **AND** if the signal is ambiguous, the system reports an indeterminate compatibility failure instead of claiming DRM

### Requirement: Inspection is typed, serializable, and available to Rust and React

The system SHALL expose inspection results as a versioned, typed, serializable
model shared by Rust and TypeScript. The model SHALL include a schema version, a
source fingerprint, a redacted path label, and stable optional fields so unknown
or unavailable values are represented explicitly rather than as empty strings.

#### Scenario: Stable serialization

- **GIVEN** an inspection result
- **WHEN** it is serialized to the frontend
- **THEN** field names are camelCase and enums are snake_case
- **AND** optional values are `null` rather than fabricated defaults
- **AND** a schema version is present

#### Scenario: Unknown values remain unknown

- **GIVEN** FFprobe omits a color-transfer value
- **WHEN** the inspection is built
- **THEN** HDR kind is `unknown` or `sdr` only if supported by other fields
- **AND** the system does not claim HDR10 from a missing value

### Requirement: Inspection is cached by source fingerprint and invalidated on change

The system SHALL compute a cheap source fingerprint from file size, modification
time, and sampled leading/trailing bytes. It SHALL cache inspection results by
document identity + fingerprint and SHALL re-inspect when the fingerprint,
schema version, or tool output is invalid. It SHALL NOT hash an entire
multi-gigabyte video solely for cache validation.

#### Scenario: Reopen without re-probing

- **GIVEN** a video was inspected in this session or a previous session
- **AND** its size/mtime/sample fingerprint is unchanged
- **WHEN** the user reopens it
- **THEN** the cached inspection is reused
- **AND** no FFprobe process is spawned for metadata

#### Scenario: Original modified

- **GIVEN** a cached inspection for a video
- **WHEN** the file size, mtime, or sampled bytes change
- **THEN** the cached inspection is not reused
- **AND** the file is re-inspected before a compatibility plan is produced

#### Scenario: Probe unavailable

- **GIVEN** FFprobe is not installed
- **WHEN** the user opens a video
- **THEN** native playback is still attempted
- **AND** the inspection status is `unavailable`
- **AND** failure classification falls back to transport + runtime evidence
- **AND** no fake codec metadata is produced

### Requirement: Runtime capability detection reports supported, unsupported, or unknown

The system SHALL combine platform runtime evidence into a capability report. On
Linux it SHALL query GStreamer's element registry. On every platform it SHALL
accept exact-codec `canPlayType()` declarations from the webview. On desktop it
SHALL report FFmpeg/FFprobe tool, encoder, and filter availability. The result
SHALL classify each relevant demuxer, decoder, subtitle kind, and encoder as
`supported`, `unsupported`, or `unknown`, and SHALL record the evidence source
and a runtime fingerprint.

#### Scenario: Linux registry

- **GIVEN** the app runs on Linux with `gst-inspect-1.0` available
- **WHEN** capabilities are requested
- **THEN** the report lists Matroska/MP4/WebM demuxers and H.264/HEVC/AV1/VP9/AAC/AC3/EAC3/DTS/Opus/FLAC/MP3/Vorbis decoders found in the registry
- **AND** missing elements are `unsupported`
- **AND** an unavailable registry is `unknown`, not `unsupported`

#### Scenario: Exact codec declaration

- **GIVEN** WebKitGTK returns `"probably"` for `video/mp4; codecs="hvc1.1.6.L120.90"`
- **WHEN** the report is built
- **THEN** HEVC is at least `supported` by declaration
- **AND** the raw query/result is retained as evidence

#### Scenario: Container-only declaration

- **GIVEN** `canPlayType('video/x-matroska')` returns `"maybe"`
- **WHEN** the report is built
- **THEN** the Matroska container may be `supported` by declaration
- **AND** no video/audio/subtitle codec is marked supported from that query alone

#### Scenario: DTS declaration gap

- **GIVEN** the webview returns `""` for `audio/mp4; codecs="dtsc"` but can play DTS in Matroska
- **WHEN** capabilities are merged
- **THEN** DTS is not marked unsupported solely from the MP4 query
- **AND** a GStreamer element or positive real playback can mark it supported

#### Scenario: No decoder enumeration on Windows/macOS

- **GIVEN** the app runs on Windows or macOS
- **WHEN** capabilities are requested
- **THEN** the report uses exact-codec declarations and real playback evidence
- **AND** it does not claim OS decoder support from the GPU model
- **AND** unknown values remain unknown

### Requirement: Capability evidence has explicit uncertainty and refresh rules

The system SHALL NOT treat `"maybe"` as proof of codec support, a successful
`loadedmetadata` event as proof of decodability, a failed `canPlayType()` as
proof of impossibility, or a GPU model as proof of hardware decode/encode.
Capability results SHALL include a confidence/evidence level. Negative
capability evidence SHALL be session-scoped and refreshable; positive real
playback evidence MAY be cached for the session.

#### Scenario: Metadata is not proof

- **GIVEN** a media element fires `loadedmetadata` or `canplay`
- **AND** playback later fails with a decode/pipeline error
- **WHEN** the failure is classified
- **THEN** the earlier metadata event is not treated as proof that the codec is supported

#### Scenario: Negative evidence refresh

- **GIVEN** a previous attempt marked HEVC unsupported in this session
- **WHEN** the user installs GStreamer codecs and presses "Check media support"
- **THEN** the capability report is refreshed
- **AND** the negative evidence is discarded
- **AND** the new plan can select native playback

#### Scenario: Runtime change invalidates positives

- **GIVEN** a positive playback fact keyed by a runtime fingerprint
- **WHEN** the app version, FFmpeg version, GStreamer plugin set, or engine changes
- **THEN** the fingerprint changes
- **AND** the old positive is not used as authoritative

### Requirement: Strategy selection uses the least expensive reliable path

The system SHALL select a playback strategy in this order: native, lossless
remux, audio-only conversion, video transcoding, unavailable. It SHALL NOT
transcode video when copying the video stream and changing container or
subtitle policy is sufficient. It SHALL NOT transcode audio when the audio
stream is compatible with the target container. It SHALL NOT choose a strategy
that cannot be stored or executed.

#### Scenario: Container-only incompatibility

- **GIVEN** H.264/AAC streams are supported but the Matroska container is not
- **WHEN** the plan is produced
- **THEN** the strategy is `remux` to MP4
- **AND** video and audio are copied
- **AND** no re-encoding occurs

#### Scenario: Audio-only incompatibility

- **GIVEN** HEVC video is supported but DTS audio is not
- **WHEN** the plan is produced
- **THEN** the strategy is `audio_transcode`
- **AND** the video stream is copied
- **AND** only the selected audio stream is converted to AAC

#### Scenario: Video incompatibility

- **GIVEN** HEVC video is not supported and H.264 is available
- **WHEN** the plan is produced
- **THEN** the strategy is `video_transcode`
- **AND** video is converted to H.264
- **AND** compatible audio is copied where the target container allows it

#### Scenario: No conversion available

- **GIVEN** the required tool, encoder, or filter is unavailable
- **WHEN** the plan is produced
- **THEN** the strategy is `unavailable`
- **AND** a specific reason is returned
- **AND** native playback is still offered when possible

### Requirement: Native failures have a deterministic recovery plan

When native playback fails after a capability prediction, the system SHALL
re-plan with the observed failure evidence. It SHALL select the least expensive
recovery supported by that evidence, SHALL NOT fabricate a codec cause, and
SHALL NOT leave the user at a dead end when a conversion path exists.

#### Scenario: Bitmap subtitle failure after native start

- **GIVEN** a file played natively far enough to emit `MediaError 4`
- **AND** inspection identifies bitmap subtitles
- **WHEN** the system re-plans with failure code `bitmap_subtitle_unsupported`
- **THEN** it selects a lossless subtitle-stripping remux
- **AND** it does not transcode video or audio

#### Scenario: Decoder initialization failure after a positive declaration

- **GIVEN** `canPlayType` declared HEVC supported
- **WHEN** native playback fails with `decoder_initialization_failed`
- **AND** no bitmap/container explanation exists
- **THEN** the recovery plan selects video transcoding when an encoder is available
- **AND** HDR/large-output consent rules still apply
- **AND** the plan confidence/evidence records the failed native attempt

#### Scenario: Indeterminate failure

- **GIVEN** transport is healthy and inspection is unavailable
- **WHEN** native playback fails with `MediaCompatibilityIndeterminate`
- **THEN** the first recovery plan may be a low-risk remux to a known-good container with stream copy
- **AND** a full transcode is only selected after that artifact also fails or evidence supports it
- **AND** the UI explains that the cause is uncertain

### Requirement: Audio track selection is deliberate and preserve quality

The system SHALL select exactly one audio stream: the first default-disposition
track, or the first audio track when no default exists. It SHALL preserve the
selected track's language/title metadata and channel layout up to 5.1. It SHALL
NOT silently switch language, select a commentary track over a default track,
force stereo, or discard additional tracks without recording the decision.

#### Scenario: Default track

- **GIVEN** multiple audio tracks with one marked default
- **WHEN** the plan is produced
- **THEN** the default track is selected
- **AND** its language/title are preserved
- **AND** the other tracks are recorded as omitted

#### Scenario: No default flag

- **GIVEN** multiple audio tracks with no default
- **WHEN** the plan is produced
- **THEN** the first audio track in index order is selected
- **AND** the UI/details identify which track was selected

#### Scenario: Surround preserved

- **GIVEN** a 5.1 DTS track that requires AAC conversion
- **WHEN** the audio is converted
- **THEN** the output is 5.1 AAC at 384 kbps
- **AND** it is not downmixed to stereo

#### Scenario: More than six channels

- **GIVEN** a 7.1 source that requires AAC conversion
- **WHEN** the plan is produced
- **THEN** the output is downmixed to 5.1
- **AND** the limitation `audio_downmixed_to_5_1` is disclosed

### Requirement: Subtitle compatibility is part of the playback decision

The system SHALL treat bitmap subtitles as incompatible with the WebKitGTK
HTML media pipeline when they are present in a Matroska source. It SHALL select
a lossless remux that omits subtitle tracks rather than a video/audio
transcode. Text subtitles SHALL not by themselves force a remux. The original
subtitle tracks SHALL remain in the original file, and the derived artifact
SHALL record the omission.

#### Scenario: PGS forces remux, not transcode

- **GIVEN** a Matroska file with supported HEVC/DTS streams and PGS subtitles
- **WHEN** the plan is produced
- **THEN** the strategy is `remux`
- **AND** the output omits subtitle tracks
- **AND** video/audio are copied
- **AND** the limitation `subtitles_not_rendered` is recorded

#### Scenario: Text subtitles

- **GIVEN** a Matroska file with supported streams and SubRip subtitles
- **WHEN** the plan is produced
- **THEN** the presence of text subtitles alone does not force a remux
- **AND** the artifact still does not claim to render them

#### Scenario: Other containers

- **GIVEN** an MP4 file with `mov_text` subtitles
- **WHEN** the plan is produced
- **THEN** the subtitle track is not treated as a bitmap incompatibility
- **AND** it may be omitted from a derived artifact without forcing video/audio conversion

#### Scenario: Non-WebKitGTK platform

- **GIVEN** an Android or iOS device with an MKV containing a bitmap subtitle track
- **WHEN** the plan is produced
- **THEN** the bitmap track alone does not preempt native playback
- **AND** if native playback fails and conversion is unavailable, the UI reports the platform limitation

### Requirement: HDR, HLG, and Dolby Vision are handled without silent degradation

The system SHALL detect HDR10/PQ, HLG, HDR10+, and Dolby Vision metadata where
FFprobe exposes it. It SHALL prefer native playback or lossless remux, which
copy the video bitstream unchanged. It SHALL NOT silently convert HDR to SDR,
claim Dolby Vision preservation, or convert Dolby Vision profile 5 in P1.

#### Scenario: HDR10 remux

- **GIVEN** a 4K HDR10 HEVC file that requires only a container/audio change
- **WHEN** the plan is produced
- **THEN** the video stream is copied
- **AND** HDR10 color metadata is preserved
- **AND** no tone mapping is applied

#### Scenario: Full HDR transcode requires consent

- **GIVEN** HEVC is unavailable and the source is HDR10
- **WHEN** the only working strategy is video transcoding
- **THEN** `requires_consent` is true with reason `hdr_tone_mapping`
- **AND** the UI explains that the result will be SDR and quality-changing
- **AND** the conversion uses a verified tone-map chain
- **AND** the limitation `hdr_converted_to_sdr` is recorded

#### Scenario: Tone-map filters unavailable

- **GIVEN** an HDR source requires tone mapping
- **AND** `zscale` or `tonemap` is unavailable
- **WHEN** the plan is produced
- **THEN** the strategy is `unavailable`
- **AND** the reason is `conversion_filter_missing`
- **AND** no washed-out output is produced

#### Scenario: Dolby Vision profile 8

- **GIVEN** a Dolby Vision profile 8 file with an HDR10-compatible base layer
- **WHEN** a same-container remux is selected
- **THEN** the video bitstream is copied
- **AND** the artifact does not claim Dolby Vision preservation
- **AND** advanced details state that DV signalling may not survive a container change

#### Scenario: Dolby Vision profile 5

- **GIVEN** a Dolby Vision profile 5 file
- **AND** the runtime cannot confirm DV playback
- **WHEN** a video transcode would be required
- **THEN** the plan is `unavailable` with `dolby_vision_unsupported`
- **AND** the system does not silently convert it to SDR

#### Scenario: Container change loses DV signalling

- **GIVEN** a Dolby Vision Matroska source that must be remuxed to MP4
- **WHEN** the artifact is published
- **THEN** the manifest records `dolby_vision_signalling_not_preserved`
- **AND** the UI does not claim DV was preserved

### Requirement: Compatibility output is verified before publication

The system SHALL verify every derived artifact before making it available:
expected stream count and codecs, container, zero-based start time, duration
within tolerance, audio/video first-PTS alignment, preserved HDR color metadata
for copied video, and a short decode check. If verification fails, the artifact
SHALL NOT be published.

#### Scenario: Duration mismatch

- **GIVEN** a converted artifact whose duration differs from the source by more than the tolerance
- **WHEN** verification runs
- **THEN** the artifact is rejected
- **AND** the job fails with `conversion_verification_failed`
- **AND** the staging output is deleted

#### Scenario: Undecodable output

- **GIVEN** an output that FFprobe can read but FFmpeg cannot decode for two seconds
- **WHEN** verification runs
- **THEN** the artifact is rejected
- **AND** no cache row is marked ready

#### Scenario: Valid output

- **GIVEN** a valid remux
- **WHEN** verification passes
- **THEN** the artifact is published atomically
- **AND** the manifest records the verification results

### Requirement: Timeline coordinates remain identical to the original

Every published compatibility artifact SHALL have a zero-based timeline whose
time 0 corresponds to the original's playable time 0. The system SHALL verify
start time and duration and SHALL fail closed rather than publish an artifact
with a nonzero offset in P1. Saved positions, transcript segments, chapters, and
video extracts SHALL continue to use the original document's seconds.

#### Scenario: Zero-based output

- **GIVEN** a source with `format.start_time = 0`
- **WHEN** a remux is published
- **THEN** the artifact `format.start_time` is within `[-0.05, 0.05]`
- **AND** its duration is within tolerance of the source

#### Scenario: Nonzero source start

- **GIVEN** a source whose first stream starts at a nonzero timestamp
- **WHEN** conversion would produce a nonzero output start
- **THEN** the conversion fails verification
- **AND** no artifact is published
- **AND** the user sees a precise conversion failure

#### Scenario: Transcript and extract coordinates

- **GIVEN** a transcript segment and a video extract at 100 seconds
- **WHEN** the artifact is played
- **THEN** seeking to 100 seconds addresses the same content
- **AND** no offset is added or subtracted by the player

### Requirement: Compatibility behavior has explicit platform boundaries

The system SHALL report which capabilities are available per platform. Linux,
Windows, and macOS SHALL support inspection, planning, and FFmpeg-based
compatibility processing when the tools are present. Android and iOS SHALL
support native playback and accurate diagnostics only; they SHALL NOT offer
conversion. Browser/PWA SHALL support native playback and declared/indeterminate
diagnostics only. No platform SHALL claim codec support identical to another.

#### Scenario: Android limitation

- **GIVEN** an unsupported MKV/DTS file on Android
- **WHEN** playback fails
- **THEN** the UI reports `conversion_platform_unsupported`
- **AND** it explains that the device cannot play the file
- **AND** it states that in-app conversion is unavailable on this platform
- **AND** no Convert button is shown

#### Scenario: Desktop conversion

- **GIVEN** Linux/Windows/macOS with FFmpeg available
- **WHEN** a compatible plan exists
- **THEN** the conversion action is offered
- **AND** progress/cancellation are available

#### Scenario: Browser/PWA

- **GIVEN** the app runs outside Tauri
- **WHEN** a video fails with code 4 and no transport evidence
- **THEN** the failure is `media_compatibility_indeterminate`
- **AND** no Rust inspection/conversion command is invoked

### Requirement: Compatibility decisions are observable and reproducible

The system SHALL emit structured diagnostics for inspection, capability,
planning, transport, job, and conversion outcomes. Diagnostics SHALL include the
platform/engine, source hash, container, codecs, subtitle kinds, strategy,
confidence, failure code, HTTP status, media error code, job phase, and elapsed
time, and SHALL omit media bytes, transcript text, and full user paths.

#### Scenario: Reproduce the reported failure

- **GIVEN** a report of "codec not supported" plus "source-access"
- **WHEN** an engineer reads the diagnostics
- **THEN** the record shows whether the transport was healthy
- **AND** the container/codecs/subtitle kinds
- **AND** the chosen strategy/failure code
- **AND** the HTTP status and media error code
- **AND** it is possible to distinguish MIME, access, container, video decoder, audio decoder, subtitle, corrupt, and indeterminate causes

#### Scenario: No log flooding

- **GIVEN** the same failure repeats on every render
- **WHEN** diagnostics are recorded
- **THEN** duplicate entries are aggregated/deduplicated for at least 60 seconds
- **AND** the UI does not retry in a loop

### Requirement: Original media is immutable and artifacts are not documents

The system SHALL NOT modify, move, rename, overwrite, or delete the original
imported video as part of inspection, planning, conversion, caching, or
cleanup. A compatibility artifact SHALL be an internal cache object associated
with the existing document; it SHALL NOT create a second document, change the
document ID, or appear as a library item.

#### Scenario: Original unchanged

- **GIVEN** a video that requires a remux
- **WHEN** the job completes
- **THEN** the original file's size and modification time are unchanged
- **AND** no temporary output exists beside the original

#### Scenario: No duplicate document

- **GIVEN** a video document
- **WHEN** a compatibility artifact is created
- **THEN** the document count is unchanged
- **AND** the document ID/file path are unchanged
- **AND** the artifact is not returned by library/document queries

#### Scenario: Cache cleanup

- **GIVEN** a cache eviction or clear-cache action
- **WHEN** artifacts are deleted
- **THEN** no original media is deleted
- **AND** the document remains playable (natively or by re-preparing)

### Requirement: Compatibility processing does not add redundant expensive probes

The system SHALL inspect a source at most once per document+fingerprint per
session, reuse persisted inspection across restarts, cache capability results
for a bounded TTL, and reuse a valid artifact without invoking FFmpeg or
re-probing. It SHALL NOT probe the entire library on startup or on import.

#### Scenario: Reopen converted video

- **GIVEN** a valid cached artifact for a document
- **WHEN** the user reopens the video
- **THEN** no conversion job starts
- **AND** the artifact URL is returned from the cache
- **AND** no FFprobe is spawned for a matching fingerprint

#### Scenario: Startup

- **GIVEN** the app starts
- **WHEN** no video is opened
- **THEN** no media inspection, capability registry scan, or conversion starts
- **AND** startup is not blocked by cache GC

#### Scenario: Repeated re-render

- **GIVEN** the player's parent re-renders repeatedly with the same document
- **WHEN** the compatibility hook runs
- **THEN** it does not re-inspect, re-plan, or start duplicate jobs