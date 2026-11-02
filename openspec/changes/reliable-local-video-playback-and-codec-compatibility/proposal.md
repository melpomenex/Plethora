# Change: Reliable local video playback, codec compatibility, and media recovery

## Why

### Reported failure

A user on Arch Linux / Omarchy imported:

`WarGames.1983.2160p.UHD.Blu-ray.DV.x265.DTS-HD.MA.5.1.mkv`

The import succeeded and the document appeared in the video viewer, but playback failed immediately with:

> **Playback Error**
> This video codec is not supported. Please convert to MP4 (H.264/AAC). Some MP4 files use HEVC/H.265 or AV1 which are unsupported.

The diagnostic area simultaneously reported:

- Last source strategy: `local-media-server`
- Failure classification: `source-access`

Those claims contradict each other and, for this file, both are wrong.

### Verified file evidence

The file exists on the reporting machine and was inspected read-only with FFprobe (FFmpeg n9.0.2). It is valid and complete enough to probe:

| Property | Value |
| --- | --- |
| Container | Matroska (`matroska,webm`) |
| Size | 24,818,294,739 bytes (23.1 GiB) |
| Duration | 6,762.5 s (1:52:42.5) |
| Video | HEVC Main 10, 3840×2076, 24 fps, `yuv420p10le` |
| Color | BT.2020 / PQ (`smpte2084`) → HDR10 |
| Dolby Vision | profile 8, level 6, BL+RPU, HDR10-compatible (`dv_bl_signal_compatibility_id=1`) |
| Audio | DTS-HD MA, 5.1(side), 48 kHz, 24-bit, English, **no default disposition** |
| Subtitles | **5 × `hdmv_pgs_subtitle` (bitmap PGS)**, first English marked default |
| Other | One `attached_pic` MJPEG cover-art stream (must not be selected as the video track) |
| Chapters | None |

Filename-derived assumptions were therefore partly right (MKV, HEVC, 4K, DTS-HD MA, Dolby Vision) but the *actual* recovery-relevant fact was invisible from the filename: the file carries five **bitmap PGS subtitle tracks**.

### Verified runtime root cause

The failure was reproduced on the same Omarchy machine with WebKitGTK 2.54.1 and a Range-capable local HTTP server:

- A 60 s remux of the same video/audio streams **without** the PGS tracks plays natively at 4K HEVC Main 10 + DTS-HD MA 5.1.
- The same segment **with** the PGS track emits `MediaError.code === 4` and GStreamer reports:
  `pre_eventfunc_check: caps subpicture/x-pgs not accepted` → `matroskademux: streaming stopped, reason not-negotiated`.
- WebKitGTK's `canPlayType('video/x-matroska')` returns `"maybe"` for both files.
- A tiny HEVC+DTS MKV with **SubRip text** subtitles plays; the failure is specific to bitmap subtitle caps, not to Matroska, HEVC, HDR, or DTS in general.

The application then converts that `MediaError 4` into `source-access` because
`classifyLocalMediaError()` treats `"maybe"`/`"probably"` as evidence that the source is inaccessible. It also has a second, independent error path (`play()` rejecting with `NotSupportedError`) that prints the generic H.264/AAC conversion advice. The two paths disagree, which is exactly what the user saw.

On this machine the HEVC and DTS decoders are present (`avdec_h265`, `libde265dec`, `avdec_dca`, `dtsdec`), so missing Arch packages are **not** the cause of this reproduction. A Range-capable local HTTP server served both the failing PGS segment and the playing no-subtitle segment, so the failure is not explained by the absence of HTTP Range support either. The failure is an unhandled bitmap-subtitle stream plus a classifier that fabricates a source-access cause.

### Other verified defects

