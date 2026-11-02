# local-media-playback Specification Delta

## Purpose

Make local video playback reliable and truthful: resolve and stream authorized
local files through the existing loopback server, establish source access with
evidence, classify media failures without inventing causes, recover through the
least expensive compatible strategy, and preserve Plethora's learning features.

## ADDED Requirements

### Requirement: Local video sources resolve through the authorized loopback server

In the Tauri runtime, a local video document SHALL resolve its playback source
through `get_media_stream_url`, producing a loopback HTTP URL served by the
existing media server. The Tauri asset protocol SHALL NOT be used, because the
app does not enable `app.security.assetProtocol`. The resolver SHALL NOT read a
video file into JavaScript memory as a fallback.

#### Scenario: Desktop local video resolves to loopback

- **GIVEN** a video document whose `filePath` is an absolute local path
- **WHEN** the viewer resolves its playback source in the Tauri runtime
- **THEN** the resolved URL starts with `http://127.0.0.1:`
- **AND** the strategy is recorded as `local-media-server`
- **AND** no `asset://` or `http://asset.localhost` URL is assigned to the media element

#### Scenario: Large video is never materialized in JavaScript

- **GIVEN** a local video larger than 256 MiB
- **WHEN** loopback source resolution fails
- **THEN** the system reports a source-resolution failure
- **AND** it does not call `readDocumentFile` for the video
- **AND** it does not create a Blob URL for the video

#### Scenario: Browser-imported file uses an object URL

- **GIVEN** the app runs outside Tauri and the path is a `browser-file://` virtual path
- **AND** a browser `File` object exists for that path
- **WHEN** the viewer resolves the source
- **THEN** an object URL is created for the `File`
- **AND** the URL is marked for revocation when the viewer disposes

### Requirement: The media server reports correct container content types

The media server SHALL map every supported local media container extension to a
correct media MIME type, including `video/x-matroska` for `.mkv`, and SHALL use
`application/octet-stream` only for unknown extensions. The mapping SHALL cover
at least mp4, m4v, webm, mkv, mov, avi, mpg/mpeg, ts/m2ts, flv, wmv, 3gp, ogv,
mka, m4a/m4b, aac, mp3, ogg/oga, opus, flac, wav, aiff, wma, and weba. The
response SHALL include `Accept-Ranges: bytes` and an accurate `Content-Length`.

#### Scenario: Matroska is served as Matroska

- **GIVEN** an authorized `.mkv` file
- **WHEN** the media server responds to a full or partial request
- **THEN** `Content-Type` is `video/x-matroska`
- **AND** `Accept-Ranges` is `bytes`
- **AND** `Content-Length` equals the response body length

#### Scenario: Unknown extension is not mislabeled

- **GIVEN** an authorized file with an extension the server does not recognize
- **WHEN** the server responds
- **THEN** `Content-Type` is `application/octet-stream`
- **AND** the response still streams the file with correct range semantics

#### Scenario: Audio container types remain correct

- **GIVEN** authorized `.m4b`, `.m4a`, `.mp3`, `.flac`, and `.opus` files
- **WHEN** the server responds
- **THEN** each receives its existing/declared audio MIME type
- **AND** the mobile audiobook `audio/mp4` contract remains satisfied

### Requirement: Local media responses have correct HTTP range semantics

The media server SHALL support complete responses (`200`), single byte ranges
(`206`), suffix ranges, open-ended ranges, and `HEAD`. It SHALL return `416`
with `Content-Range: bytes */<total>` for malformed, multi-range, or
unsatisfiable ranges, preserving the explicit contract established by the
mobile audiobook playback change. A `206` response SHALL carry the exact
requested bytes, a matching `Content-Length`, and
`Content-Range: bytes <start>-<end>/<total>`.

#### Scenario: Full response

- **GIVEN** an authorized file and a request without `Range`
- **WHEN** the server responds
- **THEN** it returns `200`
- **AND** `Content-Length` equals the file size
- **AND** the body is streamed lazily

#### Scenario: Partial response

