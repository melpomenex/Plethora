# media-processing Specification Delta

## Purpose

Define the conversion and cache subsystem that turns a compatibility plan into a
verified, reusable playback artifact without blocking the UI, exhausting disk or
memory, degrading quality silently, weakening security, or changing the original
document.

## ADDED Requirements

### Requirement: FFmpeg and FFprobe are discovered without silent installation

The system SHALL use system-installed `ffmpeg` and `ffprobe` executables. It
SHALL resolve each independently from explicit environment overrides, platform
common locations, and `PATH`. It SHALL report availability and version. It SHALL
NOT download, install, or execute an arbitrary external binary as part of normal
operation.

#### Scenario: Both tools present

- **GIVEN** `ffmpeg` and `ffprobe` are on `PATH`
- **WHEN** capabilities are checked
- **THEN** both are reported available with versions
- **AND** conversion and inspection are enabled

#### Scenario: FFprobe only

- **GIVEN** `ffprobe` is present but `ffmpeg` is not
- **WHEN** a video is opened
- **THEN** inspection works
- **AND** native playback is attempted
- **AND** conversion is unavailable with `conversion_dependency_missing`

#### Scenario: FFmpeg only

- **GIVEN** `ffmpeg` is present but `ffprobe` is not
- **WHEN** a video is opened
- **THEN** native playback is attempted
- **AND** inspection is unavailable
- **AND** conversion is not started because output cannot be verified

#### Scenario: Neither tool

- **GIVEN** neither tool is installed
- **WHEN** a video fails natively
- **THEN** the UI reports the missing dependency with platform-specific guidance
- **AND** it does not attempt to install anything

### Requirement: Lossless remux copies streams and changes only the container/tracks

The remux profile SHALL copy the selected video and audio streams without
re-encoding, omit subtitle/data streams, preserve selected stream metadata, and
choose the least-change container that the runtime supports and that can hold
the copied codecs. It SHALL use `-c:v copy -c:a copy`, `-sn -dn`, explicit
absolute stream indices, and a zero-based timestamp policy.

#### Scenario: MKV H.264/AAC to MP4

- **GIVEN** H.264/AAC Matroska and a runtime that does not support Matroska
- **WHEN** remux runs
- **THEN** the output is MP4
- **AND** video and audio are copied
- **AND** no generation loss occurs
- **AND** `+faststart` is applied

#### Scenario: MKV HEVC/DTS with PGS to MKV

- **GIVEN** HEVC/DTS Matroska with PGS and a runtime that supports Matroska
- **WHEN** remux runs
- **THEN** the output is Matroska
- **AND** video/audio are copied
- **AND** subtitle streams are omitted
- **AND** HEVC/DTS quality is unchanged

#### Scenario: No audio stream

- **GIVEN** a video with no audio
- **WHEN** remux runs
- **THEN** the output contains the video stream only
- **AND** no empty audio track is invented

### Requirement: Audio-only conversion preserves the video bitstream

When the video stream is compatible but the selected audio stream is not, the
system SHALL copy the video stream and convert only the selected audio stream to
a target codec supported by the container and runtime. It SHALL preserve channel
layout up to 5.1, sample rate at 48 kHz, and language/title metadata. It SHALL
NOT re-encode video.

#### Scenario: HEVC/DTS to HEVC/AAC

- **GIVEN** HEVC video + DTS-HD MA 5.1 audio
- **AND** HEVC is supported but DTS is not
- **WHEN** audio-only conversion runs
- **THEN** the output video is copied HEVC
- **AND** the output audio is 5.1 AAC at 384 kbps
- **AND** the video bitstream is unchanged

#### Scenario: Stereo preserved

- **GIVEN** a stereo source requiring AAC
- **WHEN** conversion runs
- **THEN** the output remains stereo at 192 kbps
- **AND** it is not upmixed or downmixed

#### Scenario: Selected track only

- **GIVEN** multiple audio tracks with a default track
- **WHEN** conversion runs
- **THEN** only the selected track is mapped
- **AND** its metadata is preserved
- **AND** omitted tracks are recorded in the manifest

### Requirement: Video transcoding is a deliberate, quality-bounded fallback