- `src-tauri/src/media_server.rs:211` maps only mp4/webm plus audio extensions. `.mkv`, `.mov`, `.avi`, `.m4v`, `.ts`, `.wmv`, `.flv`, `.mka`, and others become `application/octet-stream`. This is incorrect and can matter on engines that consult the response type, although WebKitGTK typefind played both `video/x-matroska` and `application/octet-stream` in the reproduction. It is not the root cause, but it must be fixed.
- `src/components/viewer/localMediaSources.ts:140` classifies `MEDIA_ERR_SRC_NOT_SUPPORTED` as `source-access` when `canPlayType()` says `maybe`/`probably`. `canPlayType('video/x-matroska')` only describes container demux support, not video/audio/subtitle decode support.
- `src/components/viewer/localMediaSources.ts:214` accepts `loadedmetadata` and `oncanplay` as "playable". On WebKitGTK both fire before a bitmap-subtitle pipeline failure. A metadata event is not proof of decodability.
- `src/components/viewer/localMediaSource.ts:260-291` falls back to reading the entire video through `readDocumentFile()` into JavaScript, which is capped at 256 MiB on desktop and is never appropriate for a movie. The cap turns a real error into a misleading "file too large" message after a large read attempt.
- `src/components/viewer/LocalVideoPlayer.tsx:773` and `:1223` are independent error producers. One writes codec-conversion advice from a `play()` rejection, the other writes a source-access classification from the media element. They can overwrite each other in the overlay and leave a contradictory toast.
- `PKGBUILD:9` depends on `gst-plugins-base` and `gst-plugins-good` only. A fresh Arch package therefore has Matroska demux but no HEVC/DTS decoder from `gst-plugins-bad`/`gst-libav`, and no `ffmpeg` for recovery. The reporting machine happens to have those packages installed, proving that package absence is a *separate*, environment-dependent failure mode rather than the explanation for every report.
- `scripts/ci-build-appimage.sh:144-178` bundles `libgstlibav.so` but not `libgstmatroska.so`, `libgstaudioparsers.so`, `libgstsoup.so`, or `libgstvolume.so`. The AppImage relies on host GStreamer for Matroska and HTTP source elements; that is not a self-contained guarantee.
- No component knows the actual container, video codec, audio codec, subtitle codec, HDR metadata, or track dispositions before playback. The app is guessing from the extension, a bare `canPlayType()` query, and a late `MediaError` code.

### Unverified hypotheses (do not treat as facts)

- The reporting user's install may also lack `gst-plugins-bad`/`gst-libav`. That would be a separate failure mode; the reference Omarchy machine has them, so it does not explain this reproduction.
- `Content-Type` may matter on WebView2/WKWebView or other WebKitGTK versions. It did not change playback of the tested Matroska files in WebKitGTK 2.54.1.
- A full 24 GB no-subtitle remux was not played end-to-end; a 60 s remux of the same streams was. The PGS failure is independent of file size in the captured GStreamer error.
- HDR/Dolby Vision display correctness (as opposed to decode acceptance) was not measured; the design therefore does not claim DV/HDR rendering fidelity.
- Windows, macOS, Android, and iOS behavior is specified but not proven on this machine; release validation is required.

### Why the current behavior is insufficient

Plethora cannot currently answer the three questions that determine recovery:

1. **What is in this file?** (container, video/audio/subtitle codecs, HDR, track layout)
2. **What can this runtime actually play?** (demuxers, decoders, bitmap subtitle support, container support)
3. **What is the least expensive reliable recovery?** (native, lossless remux, audio-only conversion, video transcode, or a precise limitation)

Without those answers, every failure is forced into a binary "source access vs. codec" guess. The result is misleading advice, no recovery for a file whose video and audio are perfectly playable, and a manual "convert to H.264/AAC" instruction that would needlessly destroy 4K HDR and DTS-HD MA quality.

## What Changes