- **GIVEN** an authorized file and `Range: bytes=3-7`
- **WHEN** the server responds
- **THEN** it returns `206`
- **AND** `Content-Length` is `5`
- **AND** `Content-Range` is `bytes 3-7/<total>`
- **AND** the body is exactly the requested bytes

#### Scenario: Suffix and open-ended ranges

- **GIVEN** an authorized file
- **WHEN** the client requests `bytes=-N` or `bytes=N-`
- **THEN** the server returns a valid `206` for the corresponding suffix or open-ended range
- **AND** clamps the end to the last byte

#### Scenario: Invalid range

- **GIVEN** an authorized file
- **WHEN** the client requests a malformed, multi-range, or out-of-bounds range
- **THEN** the server returns `416`
- **AND** `Content-Range` is `bytes */<total>`
- **AND** it does not return a silently truncated `200`

#### Scenario: HEAD request

- **GIVEN** an authorized file
- **WHEN** the client sends `HEAD`
- **THEN** the server returns the same status/headers as `GET` without a body

### Requirement: Media server failures are machine-readable and diagnosable

The media server SHALL return a stable machine-readable error code for every
failure (not found, forbidden, invalid range, stat failure, seek failure) in a
response header and a small JSON body. It SHALL log the file basename, status,
range, elapsed time, and error code without logging media bytes or full user
paths. A startup/bind failure SHALL be reported to the caller as a typed error.

#### Scenario: Missing file

- **GIVEN** a stream request for a path that no longer exists
- **WHEN** the server cannot canonicalize/open it
- **THEN** it returns `404` with code `media_not_found`
- **AND** the caller can distinguish this from `403` and `416`

#### Scenario: Unauthorized path

- **GIVEN** a stream request for a path outside app-managed roots that is not a registered document path
- **WHEN** the server authorizes the request
- **THEN** it returns `403` with code `media_forbidden`
- **AND** no file bytes are served

#### Scenario: Permission denied

- **GIVEN** an authorized path that exists but cannot be opened due to OS permissions
- **WHEN** the server attempts to open it
- **THEN** it returns `403` with code `media_permission_denied`
- **AND** the UI can distinguish this from a missing file

#### Scenario: Invalid range

- **GIVEN** an unsatisfiable range
- **WHEN** the server rejects it
- **THEN** it returns `416` with code `media_range_not_satisfiable`
- **AND** includes `Content-Range: bytes */<total>`

#### Scenario: Server unavailable

- **GIVEN** the loopback listener failed to bind or is not running
- **WHEN** the frontend resolves a local source
- **THEN** the failure maps to `source_server_unavailable`
- **AND** the UI offers retry and details

### Requirement: Source-access classification requires transport evidence

The system SHALL classify a playback failure as a source-access problem only
when a transport probe or an equivalent HTTP/network observation establishes
that the source is inaccessible. A reachable `200`/`206` response with bytes
SHALL NOT be classified as source-access, regardless of the media element error
code or `canPlayType()` result.

#### Scenario: Healthy transport plus MediaError code 4

- **GIVEN** the loopback server returns `206` with the expected bytes
- **AND** the media element emits `MediaError.code === 4`
- **WHEN** the failure is classified
- **THEN** the result is a media/container/decoder/subtitle failure or `media_compatibility_indeterminate`
- **AND** it is never `source-access`

#### Scenario: HTTP 403

- **GIVEN** the transport probe receives `403`
- **WHEN** the failure is classified
- **THEN** the result is `source_permission_denied`
- **AND** the UI does not present codec guidance as the primary explanation

#### Scenario: HTTP 404

- **GIVEN** the transport probe receives `404`
- **WHEN** the failure is classified
- **THEN** the result is `source_not_found`
- **AND** the UI offers re-import

#### Scenario: Server unreachable

- **GIVEN** the transport probe cannot connect to the loopback port
- **WHEN** the failure is classified
- **THEN** the result is `source_server_unavailable`
- **AND** the UI offers retry

#### Scenario: Blob source

- **GIVEN** the active source is a `blob:` URL
- **WHEN** the failure is classified
- **THEN** a short ranged `fetch` result is used as transport evidence when available
- **AND** absence of that evidence yields `media_compatibility_indeterminate`, not source-access

### Requirement: Playback failures use one evidence-based taxonomy