When the video codec is incompatible, the system SHALL transcode to H.264 with
AAC audio (or copy compatible audio) in a broadly supported container. It SHALL
apply the configured quality profile, preserve the source frame rate/timing,
avoid unnecessary resolution changes, and use a verified HDR-to-SDR path when
the source is HDR.

#### Scenario: Balanced profile

- **GIVEN** a 4K source requiring H.264
- **AND** quality is `balanced`
- **WHEN** video transcoding runs
- **THEN** the output height is at most 1080p
- **AND** H.264 uses CRF 20 / `veryfast`
- **AND** the limitation `resolution_reduced` is recorded if scaling occurred

#### Scenario: Preserve-quality profile

- **GIVEN** a 4K source requiring H.264
- **AND** quality is `quality`
- **WHEN** video transcoding runs
- **THEN** the output keeps the source resolution
- **AND** H.264 uses CRF 18 / `medium`

#### Scenario: HDR source

- **GIVEN** an HDR10 source and tone-map filters are available
- **AND** the user consents
- **WHEN** video transcoding runs
- **THEN** the output is BT.709 SDR
- **AND** the tone-map chain is verified
- **AND** the limitation `hdr_converted_to_sdr` is recorded

#### Scenario: Variable frame rate

- **GIVEN** a variable-frame-rate source
- **WHEN** video transcoding runs
- **THEN** the version-appropriate passthrough frame mode is used
- **AND** output duration remains within tolerance of the source

### Requirement: Hardware encoding is used only after verification and falls back to software

When hardware acceleration is `auto`, the system SHALL detect candidate encoders
from FFmpeg, run a short canary encode, verify the canary output, and use the
encoder only if it passes. It SHALL fall back to software after a hardware
failure. When hardware acceleration is `off`, it SHALL use software only.

#### Scenario: Working hardware encoder

- **GIVEN** `h264_nvenc` is available and the canary passes
- **WHEN** a video transcode starts
- **THEN** NVENC is used
- **AND** the plan/manifest records the hardware encoder

#### Scenario: Broken hardware encoder

- **GIVEN** a candidate encoder fails the canary or produces an undecodable output
- **WHEN** the plan/job runs
- **THEN** it is not used
- **AND** software `libx264` is used
- **AND** the fallback is logged

#### Scenario: Hardware failure during a job

- **GIVEN** a hardware encode fails mid-job
- **WHEN** no artifact has been published
- **THEN** the partial output is deleted
- **AND** the job retries once in software
- **AND** the user sees progress continue rather than a hard failure

#### Scenario: Hardware off

- **GIVEN** the setting is `off`
- **WHEN** a video transcode runs
- **THEN** no hardware encoder is attempted

### Requirement: Conversion runs asynchronously with progress, cancellation, and limits

Conversion SHALL run in Rust-owned asynchronous jobs, never on the React
rendering thread. Jobs SHALL emit structured progress events, support
cancellation, enforce concurrency limits, deduplicate identical work, recover
from crashes, and keep the UI responsive.

#### Scenario: Long conversion

- **GIVEN** a multi-hour 4K transcode
- **WHEN** it runs
- **THEN** the UI remains usable
- **AND** progress events report processed time/duration/speed
- **AND** percent is indeterminate when duration is unknown
- **AND** no FFmpeg work blocks React

#### Scenario: Cancellation

- **GIVEN** a running job
- **WHEN** the user cancels
- **THEN** the FFmpeg process is terminated within 2 seconds
- **AND** the staging directory is deleted
- **AND** the job state becomes `cancelled`
- **AND** no partial artifact is published

#### Scenario: Duplicate request

- **GIVEN** two tabs/callers request the same cache key
- **WHEN** the second request arrives
- **THEN** it receives the existing job/event
- **AND** only one FFmpeg process runs

#### Scenario: Concurrency limits

- **GIVEN** one video transcode and two audio/remux jobs are requested
- **WHEN** jobs are scheduled
- **THEN** at most 1 video transcode and 2 light jobs run concurrently
- **AND** additional jobs remain queued

#### Scenario: Navigation away

- **GIVEN** a running job
- **WHEN** the user navigates to another document
- **THEN** the job continues in the background
- **AND** returning to the document can reattach to its state

#### Scenario: App exit

- **GIVEN** a running job
- **WHEN** the app exits or crashes
- **THEN** the next startup marks the job interrupted
- **AND** staging files are cleaned
- **AND** no job auto-resumes