- **Inspect before deciding.** Add a typed FFprobe-backed media inspection service that reports the real container, video streams (including profile, pixel format, frame rate, HDR/DV metadata, `attached_pic`), audio streams (codec, channels, language, disposition), subtitle streams (text vs bitmap), duration, and chapter information. Cache the inspection by a cheap source fingerprint.
- **Detect runtime capability honestly.** Combine (a) Linux GStreamer element discovery, (b) exact-codec `canPlayType()` declarations, (c) FFmpeg tool/encoder/filter discovery, and (d) real playback evidence. Return `supported`, `unsupported`, or `unknown`; never turn `"maybe"` into proof. Persist only document-scoped inspection and positive playback evidence; keep capability negatives session-scoped and refreshable.
- **Fix classification first.** Replace the two ad-hoc error producers with one evidence-based classifier. `source-access` requires a transport probe result (connection failure, 403, 404, 416, 5xx, zero bytes). A reachable `206`/`200` source plus a `MediaError 4` is a media/decoder/container/subtitle problem, or an explicit `media_compatibility_indeterminate` when the evidence is insufficient.
- **Make bitmap subtitles a first-class compatibility input.** On WebKitGTK, PGS bitmap subtitles were verified to break the pipeline even when video and audio are fully supported; DVD/DVB bitmap subtitle caps are treated as the same class pending platform tests. The decision engine selects a **lossless remux that omits subtitle tracks** in that case. It does not transcode video, does not transcode audio, and does not alter the original file. The omitted tracks are disclosed in advanced details and recorded in the artifact manifest. Text subtitles (SubRip/ASS/WebVTT) do not trigger this path (verified with SubRip and ASS).
- **Choose the least expensive strategy.** Native → lossless remux (including same-container subtitle stripping) → audio-only conversion → video transcode → actionable unavailable. Output container and codecs are selected from actual runtime support and stream compatibility, not from a hard-coded "always MP4/H.264".
- **Protect HDR and surround audio.** HDR10/HLG/Dolby Vision are detected. Native and remux paths copy the video bitstream unchanged. Any HDR→SDR conversion requires explicit consent, uses a verified tone-map chain, and is disclosed as quality-changing. Dolby Vision is never claimed as preserved: FFmpeg's MKV→MP4 remux was verified to retain the HDR10 base layer but **not** the DOVI configuration record. DV profile 5 is not automatically converted in P1. Channel layout is preserved up to 5.1; audio is not silently downmixed to stereo or switched to another language.
- **Process asynchronously with a real job lifecycle.** Rust owns conversion jobs, progress, cancellation, concurrency limits, disk checks, and cleanup. The React thread never runs FFmpeg and never holds whole media files. Jobs survive navigation inside the app, are deduplicated by cache key, and are marked interrupted rather than resumed after a crash.
- **Cache derived media safely.** Content-addressed artifacts under the app cache, separate from originals, with atomic publication, manifest validation, source-fingerprint invalidation, a configurable size limit (default 25 GB), LRU eviction, and a clear-cache action. A reopened movie reuses its artifact without invoking FFmpeg.
- **Preserve the learning experience.** The document ID, file path, saved position in seconds, playback speed, audio focus, transcript timestamps, extract timestamps, and AI/learning relationships are unchanged. A compatibility artifact is never a new document and never replaces the original. Conversion verifies a zero-based timeline and fails closed if duration/start-time checks do not pass.
- **Fix the local server and packaging.** Add a complete container MIME map, machine-readable HTTP errors, standards-consistent single-range behavior, HEAD coverage, managed media roots, and authorization regression tests. Add Arch dependencies for HEVC/DTS and FFmpeg, bundle the missing GStreamer plugins in the AppImage, verify bundled decoders at build time, and document the difference between FFmpeg's codecs and WebKitGTK/GStreamer's codecs.
- **Give users accurate choices.** A new **Media & Playback** settings section covers automatic/ask/never conversion, quality profile, hardware acceleration (verified before use), and cache usage/clearing. Failure states distinguish missing file, permission, server, range, container, video decoder, audio decoder, bitmap subtitle, corrupt media, missing dependency, conversion failure, cancellation, and insufficient storage. Technical details stay behind an expandable disclosure.

## Capabilities

### New Capabilities

- `local-media-playback`: Authorized loopback source resolution and streaming; native playback; transport evidence; unified failure classification; recovery/retry rules; subtitle and track handling at the player boundary; preserved learning integrations; server security and MIME/range correctness.
- `media-compatibility`: FFprobe-backed media inspection; runtime capability detection and uncertainty; the compatibility decision matrix; HDR/Dolby Vision policy; timestamp integrity; cross-platform capability boundaries; structured diagnostics.
- `media-processing`: FFmpeg discovery and safe invocation; remux/audio/video processing profiles; asynchronous job lifecycle; output verification; compatibility cache; storage/resource safeguards; settings; packaging and test-fixture strategy.

### Related, not modified

- `fix-desktop-audiobook-playback` (18/23) and `fix-mobile-audiobook-playback` (18/20) already establish the loopback server and its `audio/mp4`/range contract. This change preserves those semantics and reuses the server; it does not replace the audiobook path.
- `eliminate-long-running-memory-growth` (32/44) is removing whole-file desktop audio materialization. This change removes the equivalent whole-file **video** fallback and does not touch audio-edition/TTS ownership.
- `fix-linux-youtube-playback` (9/16) owns the WebKitGTK/AppImage environment and YouTube CSP. This change adds the missing media plugins and verification without changing the YouTube path.
- `fix-local-video-playback` (0/13) is **superseded and must not be implemented**. Its premise — `convertFileSrc()` as the desktop fast path plus a whole-file blob fallback — is obsolete: the repository now uses the loopback media server and declares no asset protocol. A supersession banner is added to that change. Its narrow "source vs codec" requirement is absorbed here with evidence-based semantics.