The system SHALL classify local video failures into the shared taxonomy:
`source_not_found`, `source_permission_denied`, `source_transport_failed`,
`source_server_unavailable`, `source_range_invalid`, `source_empty`,
`container_unsupported`, `video_decoder_unavailable`,
`audio_decoder_unavailable`, `bitmap_subtitle_unsupported`,
`decoder_initialization_failed`, `media_corrupt`,
`unsupported_protected_media`, `media_inspection_unavailable`,
`media_compatibility_indeterminate`, `conversion_dependency_missing`,
`conversion_encoder_missing`, `conversion_filter_missing`, `conversion_failed`,
`conversion_verification_failed`, `conversion_cancelled`,
`conversion_requires_consent`, `conversion_in_progress`,
`conversion_queue_full`, `insufficient_storage`, `dolby_vision_unsupported`,
`conversion_platform_unsupported`, `playback_interrupted`, and `unknown`. The
classifier SHALL prefer the most specific evidence-backed code and SHALL return
`media_compatibility_indeterminate` when evidence is insufficient.

#### Scenario: Bitmap subtitles are identified

- **GIVEN** a Linux/WebKitGTK runtime
- **AND** a Matroska file with HEVC video, DTS audio, and one PGS subtitle track
- **AND** the runtime supports HEVC, DTS, and Matroska
- **WHEN** native playback fails with `MediaError.code === 4`
- **THEN** the failure is `bitmap_subtitle_unsupported` (or the selected remux plan is offered)
- **AND** it is not `source-access` and not `video_decoder_unavailable`

#### Scenario: Video decoder absent

- **GIVEN** the runtime capability report says HEVC is unsupported with strong evidence
- **WHEN** the file's video codec is HEVC and playback fails
- **THEN** the failure is `video_decoder_unavailable`
- **AND** the UI offers a video conversion action when available

#### Scenario: Audio decoder absent

- **GIVEN** the runtime capability report says DTS is unsupported with strong evidence
- **AND** the video codec is supported
- **WHEN** playback fails
- **THEN** the failure is `audio_decoder_unavailable`
- **AND** the UI offers an audio-only conversion action when available

#### Scenario: Evidence is insufficient

- **GIVEN** transport is healthy
- **AND** no inspection is available
- **AND** no reliable decoder evidence is available
- **WHEN** the media element reports code 4
- **THEN** the failure is `media_compatibility_indeterminate`
- **AND** the UI says the cause could not be determined
- **AND** it does not claim a codec is unsupported

#### Scenario: Two error paths do not disagree

- **GIVEN** `play()` rejects with `NotSupportedError`
- **AND** the media element also emits `MediaError.code === 4`
- **WHEN** both events are processed
- **THEN** they produce one failure object with one primary message
- **AND** a toast/overlay cannot display two different root causes

### Requirement: Native playback is preferred and starts without unnecessary delay

The player SHALL attach the original source and allow native playback whenever
the source is authorized and the container is not known to require
preparation. It SHALL NOT gate native playback on a full-file probe, a second
media-element load, or a conversion decision. For containers that commonly
require inspection (Matroska, AVI, MPEG-TS, WMV, FLV, unknown), it MAY wait for
the lightweight inspection (FFprobe on local headers) before attaching, provided
the wait is bounded.

#### Scenario: Compatible MP4 starts natively

- **GIVEN** a local MP4/H.264/AAC document
- **WHEN** the user opens it
- **THEN** the player attaches the loopback source without starting a conversion
- **AND** no preparation panel is shown
- **AND** the added startup overhead is bounded (see performance requirement)

#### Scenario: MKV with bitmap subtitles is prepared before a doomed attempt

- **GIVEN** a Matroska file with bitmap subtitles
- **AND** the remaining streams are supported
- **WHEN** the user opens it
- **THEN** the system may show a preparation state instead of attaching the failing original
- **AND** it selects a lossless remux that omits the subtitle tracks

#### Scenario: Native playback succeeds after capability uncertainty

- **GIVEN** the plan confidence is `indeterminate`
- **WHEN** the original source plays successfully
- **THEN** the system records a positive playback fact for the session
- **AND** it cancels any unnecessary pending preparation