### Requirement: Compatibility cache is content-addressed, atomic, and reusable

The system SHALL store derived artifacts in the app cache under a key derived
from document identity, canonical source path, source fingerprint, inspection
hash, selected streams, subtitle policy, output profile, pipeline version, and
tool versions. It SHALL publish outputs atomically and reuse them only when all
validation checks pass.

#### Scenario: Cache key stability

- **GIVEN** the same document, fingerprint, streams, policy, and tool versions
- **WHEN** the key is computed twice
- **THEN** it is identical
- **AND** it changes when any relevant input changes

#### Scenario: Atomic publication

- **GIVEN** a job that finishes encoding successfully
- **WHEN** it publishes
- **THEN** the manifest and output appear together under the final key
- **AND** a crash cannot expose a half-written artifact as ready

#### Scenario: Reuse

- **GIVEN** a valid artifact and unchanged fingerprint/tool versions
- **WHEN** the user reopens the video
- **THEN** the artifact is reused
- **AND** FFmpeg is not invoked

#### Scenario: Invalidation

- **GIVEN** the original file changes, the pipeline version changes, or FFmpeg/FFprobe changes
- **WHEN** the cache is checked
- **THEN** the old artifact is not reused
- **AND** a new plan/job is produced or reused as appropriate

#### Scenario: Corrupt cache entry

- **GIVEN** a manifest without its output, or an output with a mismatched size
- **WHEN** the cache is checked
- **THEN** the entry is treated as invalid
- **AND** it is not served or reused
- **AND** it is cleaned up

### Requirement: Cache growth is bounded and user-controlled

The system SHALL enforce a configurable cache size limit (default 25 GB, range
5–500 GB), evict by least-recent access, exclude the currently running job's
staging, and provide a clear-cache action. It SHALL refuse a conversion whose
planned output cannot fit the cache limit. It SHALL never count or delete
original media.

#### Scenario: Limit exceeded

- **GIVEN** cache usage above the configured limit
- **WHEN** eviction runs
- **THEN** artifacts are deleted oldest-accessed first
- **AND** usage drops to at most 90% of the limit
- **AND** originals are untouched

#### Scenario: Artifact larger than the limit

- **GIVEN** a planned output floor above the cache limit
- **WHEN** the plan is produced
- **THEN** conversion is unavailable with `cache_limit_too_small`
- **AND** the UI offers cache management

#### Scenario: Clear cache

- **GIVEN** no active job
- **WHEN** the user clears the compatibility cache
- **THEN** derived artifacts and rows are removed
- **AND** the original documents remain
- **AND** usage is reported as zero

#### Scenario: Clear while converting

- **GIVEN** an active job
- **WHEN** the user clears the cache
- **THEN** the request is refused with `conversion_in_progress`
- **AND** the active artifact is not deleted under the running process

### Requirement: Conversion is bounded by disk, memory, CPU, and time

The system SHALL preflight free disk space, monitor it during encoding, cap
FFmpeg threads, cap log buffers, enforce a no-progress watchdog and a maximum
job duration, and fail safely when a resource is exhausted.

#### Scenario: Insufficient disk at start

- **GIVEN** free disk below the required floor
- **WHEN** a job is requested
- **THEN** it is not started
- **AND** the user sees `insufficient_storage` with cache-management guidance

#### Scenario: Disk fills during encoding

- **GIVEN** free disk falls below 512 MiB while encoding
- **WHEN** the watchdog checks
- **THEN** FFmpeg is terminated
- **AND** staging is deleted
- **AND** the job fails with `insufficient_storage`

#### Scenario: No progress

- **GIVEN** no FFmpeg progress for 120 seconds
- **WHEN** the watchdog fires
- **THEN** the job fails with `conversion_failed` and detail `no_progress`
- **AND** the process is killed

#### Scenario: Memory

- **GIVEN** a large video
- **WHEN** inspection/conversion runs
- **THEN** no whole-file JavaScript buffer exists
- **AND** probe stdout is capped
- **AND** stderr is capped to a 64 KiB tail

### Requirement: Conversion output is verified and timeline-safe

The system SHALL verify stream count/codecs/container, zero-based start time,
duration tolerance, A/V first-PTS alignment, preserved HDR metadata for copied
video, and a short decode before publishing. It SHALL fail closed on mismatch.