## User-Facing Benefit

- Videos that the system can already play continue to start directly, with no
  prompt, no conversion, and no quality change.
- A file like the reported 4K HEVC/DTS-HD Matroska plays through a fast,
  lossless subtitle-stripping remux instead of an unnecessary H.264/AAC
  conversion.
- When a real conversion is required, the user sees why, what will change
  (HDR/quality/audio/storage), progress, and a cancel action.
- Errors state the actual problem — missing file, permission, server, bitmap
  subtitles, container, video decoder, audio decoder, corrupt media, missing
  tool, or indeterminate — with a recovery action.
- The original file is never modified, and the learning experience (position,
  transcripts, extracts, speed, audio focus) is unchanged.
- A new Media & Playback settings section gives control over automatic
  conversion, quality, hardware use, and cache size without exposing FFmpeg
  flags.

## Impact

### Affected code (expected)

- Rust: `src-tauri/src/media_server.rs`; new `src-tauri/src/media_compat/{mod,types,probe,capabilities,decision,ffmpeg,jobs,cache,transport,commands}.rs`; `src-tauri/src/utils/ffmpeg.rs`; `src-tauri/src/database/{migrations.rs,media_compat_repository.rs}`; `src-tauri/src/lib.rs` command registration/state.
- Frontend: `src/components/viewer/{localMediaSource.ts,localMediaSources.ts,LocalVideoPlayer.tsx,DocumentViewer.tsx}`; new `src/lib/media/*`, `src/api/mediaCompatibility.ts`, `src/hooks/useMediaCompatibility.ts`, `src/components/viewer/MediaCompatibilityPanel.tsx`; `src/components/settings/{MediaPlaybackSettings.tsx,settingsSections.ts,SettingsPage.tsx,search/settingsSearchCatalog.ts,search/settingsSearchCoverage.ts}`; `src/stores/settingsStore.ts`; `src/lib/platformCapabilities.ts`; i18n locales.
- Packaging/docs: `PKGBUILD`, `scripts/ci-build-appimage.sh`, `scripts/__tests__/appimagePackaging.test.mjs`, `docs/LINUX_WEBKITGTK.md`, new `docs/media-compatibility.md`.
- Tests: Rust unit/integration tests, golden FFprobe JSON, generated media fixtures, frontend table tests, AppImage packaging tests, manual platform matrix.

### Packaging impact

- Arch: add `ffmpeg`, `gst-plugins-bad`, `gst-libav`; keep `gst-plugins-ugly` optional. Without these a fresh package cannot decode HEVC/DTS even though the code is correct.
- Debian/Ubuntu: the existing `tauri.conf.json` deb dependencies already include the full plugin set and `ffmpeg`; verify and test.
- AppImage: add `libgstmatroska.so`, `libgstaudioparsers.so`, `libgstsoup.so`, `libgstvolume.so`, `libgstogg.so`, `libgstvorbis.so`; retain `libgstlibav.so`; copy their non-GStreamer codec dependencies; verify the bundled set with an isolated `gst-inspect-1.0` run. Do **not** bundle FFmpeg in P1.
- Windows/macOS: continue using system FFmpeg (`PATH`, Homebrew, common Windows install locations); no silent download or installation. Native-only behavior remains available if FFmpeg is absent.

### Platform impact

- Linux/WebKitGTK: full pipeline, including GStreamer registry introspection and PGS-triggered remux. This is the reference platform for the reported case.
- Windows/WebView2 and macOS/WKWebView: full pipeline; capability evidence is `canPlayType` + real playback (no OS decoder enumeration in P1). MKV is generally not native, so remux/transcode is the normal recovery.
- Android/iOS: native playback + accurate diagnostics only; no FFmpeg conversion in P1. The app must explain the platform limitation rather than pretending conversion is available.
- Browser/PWA: native playback + accurate diagnostics only; no FFmpeg, no arbitrary file paths. Existing object-URL behavior is preserved for browser-imported `File` objects.