### Requirement: Bitmap subtitle incompatibility is handled without re-encoding

When inspection finds one or more bitmap subtitle streams
(`hdmv_pgs_subtitle`, `dvd_subtitle`, `dvb_subtitle`, `xsub`) and the video and
audio streams are otherwise compatible, the system SHALL select a lossless
remux that copies the selected video and audio streams and omits subtitle
streams. It SHALL NOT transcode video or audio solely because of bitmap
subtitles. It SHALL record the omitted subtitle tracks in the artifact manifest
and in the advanced details UI.

#### Scenario: Reported MKV shape

- **GIVEN** an MKV with HEVC Main 10 HDR10/DV8 video, DTS-HD MA 5.1 audio, and five PGS tracks
- **AND** the runtime supports Matroska, HEVC, and DTS
- **WHEN** the compatibility plan is produced
- **THEN** the strategy is `remux`
- **AND** the output container is Matroska
- **AND** video and audio are copied without re-encoding
- **AND** subtitle tracks are omitted
- **AND** the original file is unchanged

#### Scenario: Text subtitles do not force remux by themselves

- **GIVEN** an MKV with HEVC/DTS and SubRip subtitles
- **AND** video, audio, and Matroska are supported
- **WHEN** the compatibility plan is produced
- **THEN** the strategy may be `native`
- **AND** the text subtitles do not trigger a bitmap-subtitle remux

#### Scenario: Subtitle limitation is disclosed

- **GIVEN** a derived artifact with omitted subtitle tracks
- **WHEN** the user opens advanced details
- **THEN** it reports how many subtitle tracks were present and that they are not rendered
- **AND** it states that the original file still contains them

### Requirement: Large videos are never loaded whole into JavaScript

The system SHALL NOT read a video file into a JavaScript `ArrayBuffer`, `Blob`,
or object URL as a playback fallback. For video playback, whole-file reads SHALL
NOT be used; any non-video whole-file read remains governed by its existing
bounded path. The player SHALL stream video through the loopback server (Tauri)
or an object URL created from an already-held browser `File` (web/PWA).

#### Scenario: Tauri video fallback is removed

- **GIVEN** a Tauri video source resolution failure
- **WHEN** the resolver decides what to do next
- **THEN** it reports the failure
- **AND** it does not call `readDocumentFile` for the video

#### Scenario: Browser-imported video

- **GIVEN** a browser-imported video `File` object
- **WHEN** the viewer resolves the source
- **THEN** it uses `URL.createObjectURL(file)`
- **AND** it revokes the URL on disposal

### Requirement: Playback recovery is bounded and does not loop

The system SHALL attempt at most one automatic artifact/original switch per
failure burst. It SHALL retry transient transport/server failures at most twice
with bounded backoff, and SHALL NOT automatically retry `4xx`, corrupt,
protected, unsupported, or conversion-verification failures. Repeated identical
failures SHALL be deduplicated in logs for at least 60 seconds.

#### Scenario: Transient server failure

- **GIVEN** the first two transport attempts fail with a connection error
- **WHEN** the third attempt succeeds
- **THEN** playback proceeds
- **AND** the retries are recorded once with an attempt count

#### Scenario: Corrupt media

- **GIVEN** inspection or decoding establishes that the file is corrupt
- **WHEN** playback fails
- **THEN** the UI reports `media_corrupt`
- **AND** no automatic retry loop occurs

#### Scenario: Artifact failure falls back once

- **GIVEN** a compatibility artifact fails to play
- **WHEN** the user chooses to try the original
- **THEN** the original is attempted once
- **AND** the system does not alternate indefinitely between the two sources

### Requirement: Playback failure UI states the real cause and offers recovery

The viewer SHALL show a distinct primary message and at most three recovery
actions for each failure class. It SHALL keep technical details (container,
codecs, subtitle types, strategy, confidence, HTTP status, `MediaError` code,
job phase) behind an expandable disclosure. It SHALL use the existing design
tokens, preserve keyboard behavior, and expose accessible roles/labels.

#### Scenario: Missing file