#### Scenario: Valid remux

- **GIVEN** a completed remux
- **WHEN** verification runs
- **THEN** it confirms expected streams and duration
- **AND** it decodes the first two seconds successfully
- **AND** it publishes the artifact

#### Scenario: Timestamp drift

- **GIVEN** an output whose start time is not zero or whose duration is outside tolerance
- **WHEN** verification runs
- **THEN** the artifact is rejected
- **AND** no cache row is marked ready
- **AND** the user sees `conversion_verification_failed`

#### Scenario: HDR metadata copy

- **GIVEN** a copied HDR10 video stream
- **WHEN** verification runs
- **THEN** the output still reports BT.2020/PQ color metadata
- **AND** a copied stream that lost its color metadata fails verification

### Requirement: Conversion settings are small, coherent, and persistent

The system SHALL provide exactly these user-facing compatibility settings:
compatibility mode (`automatic-inexpensive`, `ask`, `never`), conversion quality
(`balanced`, `quality`), hardware acceleration (`auto`, `off`), and cache limit
(GB). Defaults SHALL be automatic-inexpensive, balanced, auto, and 25 GB. The
settings SHALL be persisted with the existing settings store and merged/clamped
on hydration.

#### Scenario: Defaults

- **GIVEN** a new or pre-existing installation with no media settings
- **WHEN** the settings are loaded
- **THEN** the defaults above apply
- **AND** compatible media plays without prompts or conversion

#### Scenario: Ask mode

- **GIVEN** compatibility mode is `ask`
- **WHEN** a remux is required
- **THEN** the user is asked before the job starts
- **AND** the dialog explains the operation and any quality/storage impact

#### Scenario: Never mode

- **GIVEN** compatibility mode is `never`
- **WHEN** playback requires conversion
- **THEN** no job starts
- **AND** the UI reports the limitation and offers diagnostics
- **AND** native playback remains available

#### Scenario: Invalid persisted value

- **GIVEN** a persisted cache limit of `0` or `NaN`
- **WHEN** settings hydrate
- **THEN** it is clamped to the valid range or replaced with 25

### Requirement: Processing is secure and privacy-preserving

The system SHALL pass arguments as an argument vector with no shell, use
generated output paths under the app cache, canonicalize/authorize inputs,
create private staging directories, confine artifacts to approved storage, and
avoid network access. It SHALL not expose full user paths in diagnostics.

#### Scenario: Malicious filename

- **GIVEN** a filename containing spaces, quotes, newlines, `;`, `$()`, or `..`
- **WHEN** a conversion runs
- **THEN** the filename is passed as a single argument
- **AND** no shell interprets it
- **AND** the output remains under the cache root

#### Scenario: Symlinked cache root

- **GIVEN** the cache root or staging path resolves outside the approved cache directory
- **WHEN** a job starts
- **THEN** the job is refused
- **AND** no output is written outside approved storage

#### Scenario: No network

- **GIVEN** a local conversion
- **WHEN** it runs
- **THEN** FFmpeg receives no remote URL
- **AND** the app makes no upload request

#### Scenario: Temp cleanup

- **GIVEN** a failed/cancelled job
- **WHEN** cleanup runs
- **THEN** staging files are removed
- **AND** no arbitrary path outside staging is deleted

### Requirement: Linux packaging provides codecs and conversion tools

Native Linux packages and the AppImage SHALL make the required WebKitGTK/
GStreamer codecs discoverable and SHALL document the FFmpeg requirement. The
AppImage SHALL bundle the Matroska demuxer, audio parsers, HTTP source, volume,
and libav plugins needed for common local video, and SHALL verify the bundled
set at build time.

#### Scenario: Arch package

- **GIVEN** a fresh Arch install of the native package
- **WHEN** a user opens an MKV HEVC/DTS file
- **THEN** GStreamer has `matroskademux`, an HEVC decoder, and a DTS decoder
- **AND** `ffmpeg`/`ffprobe` are available for recovery
- **AND** no manual codec installation is required for the supported formats

#### Scenario: AppImage bundle