### Backward compatibility

- Audiobook and podcast playback, the media server's authorization model, and the existing `get_media_stream_url` contract remain intact.
- Documents, positions, transcripts, extracts, and learning relationships are untouched.
- Already-playable media continues to play natively with no prompt and no conversion.
- The old `fix-local-video-playback` change is not implemented; no contradictory code path is introduced.
- New settings have defaults that preserve current behavior for compatible media. Users who never encounter an incompatible file see no new UI beyond a new settings section.

### Risks

- **Still environment-dependent.** A machine that truly lacks HEVC/DTS decoders will need conversion or package installation. The proposal fixes the misleading diagnosis and offers recovery; it does not make missing decoders appear.
- **Conversion cost.** A 4K HDR movie can take hours to transcode. The design therefore prefers remux/audio-only paths, requires consent for full transcodes, and uses progress/cancellation. On the reference machine a 2 s 4K HDR→1080p SDR encode took 7.3 s wall / 89 s CPU, which is consistent with multi-hour full-movie transcodes.
- **Bitmap subtitle scope.** P1 omits bitmap subtitles from the derived artifact (they were never rendered by Plethora). Extracting them to a sidecar/OCR is P2. Text subtitle sidecar rendering is also P2.
- **Dolby Vision.** DV profile 8 can play as HDR10 on supporting hardware; DV signalling is not preserved through FFmpeg MP4 remux (verified). DV profile 5 is not automatically converted. The UI must not claim DV preservation.
- **Cross-platform verification.** Windows, macOS, Android, and iOS behavior is specified but cannot be proven on the Linux authoring machine; release validation is required on each platform.
- **AppImage plugin loading.** Bundled plugins can conflict with host GStreamer. The design preserves the existing "bundled first, host fallback, private registry" strategy and adds an isolated build-time verification.
- **Security.** New subprocess and cache surfaces are constrained to canonical authorized paths, generated output paths, fixed argument vectors, loopback-only probing, and app-cache storage. No shell interpolation, no network upload, no arbitrary file serving.

## Scope and Non-Goals

**In scope (P0/P1):** correct classification and diagnostics; MIME/range/server correctness; FFprobe inspection; capability detection; strategy selection; lossless remux; audio-only conversion; video transcode with consent; async jobs; cache; settings; Linux packaging/AppImage; cross-platform boundaries; regression tests; preservation of learning features.

**P2 / explicitly deferred:** progressive playback during conversion; segmented HLS/DASH-style output; subtitle extraction/rendering (text WebVTT sidecar or bitmap OCR); Dolby Vision profile 5 conversion; VAAPI/AMF hardware encode beyond the verified set; bundled FFmpeg; automatic background pre-conversion on import; multi-audio-track user selection UI; mobile conversion.

**Non-goals:** replacing the player or the media server; adding an online transcoding service; converting every import; forcing H.264/AAC; changing document identity; overwriting originals; reading whole movies into JavaScript; unbounded caches; bundling codecs without licensing review; assuming desktop and mobile capabilities are identical.

## Prioritization

### P0 — correctness and diagnosis (must ship together)

- Loopback MIME map and machine-readable HTTP errors.
- Transport probe and unified, evidence-based failure classification.
- Honest native-probe semantics; remove the two contradictory error producers.
- FFprobe inspection, source fingerprint, capability detection, and structured
  diagnostics for the reported file.
- Bitmap-subtitle detection and lossless subtitle-stripping remux planning.
- Regression tests for the reported shape; preservation of existing
  audiobook/podcast/transcript/extract behavior.
- Arch `PKGBUILD` codec/FFmpeg dependencies (without them, a fresh native
  package cannot use the recovery path).

### P1 — core compatibility experience

- Decision engine and least-expensive strategy selection.
- Lossless remux, audio-only conversion, and video transcoding.
- Asynchronous jobs, progress, cancellation, concurrency, disk safeguards, and
  crash recovery.
- Content-addressed compatibility cache with atomic publication, reuse,
  invalidation, limits, eviction, and clearing.
- Compatibility progress/consent/failure UX and the Media & Playback settings.
- AppImage plugin bundle and verification; Windows/macOS FFmpeg guidance.
- Cross-platform validation and the full test matrix.

### P2 — explicitly deferred enhancements