- **GIVEN** the file was deleted or moved
- **WHEN** the viewer classifies the failure
- **THEN** it says the file is no longer at its original location
- **AND** it offers re-import and retry

#### Scenario: Bitmap subtitles without a conversion tool

- **GIVEN** the file requires a subtitle-stripping remux
- **AND** FFmpeg is unavailable
- **WHEN** the viewer reports the failure
- **THEN** it says the system cannot handle the bitmap subtitles
- **AND** it explains that preparing a compatible copy requires FFmpeg
- **AND** it does not tell the user to convert to H.264/AAC

#### Scenario: Advanced details

- **GIVEN** any failure
- **WHEN** the user expands details
- **THEN** the panel shows the source strategy, container, video/audio codecs, subtitle types, failure code, and conversion state
- **AND** a "Copy diagnostics" action copies a redacted local diagnostic bundle

### Requirement: Learning features and timestamps survive compatibility playback

Compatibility preparation SHALL NOT create a new user-visible document, change
the document ID, change `document.filePath`, or alter existing transcripts,
extracts, saved positions, playback speed, audio-focus behavior, or
AI/learning relationships. The playback artifact SHALL be treated as an internal
source for the same logical document.

#### Scenario: Resume position

- **GIVEN** a video with a saved position of 42 seconds
- **WHEN** the compatibility artifact becomes ready and playback resumes
- **THEN** the media element seeks to 42 seconds
- **AND** the existing position-saving flow continues to store seconds

#### Scenario: Transcript synchronization

- **GIVEN** a video with transcript segments at original timestamps
- **WHEN** playback uses a compatibility artifact
- **THEN** `currentTime` and transcript segment times remain in the same coordinate system
- **AND** transcript-driven seeking still works

#### Scenario: Video extracts

- **GIVEN** existing video extracts with start/end times
- **WHEN** the video is played through an artifact
- **THEN** extract playback loops the same start/end times
- **AND** the document identity and extract records are unchanged

#### Scenario: Playback speed and audio focus

- **GIVEN** playback speed 1.5× and an active audio-focus lease
- **WHEN** the player switches to a compatibility artifact
- **THEN** the new source plays at 1.5×
- **AND** the existing lease is retained without acquiring a second one

### Requirement: Local media endpoints preserve authorization and security

The media server SHALL continue to bind only to loopback and SHALL serve a file
only when its canonical path is inside an app-managed root (app data, app cache,
or an app-created media subdirectory) or is the stored path of a registered
document. It SHALL reject symlink escapes, traversal, non-regular files, and
unauthorized out-of-root paths. Adding compatibility artifacts SHALL NOT
introduce a client-supplied path or a new unauthenticated endpoint.

#### Scenario: Symlink escape

- **GIVEN** a symlink inside an allowed root that points outside it
- **WHEN** the server authorizes the symlink path
- **THEN** canonicalization resolves the target
- **AND** the request is refused with `403`

#### Scenario: Unauthorized artifact

- **GIVEN** a client requests an artifact URL for a cache key not owned by the document
- **WHEN** the backend validates the request
- **THEN** the request is refused
- **AND** no cache path is exposed

#### Scenario: Imported-in-place document

- **GIVEN** a video imported in place outside app roots
- **AND** its path is the stored `file_path` of a registered document
- **WHEN** the viewer resolves the stream URL
- **THEN** the file is authorized and streamed
- **AND** the grant set remains bounded

### Requirement: Audiobook and podcast playback are not regressed

Changes to source resolution, MIME mapping, range handling, and error
classification SHALL preserve the existing audiobook/podcast loopback path,
including `.m4b`/`.m4a` `audio/mp4` typing, prepared audiobook files, range
seeking, progress, and mobile bounded-memory behavior.

#### Scenario: Audiobook still streams

- **GIVEN** an `.m4b` audiobook document
- **WHEN** it is opened on desktop or mobile
- **THEN** source resolution still uses the loopback server with `audio/mp4`
- **AND** playback and range seeking still work

#### Scenario: Podcast local file still streams

- **GIVEN** a podcast episode with a local audio path
- **WHEN** it is played
- **THEN** the existing audio path and error handling are unchanged
- **AND** no video compatibility job is started