- **GIVEN** the AppImage build
- **WHEN** the plugin bundle is verified
- **THEN** `matroskademux`, `qtdemux`, `souphttpsrc`, `volume`, and an HEVC decoder are discoverable from the bundled path
- **AND** a DTS decoder is present
- **AND** host-only plugins cannot produce a false pass

#### Scenario: FFmpeg absent on AppImage

- **GIVEN** an AppImage host without FFmpeg
- **WHEN** a video requires conversion
- **THEN** native playback is still attempted
- **AND** the UI explains how to install FFmpeg for the distribution
- **AND** no binary is downloaded

### Requirement: Windows, macOS, and mobile boundaries are explicit

Windows and macOS SHALL use system FFmpeg with platform-specific discovery and
guidance. Android and iOS SHALL NOT invoke FFmpeg or offer conversion. Browser/
PWA SHALL NOT invoke Rust commands. The app SHALL not assume identical codecs
across platforms.

#### Scenario: Windows without FFmpeg

- **GIVEN** WebView2 can play MP4 natively but FFmpeg is absent
- **WHEN** an MKV requires remux
- **THEN** the UI explains that preparing the file requires FFmpeg
- **AND** it provides Windows install guidance
- **AND** MP4 native playback is unaffected

#### Scenario: macOS VideoToolbox

- **GIVEN** VideoToolbox is available and the canary passes
- **WHEN** a full transcode runs with `auto`
- **THEN** VideoToolbox may be used
- **AND** software fallback is available
- **AND** Homebrew FFmpeg is discovered when PATH is absent

#### Scenario: Android unsupported file

- **GIVEN** a file requiring conversion on Android
- **WHEN** playback fails
- **THEN** no conversion job is started
- **AND** the UI states the platform limitation

### Requirement: Test fixtures are small, synthetic, and redistributable

The project SHALL test with generated synthetic media and golden FFprobe JSON,
not copyrighted movies or multi-gigabyte files. Bitmap-subtitle coverage SHALL
use an optional externally supplied PGS fixture or golden metadata when no
encoder is available.

#### Scenario: Generated fixtures

- **GIVEN** the fixture generator runs with FFmpeg and encoders available
- **WHEN** it produces MP4/WebM/MKV/HEVC/DTS/AV1 fixtures
- **THEN** the files are small and synthetic
- **AND** they are not shipped in release bundles
- **AND** tests skip explicitly when a required encoder is absent

#### Scenario: No movie content

- **GIVEN** the repository
- **WHEN** fixtures are inspected
- **THEN** no copyrighted movie or large 4K file is committed
- **AND** the reported real file is referenced only as documented evidence, never copied

### Requirement: Processing performance is measured and bounded

The system SHALL instrument inspection, planning, job progress, and cache reuse.
It SHALL avoid eager probing, duplicate conversions, unbounded buffers, and
UI-thread work. Measured targets SHALL be recorded and verified on the release
platform matrix.

#### Scenario: Inspection overhead

- **GIVEN** a local file up to 30 GB
- **WHEN** inspection runs
- **THEN** it completes within the documented p50/p95 targets
- **AND** the UI is not blocked

#### Scenario: Cache reuse

- **GIVEN** a valid cached artifact
- **WHEN** the video is reopened
- **THEN** no FFmpeg invocation occurs
- **AND** the artifact URL is available within the documented target

#### Scenario: Full transcode cost

- **GIVEN** a 4K HDR movie requiring full transcoding
- **WHEN** the plan is produced
- **THEN** it is marked as requiring consent
- **AND** the UI explains that it can take a long time and significant disk
- **AND** no precise ETA is fabricated

### Requirement: Audiobook/podcast processing remains unchanged

The new processing subsystem SHALL NOT replace or reroute the existing
`prepare_audiobook_playback` cache/transcode, podcast chunking, transcription,
or audio-edition pipelines. Shared FFmpeg discovery MAY be reused, but their
behavior and file locations SHALL remain compatible.

#### Scenario: M4B preparation

- **GIVEN** an `.m4b` audiobook
- **WHEN** playback is prepared
- **THEN** the existing audiobook preparation path is used
- **AND** no `media_compat` artifact/document is created

#### Scenario: Podcast chunking

- **GIVEN** a podcast transcription job
- **WHEN** audio chunks are produced
- **THEN** the existing FFmpeg chunking path is used
- **AND** the compatibility cache is not involved