- Progressive/segmented playback during conversion.
- Text-subtitle extraction/rendering (WebVTT sidecar) and bitmap subtitle OCR.
- Dolby Vision profile 5 conversion.
- VAAPI/AMF hardware encoding beyond the verified NVENC/VideoToolbox/QSV set.
- OS-level decoder enumeration on Windows (Media Foundation) and macOS
  (VideoToolbox/AVFoundation) for stronger capability evidence than
  `canPlayType` + real playback.
- Bundled FFmpeg sidecar.
- Automatic background pre-conversion on import.
- Multi-audio-track user selection UI.
- Conversion on Android/iOS.
- Compatibility conversion in the NotebookLM artifact viewer and other ad-hoc
  media players (they remain native-only in P1).

P0/P1 architecture is specified in full even where a P2 enhancement is deferred;
no P2 item is required to make the reported file playable.

## Acceptance Scenario — Reported MKV

This is the required end-to-end regression scenario. It is not permission to
assume every platform has the same capabilities; where a platform cannot meet
it, the specified graceful behavior applies.

**Given** a user on Arch Linux imports a valid MKV containing HEVC/H.265 video,
DTS-HD audio, and bitmap PGS subtitles (the reported shape), and the file is
registered as a video document.

**When** the user opens the imported video in Plethora.

**Then:**

1. Plethora recognizes the container as Matroska, distinct from its codecs.
2. Plethora retrieves the file through its authorized local media server.
3. The server reports an appropriate media MIME type (`video/x-matroska`).
4. Plethora identifies the actual HEVC Main 10 HDR10/DV8 video, DTS-HD MA 5.1
   audio, five PGS subtitle tracks, and the attached cover stream.
5. Plethora evaluates container, video, audio, subtitle, and runtime
   compatibility with explicit evidence.
6. If native playback is supported and no incompatible subtitle stream is
   present, the video plays directly.
7. If the container alone is incompatible, Plethora selects lossless remuxing
   where the streams are supported.
8. If only the audio codec is incompatible, Plethora converts only the audio
   while copying compatible video.
9. If bitmap subtitles are the only incompatible element, Plethora selects a
   lossless remux that omits them; it does not transcode video or audio.
10. If the video codec is incompatible, Plethora offers an appropriate
    conversion path; 4K HDR/DV full transcoding requires explicit consent and
    discloses HDR/quality/storage implications.
11. Playback errors accurately distinguish source access (with transport
    evidence) from bitmap subtitle, container, video decoder, audio decoder,
    corrupt media, and indeterminate causes.
12. The original file remains byte-for-byte unchanged.
13. Seeking works through the existing Range server.
14. Playback position persists and resumes in the same seconds.
15. Transcript synchronization remains correct and transcript-driven seeking
    still works.
16. Existing video extracts (start/end times, queue membership, review) remain
    functional.
17. Reopening the video reuses the cached artifact and does not invoke FFmpeg.
18. Missing dependencies or unsupported media produce actionable guidance
    instead of a misleading generic codec error.

**Platform qualifier.** On Android/iOS/browser, where conversion is unavailable,
steps 7–10 become a precise `conversion_platform_unsupported` explanation with
no Convert action; step 6 still applies when the platform natively supports the
file. On Linux/Windows/macOS without FFmpeg, the native attempt and diagnostic
steps still apply, and conversion steps show dependency guidance.

## Definition of Success

1. The reported MKV is recognized as Matroska/HEVC Main 10 HDR10/DV8 + DTS-HD MA 5.1 with five bitmap PGS tracks and one attached cover stream.
2. On a Linux runtime with the required decoders, Plethora selects a lossless remux that drops the bitmap subtitles, plays the file, seeks correctly, and leaves the 24 GB original byte-for-byte unchanged.
3. On a runtime without HEVC or DTS, Plethora selects the least expensive working recovery (video-only or audio-only conversion) and explains why.
4. The UI never calls this failure `source-access` when the loopback server returned a valid `206`/`200`.
5. The UI never claims "codec not supported" without codec evidence, and never recommends H.264/AAC before inspecting the file.
6. Full transcodes of 4K HDR media require consent and disclose HDR/quality/storage implications.
7. Reopening the video reuses the cached artifact and does not invoke FFmpeg.
8. Position, speed, transcripts, extracts, and document identity are unchanged.
9. All defined unit, integration, packaging, and manual platform tests pass, and `openspec validate --strict` succeeds.
