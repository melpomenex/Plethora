# Tasks: Reliable local video playback, codec compatibility, and media recovery

> **Execution rule.** Work top-to-bottom. Do not start a task until its
> dependencies are complete. Every task names the file/module, the required
> behavior, edge cases, and the test that proves completion. If a task's
> assumption conflicts with the source, stop and record the conflict before
> changing the design.
>
> **Do not implement the superseded `fix-local-video-playback` change.** Phase 0
> marks it superseded. Its `convertFileSrc`/blob premise is obsolete.

## Phase 0 — Baseline, reconciliation, and guardrails

- [x] **0.1 Record the verified baseline**
  - **Files:** `openspec/changes/reliable-local-video-playback-and-codec-compatibility/proposal.md` (already contains the evidence).
  - **Behavior:** Confirm the audit commit, the actual-file FFprobe facts, and the WebKitGTK PGS reproduction. Do not re-probe or copy the movie into the repo.
  - **Test:** `openspec show reliable-local-video-playback-and-codec-compatibility` includes the proposal; no movie bytes exist in the change.
  - **Depends on:** none.

- [x] **0.2 Mark the old local-video change superseded**
  - **Files:** `openspec/changes/fix-local-video-playback/proposal.md`, `openspec/changes/fix-local-video-playback/tasks.md`, `openspec/changes/fix-local-video-playback/design.md`.
  - **Behavior:** Add a top banner to each: "STATUS: SUPERSEDED — DO NOT IMPLEMENT. See `reliable-local-video-playback-and-codec-compatibility`." Explain that the asset-protocol fast path and whole-file blob fallback are obsolete. Do not check or delete its tasks.
  - **Test:** `grep -R "SUPERSEDED" openspec/changes/fix-local-video-playback` returns three files.
  - **Depends on:** 0.1.

- [x] **0.3 Add coordination notes for related changes**
  - **Files:** the new `proposal.md` (already has a "Related, not modified" section).
  - **Behavior:** Confirm the notes for `fix-desktop-audiobook-playback`, `fix-mobile-audiobook-playback`, `eliminate-long-running-memory-growth`, `fix-linux-youtube-playback`, and `fix-local-video-playback`. Do not modify those changes' specs/tasks.
  - **Test:** The proposal names all five changes and states which behavior is preserved.
  - **Depends on:** 0.2.

- [x] **0.4 Baseline the existing tests**
  - **Files:** `src/components/viewer/__tests__/localMediaSource.test.ts`, `src/components/viewer/__tests__/LocalVideoPlayer.sourceResolution.test.tsx`, `src-tauri/src/media_server.rs` tests.
  - **Behavior:** Run the current suites and record the exact commands/results in the change notes. Do not change expectations yet.
  - **Test:** `npm run test:run -- src/components/viewer/__tests__/localMediaSource.test.ts src/components/viewer/__tests__/LocalVideoPlayer.sourceResolution.test.tsx` and `cargo test media_server` pass before edits.
  - **Depends on:** none.

- [x] **0.5 Add a regression fixture manifest for the reported media shape**
  - **Files:** new `src-tauri/tests/fixtures/media/README.md`, new `scripts/media-fixtures/generate.sh`, new `scripts/media-fixtures/verify.sh`.
  - **Behavior:** Document the exact codec/container/subtitle shapes to generate. Do not commit a movie. The manifest includes `mkv-hevc-dts-pgs` as "external/optional fixture" with instructions to point `PLETHORA_PGS_FIXTURE` at a legally obtained PGS MKV.
  - **Test:** `scripts/media-fixtures/generate.sh --list` prints fixture names without requiring FFmpeg; `verify.sh` exits 0 when tools are absent and prints skips.
  - **Depends on:** 0.1.

## Phase 1 — Media server correctness, MIME, ranges, and authorization

- [x] **1.1 Complete the media content-type map**
  - **Files:** `src-tauri/src/media_server.rs` (`media_content_type`).
  - **Behavior:** Return the mappings in the spec: `video/x-matroska` for mkv, `audio/x-matroska` for mka, `video/quicktime` for mov, `video/x-msvideo` for avi, `video/x-m4v` for m4v, `video/mp2t` for ts/m2ts, `video/x-flv` for flv, `video/x-ms-wmv` for wmv, `video/3gpp` for 3gp, `video/ogg` for ogv, `video/mpeg` for mpg/mpeg, `audio/webm` for weba, `audio/aiff` for aiff, `audio/x-ms-wma` for wma, `audio/x-ape` for ape, plus the existing audio types. Unknown → `application/octet-stream`.
  - **Edge cases:** case-insensitive extensions; files with no extension; dotted names (`.tar.mkv`); non-UTF8 extension → octet-stream.
  - **Test:** table-driven `media_content_type` unit test for every mapping; integration `/stream` test asserts `.mkv` → `video/x-matroska`.
  - **Depends on:** 0.4.

- [x] **1.2 Add machine-readable server errors**
  - **Files:** `src-tauri/src/media_server.rs`.
  - **Behavior:** For 403/404/416/500, return a small JSON body `{ "code": "...", "message": "..." }` and an `X-Plethora-Media-Error` response header. Codes: `media_forbidden`, `media_permission_denied`, `media_not_found`, `media_range_not_satisfiable`, `media_stat_failed`, `media_seek_failed`, `media_server_unavailable`. Map `File::open` `PermissionDenied` to `403 media_permission_denied`; map `NotFound` to `404 media_not_found`; other open/stat/seek failures to 500 with the relevant code. Keep the human text short. Do not include the full path.
  - **Edge cases:** header value must be a valid ASCII token; body serialization must not fail; HEAD errors must have no body but keep the header/status.
  - **Test:** router tests for each status/code/header; `to_bytes` body parses as JSON.
  - **Depends on:** 1.1.

- [x] **1.3 Harden and test range parsing**
  - **Files:** `src-tauri/src/media_server.rs` (`parse_range`, handler).
  - **Behavior:** Keep the existing contract (single valid range → 206; malformed/multi/unsatisfiable → 416 with `bytes */total`). Add trimming of whitespace, suffix `-N`, open-ended `N-`, end clamping, `-0` unsatisfiable, empty file, and `start >= total`. `Content-Length`/`Content-Range` must match the actual bytes. Do not change to RFC-lenient 200 for malformed ranges (the active `fix-mobile-audiobook-playback` spec requires 416); document this in the code comment.
  - **Edge cases:** `bytes=0-0`, `bytes=0-`, `bytes=-1`, `bytes=999999-`, huge u64 values (no overflow), multiple ranges, non-bytes unit, empty header.
  - **Test:** table-driven `parse_range` tests plus router tests for 206/416 headers/body; a test that `Content-Length` equals the returned body length.
  - **Depends on:** 1.2.

- [x] **1.4 Verify HEAD and zero-length behavior**
  - **Files:** `src-tauri/src/media_server.rs` tests.
  - **Behavior:** HEAD returns the same status/headers as GET with no body; a zero-length authorized file returns 200 with `Content-Length: 0`; a range request on it returns 416 with `bytes */0`.
  - **Test:** router tests using `Method::HEAD` and an empty temp file.
  - **Depends on:** 1.3.

- [x] **1.5 Prove large-file responses stay lazy**
  - **Files:** `src-tauri/src/media_server.rs` tests.
  - **Behavior:** Keep the existing sparse 64 MiB test and add a >4 GiB sparse fixture on Unix (skip on filesystems without sparse support). Constructing a response must not read the body; `Content-Length` must be the file size; a range near the end returns the correct suffix.
  - **Edge cases:** `u64` offsets above 4 GiB; `Content-Range` totals; no `usize` truncation.
  - **Test:** `large_file_response_keeps_streaming_body_lazy` + `range_near_4gib_boundary`.
  - **Depends on:** 1.3.

- [x] **1.6 Add managed legacy media roots without weakening authorization**
  - **Files:** `src-tauri/src/media_server.rs` (`allowed_media_roots`).
  - **Behavior:** Add `dirs::data_dir()/incrementum/videos` and `dirs::data_dir()/incrementum/audio` (canonicalized when they exist) to the allowed roots. Ensure app data/cache and these media directories exist (best-effort create) before canonicalizing, so a first-run missing directory cannot make an otherwise valid root disappear. Keep app data/cache and the registered-document grant. Do not add the whole `incrementum` directory.
  - **Edge cases:** directories missing; symlinked directories; a sibling file under `incrementum` must still be refused; non-UTF8 paths.
  - **Test:** integrated authorization tests: file under `videos` streams; file under `incrementum/` sibling is 403; symlink from `videos` to outside is 403; existing app-data/cache tests still pass.
  - **Depends on:** 1.1.

- [x] **1.7 Add structured request and startup diagnostics**
  - **Files:** `src-tauri/src/media_server.rs`.
  - **Behavior:** Log a request ID (UUID), file basename, status, range header (redacted to a bounded length), elapsed ms, and error code for every request. Log bind failure with the OS error. Do not log full paths or bytes.
  - **Test:** capture `tracing` output in a unit test? If impractical, assert log calls compile and add a `#[tracing_test]`-style test only if the crate is available; otherwise document the manual log inspection and test the fields via a pure `RequestLog` struct.
  - **Depends on:** 1.2.

- [x] **1.8 Preserve mobile/audiobook HTTP contracts**
  - **Files:** `src-tauri/src/media_server.rs` tests, `src/components/viewer/__tests__/localMediaSource.test.ts`.
  - **Behavior:** Confirm `.m4b`/`.m4a` → `audio/mp4`, full/206/416 semantics, and no regression to the bounded grant set or mobile range path.
  - **Test:** existing tests plus a new `.m4b` content-type assertion; run the audiobook source-resolution tests.
  - **Depends on:** 1.3, 1.6.

- [x] **1.9 Extract a reusable authorized stream-URL helper**
  - **Files:** `src-tauri/src/media_server.rs`.
  - **Behavior:** Refactor the body of `get_media_stream_url` into a `pub(crate) async fn mint_stream_url(app_handle, file_path, repo, purpose: &str) -> Result<String, String>` that authorizes, grants, starts the server, and returns the URL. Keep the public command's signature/behavior unchanged. Use the helper from `get_media_compatibility_artifact_url` with `purpose="media_compat"` so logs distinguish artifact streams from audiobook sources.
  - **Edge cases:** calling before the server starts; out-of-root document path; artifact under app cache; path with spaces/unicode.
  - **Test:** existing media-server tests still pass; a unit test asserts the helper returns a loopback URL and the command's output is unchanged.
  - **Depends on:** 1.6.

## Phase 2 — Error taxonomy, transport evidence, and unified classification

- [x] **2.1 Define the Rust failure taxonomy and error type**
  - **Files:** new `src-tauri/src/media_compat/mod.rs`, new `src-tauri/src/media_compat/types.rs`.
  - **Behavior:** Add `MediaFailureCode` with every code in D10, serde `snake_case`; `MediaCompatError { type: "media_compat", code, message, detail, retryable }` with `Debug`, `Serialize`, and `Display`; `MEDIA_COMPAT_SCHEMA_VERSION = 1`; `COMPAT_PIPELINE_VERSION = 1`. No behavior yet.
  - **Edge cases:** unknown/legacy strings must not panic; error messages must not contain paths; `detail` is optional.
  - **Test:** serde round-trip/string tests for every code; `MediaCompatError` serializes camelCase fields.
  - **Depends on:** 0.4.

- [x] **2.2 Register the module and no-op state**
  - **Files:** `src-tauri/src/lib.rs`.
  - **Behavior:** Add `mod media_compat;` and a `MediaCompatState` placeholder managed in setup (actual fields added in Phase 7). Do not register commands yet.
  - **Test:** `cargo check` passes; no command registration changes yet.
  - **Depends on:** 2.1.

- [x] **2.3 Implement the loopback-only transport probe**
  - **Files:** new `src-tauri/src/media_compat/transport.rs`.
  - **Behavior:** `probe(url)` accepts only `http://127.0.0.1:<media_server::port()>/stream?path=...` (also `localhost`/`[::1]` only if the server is bound there). Uses `reqwest` with `GET`, `Range: bytes=0-1`, 3 s timeout, redirects disabled, reads at most 2 bytes, returns status/content-type/content-length/accept-ranges/content-range/elapsed/error. Rejects non-`http` schemes, non-loopback hosts, other ports, userinfo, and non-`/stream` paths with `probe_unsupported_url` detail.
  - **Edge cases:** server not started (port 0), connection refused, timeout, 403/404/416/500, empty body, chunked response, IPv6 literal.
  - **Test:** unit tests with a local axum test server; SSRF rejection tests; timeout test with a delayed handler.
  - **Depends on:** 2.1, 1.2.

- [x] **2.4 Add the `probe_media_transport` command**
  - **Files:** new `src-tauri/src/media_compat/commands.rs`, `src-tauri/src/lib.rs`.
  - **Behavior:** Expose `probe_media_transport(url)` returning `MediaTransportProbe` or a typed error. Do not accept arbitrary URLs. Register in `generate_handler`.
  - **Test:** command calls transport; invalid URL returns `source_transport_failed` with `probe_unsupported_url`.
  - **Depends on:** 2.3.

- [x] **2.5 Add shared TypeScript types**
  - **Files:** new `src/lib/media/types.ts`.
  - **Behavior:** Mirror every Rust type/enum used by the frontend: failure codes, inspection, capabilities, plan, policy, job event, cache usage, transport probe, declared support. Keep it type-only (no React/Tauri imports).
  - **Test:** `tsc --noEmit`; a type-level test file assigns representative literals.
  - **Depends on:** 2.1.

- [x] **2.6 Add the compatibility API wrappers**
  - **Files:** new `src/api/mediaCompatibility.ts`.
  - **Behavior:** Typed wrappers around `invokeCommand` for all media-compat commands (inspection, capabilities, planning, jobs, artifacts, cache usage/prune/clear, transport); event subscription helper for `media-compat:job`; pure `mapInvokeError` that reads `code`/`detail`/`retryable` from a structured Tauri rejection. No React imports.
  - **Edge cases:** non-Tauri environment throws a clear `unsupported_platform` error; malformed event payloads are ignored with a diagnostic.
  - **Test:** mock `invokeCommand`, assert exact command names/args; structured error mapping; unsubscribe calls.
  - **Depends on:** 2.4, 2.5.

- [x] **2.7 Preserve structured error fields in `invokeCommand`**
  - **Files:** `src/lib/tauri.ts` (`coerceError`).
  - **Behavior:** When a Tauri rejection is an object with a string `type` **or** a string `code`, copy `type`, `code`, `detail`, `retryable`, `jobId`, and `documentId` onto the resulting `Error` (in addition to the message). `MediaCompatError` serializes `type: "media_compat"` and `code`. Do not change the message/coercion for existing errors.
  - **Edge cases:** `code` non-string; cyclic objects; `message` missing; legacy integration-auth error.
  - **Test:** unit tests for `coerceError` with a structured media error (asserts `code`/`detail`/`retryable`) and an existing integration-auth error.
  - **Depends on:** 2.1.

- [x] **2.8 Implement the pure failure classifier**
  - **Files:** new `src/lib/media/errorClassification.ts`.
  - **Behavior:** Implement D2/D11 precedence. Inputs: media error code, play error name/message, transport probe, inspection, capabilities, declared support, plan, strategy, timeout/abort. Output: `MediaPlaybackFailure { code, messageKey, detail, retryable, actions, evidence }`. Never returns `source-access`; source codes require transport evidence. Bitmap subtitle presence + code 4 → `bitmap_subtitle_unsupported` only on Linux/WebKitGTK; on other platforms keep indeterminate unless container/decoder evidence is stronger. `NotAllowedError` is not a media failure (show the click-to-play affordance); `AbortError` from a pause/source switch is ignored.
  - **Edge cases:** healthy transport + no inspection → indeterminate; 403 + code 4 → permission; 404 → not found; 416 → range; code 1 → interrupted; code 3 with decoders present → initialization failed; missing duration; multiple missing decoders → primary video/audio/subs with `alsoUnavailable`.
  - **Test:** exhaustive table, including the exact reported combination (`206` + code 4 + PGS + `canPlayType=maybe` → `bitmap_subtitle_unsupported`), and every code's retryability/actions.
  - **Depends on:** 2.5.

- [x] **2.9 Replace `classifyLocalMediaError` with an evidence-required wrapper**
  - **Files:** `src/components/viewer/localMediaSources.ts`.
  - **Behavior:** Keep the exported function and `LocalMediaProbeFailure` shape for compatibility, but its implementation delegates to the new classifier with `transport: null`, `inspection: null`, `capabilities: null`. Map `source_*` → `source-access`, container/decoder/bitmap-subtitle → `unsupported-format`, decoder-initialization → `decode`, interrupted → `aborted`, and everything else (including code 4 without evidence) → `unknown` with an indeterminate message. Add `code?: MediaFailureCode` and `indeterminate?: boolean` to the legacy type. Export a deprecation comment. Update `LocalMediaProbeFailure` types if needed.
  - **Edge cases:** `MediaError` may be undefined in tests/jsdom; `canPlayType` absent.
  - **Test:** update existing tests; add cases proving code 4 + `maybe` no longer returns `source-access`.
  - **Depends on:** 2.8.

- [x] **2.10 Make the primary probe success semantics honest**
  - **Files:** `src/components/viewer/localMediaSources.ts` (`probeLocalMediaSource`), `src/components/viewer/localMediaSource.ts` (`probeMediaSource`).
  - **Behavior:** `loadedmetadata` alone is no longer `ok`; it returns `{ok:false, indeterminate:true, stage:"metadata"}` or an equivalent typed result. `canplay`/`playing` may be `ok`. The primary player no longer calls this probe (Phase 9); it remains for non-primary fallbacks/tests.
  - **Edge cases:** jsdom never fires events → timeout with `media_compatibility_indeterminate`; `canplay` then immediate error.
  - **Test:** table tests for metadata-only, canplay, playing, error, timeout.
  - **Depends on:** 2.8.

- [x] **2.11 Remove the two independent player error producers**
  - **Files:** `src/components/viewer/LocalVideoPlayer.tsx`.
  - **Behavior:** Delete `buildPlayErrorMessage` and `formatSourceFailureMessage` as independent message writers. Both `attemptPlay` catch and `handleMediaElementError` build one `MediaPlaybackFailure` via `classifyPlaybackFailure`, call one `setFailure`, and render one message. The media error handler runs `probe_media_transport` for loopback URLs before classifying.
  - **Edge cases:** play rejection followed by error event in the same tick (dedupe by a burst id); no video ref; abort due to source switch; user pause.
  - **Test:** RTL test simulating both events; assert one overlay message/toast and no contradictory codec text; assert no `source-access` for a healthy probe.
  - **Depends on:** 2.8, 2.9.

- [ ] **2.12 Add retry policy and log dedupe**
  - **Files:** `src/components/viewer/LocalVideoPlayer.tsx`, new `src/lib/media/diagnostics.ts`.
  - **Behavior:** Transient transport errors retry at most twice (500 ms/2 s); 4xx/corrupt/protected/verification failures never auto-retry; same `(documentId, code, sourceFingerprint)` logs at most once per 60 s; no alternating artifact/original loops.
  - **Edge cases:** component unmount during backoff; source change resets counters; manual retry always allowed.
  - **Test:** fake timers for retry counts; diagnostics dedupe test; unmount cancels timers.
  - **Depends on:** 2.11.

## Phase 3 — FFprobe inspection, fingerprinting, and persistence

- [x] **3.1 Add FFprobe discovery and version parsing**
  - **Files:** `src-tauri/src/utils/ffmpeg.rs`.
  - **Behavior:** Add `resolve_ffprobe_path()` using the same priority order as `ffmpeg` (env override, macOS Homebrew, Windows common dirs, Linux paths, PATH). Add `ffprobe_command()` returning a `tokio::process::Command` with `kill_on_drop(true)`. Add `ffmpeg_version()`/`ffprobe_version()` parsing `X.Y.Z`. Keep `ffmpeg_command` behavior unchanged for existing callers.
  - **Edge cases:** binary named `ffprobe.exe`; spaces in paths; version strings with `n9.0.2` or `git-...`; missing binary.
  - **Test:** unit tests with a fake script/binary in a temp dir and PATH override; version parser table; existing ffmpeg tests.
  - **Depends on:** 2.1.

- [x] **3.2 Define the inspection model**
  - **Files:** `src-tauri/src/media_compat/types.rs`.
  - **Behavior:** Add `MediaInspection`, `MediaSourceInfo`, `VideoStreamInfo`, `AudioStreamInfo`, `SubtitleStreamInfo`, `HdrInfo`, `DolbyVisionInfo`, `ChapterInfo`, `MediaToolReport`, `ProbeStatus`, `SubtitleKind`, `HdrKind`. `DolbyVisionInfo` includes `hdr10_compatible` (profile 8 + compatibility id). Use camelCase serialization and explicit `Option`s; derive `Serialize`/`Deserialize` for cached inspection JSON. Add pure helper `is_bitmap_subtitle(codec)` and `select_default_video`/`select_default_audio` (selection helpers may live in `decision.rs` if preferred, but keep one implementation).
  - **Edge cases:** attached_pic; no default; multiple default tracks; commentary disposition; unknown codec; missing language.
  - **Test:** serde tests; helper tests for attached_pic/default/commentary/bitmap classification.
  - **Depends on:** 2.1.

- [x] **3.3 Implement the FFprobe parser**
  - **Files:** new `src-tauri/src/media_compat/probe.rs`.
  - **Behavior:** Spawn the fixed argument vector from D3; cap stdout at 8 MiB and stderr at 64 KiB; 30 s timeout; parse JSON into typed structs with `#[serde(default)]`; ignore `format.filename` and other absolute paths; normalize container names (`matroska,webm` → `matroska`, `mov,mp4,m4a,3gp,3g2,mj2` → `mp4`); parse rational frame rates; parse `side_data_list` for DOVI/HDR10+; map subtitle codecs to text/bitmap; detect best-effort protection (`encv`/`enca` tags, encryption side data, DRM format markers) into `is_protected`; populate warnings. Non-zero exit/invalid JSON → `media_inspection_unavailable`. Do not claim protection when the signal is ambiguous.
  - **Edge cases:** `format` missing; zero streams; `side_data_list` absent; `start_time` missing; `duration` "N/A"; attached_pic; PGS; multiple video streams; huge stream count (cap at 64 streams; warn).
  - **Test:** golden JSON fixtures for each shape; malformed/truncated JSON; timeout with a sleeping fake binary; stdout cap.
  - **Depends on:** 3.1, 3.2.

- [x] **3.4 Add the source fingerprint**
  - **Files:** new `src-tauri/src/media_compat/probe.rs` or `types.rs`.
  - **Behavior:** `source_fingerprint(path) -> { size, mtime_ns, sample_sha256 }`; read first/last 64 KiB (or the whole file if ≤128 KiB); hash with SHA-256; include size/mtime in the hash input. Re-stat after read; if changed, retry once.
  - **Edge cases:** zero-length; unreadable; sparse files; files smaller than 128 KiB; mtime before epoch.
  - **Test:** temp-file tests with identical content/different mtime, changed middle byte (sample may miss it — document as a version proxy), changed head/tail, unreadable.
  - **Depends on:** 3.2.

- [x] **3.5 Add the inspection cache table and repository**
  - **Files:** `src-tauri/src/database/migrations.rs`, new `src-tauri/src/database/media_compat_repository.rs`, `src-tauri/src/database/mod.rs`.
  - **Behavior:** Add migration `137_media_compatibility` with the `media_inspections` and `media_compatibility_artifacts` tables/indexes from D10. Add repository methods for get/upsert inspection, artifact CRUD/list/touch/sum/mark-interrupted. Use parameterized SQL only.
  - **Edge cases:** duplicate upsert; null optional fields; concurrent writes; migration on an existing DB.
  - **Test:** migration applies on a fresh and an existing test DB; repository round-trips inspection JSON; artifact state transitions; no SQL injection from document IDs.
  - **Depends on:** 3.2.

- [x] **3.6 Implement `inspect_local_media`**
  - **Files:** `src-tauri/src/media_compat/commands.rs`, `src-tauri/src/media_compat/probe.rs`.
  - **Behavior:** Authorize via `media_server::authorize_media_file` (canonical path + registered document/app roots), compute fingerprint, return a cached inspection when document ID + fingerprint + schema match, otherwise run FFprobe and upsert. If `document_id` is provided, verify it resolves to the same canonical file path before persisting; otherwise return `source_permission_denied`. If `document_id` is absent, still inspect an authorized path but do not persist a document row.
  - **Edge cases:** unauthorized path; missing file; ffprobe missing; stale row; file changes during probe; app cache artifact path.
  - **Test:** command-level tests with a mock repo/temp files; unauthorized path returns `source_permission_denied`; missing ffprobe returns `probe_status=unavailable`; second call uses the cache (assert no second spawn via a fake tool).
  - **Depends on:** 3.3, 3.4, 3.5, 1.6.

- [ ] **3.7 Commit golden FFprobe fixtures**
  - **Files:** new `src-tauri/tests/fixtures/probe/*.json`, test module references.
  - **Behavior:** Add JSON for: MP4 H.264/AAC; WebM VP9/Opus; MKV H.264/AAC; MKV HEVC Main10 HDR10; MKV HEVC + DTS-HD MA + PGS + attached_pic (matching the report shape, values sanitized); MKV multi-audio; MKV text subs; DV profile 8; DV profile 5; corrupt/missing streams.
  - **Edge cases:** no real movie bytes; no personal paths; stable field names.
  - **Test:** parser snapshot tests assert container/codecs/HDR/subtitle kinds/attached_pic/default selection for each.
  - **Depends on:** 3.3.

- [x] **3.8 Handle probe unavailability without blocking playback**
  - **Files:** `src/components/viewer/LocalVideoPlayer.tsx` integration hook (Phase 9), `src/lib/media/errorClassification.ts`.
  - **Behavior:** If `inspect_local_media` fails/unavailable, the player still attaches the original source (unless container is known-risky and the user is waiting), and the classifier uses transport + media evidence. The UI does not claim codec facts. Advanced details says "format inspection unavailable".
  - **Edge cases:** ffprobe missing; permission; timeout; non-Tauri.
  - **Test:** RTL test with inspection rejection → native source attached, code 4 + healthy transport → indeterminate; details text.
  - **Depends on:** 3.6, 2.8.

- [x] **3.9 Add inspection performance instrumentation**
  - **Files:** `src-tauri/src/media_compat/probe.rs`, `src-tauri/src/media_compat/commands.rs`.
  - **Behavior:** Log `elapsed_ms`, size, probe status, and cache hit/miss. Add a test-only timing assertion for a small fixture (< 5 s, generous).
  - **Test:** timing log fields present; no full path in logs.
  - **Depends on:** 3.6.

## Phase 4 — Runtime capability detection

- [x] **4.1 Define capability types and platform detection**
  - **Files:** `src-tauri/src/media_compat/capabilities.rs`, `types.rs`.
  - **Behavior:** Add `MediaRuntimeCapabilities`, `CapabilityLevel`, `EncoderCapability`, `FfmpegCapabilities`, `GStreamerReport`, `PlatformKind`, `EngineKind`. `evidence` is a list (`gstreamer_registry`, `webview_declaration`, `ffmpeg_tools`, `real_playback`, `none`). Detect platform/engine from `cfg!`/Tauri; Linux → WebKitGTK, Windows → WebView2, macOS → WKWebView, Android → Android WebView, iOS → WKWebView, else browser.
  - **Edge cases:** unknown engine; engine version unavailable; Android/iOS.
  - **Test:** platform/engine mapping tests with a pure helper; serde shape.
  - **Depends on:** 2.1.

- [x] **4.2 Implement Linux GStreamer registry detection**
  - **Files:** `src-tauri/src/media_compat/capabilities.rs`.
  - **Behavior:** Resolve `gst-inspect-1.0` from PATH/common paths; run once with the current `GST_PLUGIN_PATH`/`GST_PLUGIN_SYSTEM_PATH_1_0`/`GST_REGISTRY`; 10 s timeout; cap output; use `tokio::process::Command` or `spawn_blocking` (never block the async runtime); parse `plugin: element: description`; build the element set; map the D4 table to capabilities; include plugin dirs/registry/plugin-set id from `linux_runtime` when available; cache for 10 minutes; `refresh=true` bypasses.
  - **Edge cases:** binary missing; non-zero exit; plugin load warnings; duplicate elements; localized descriptions (parse only the element token); output > cap.
  - **Test:** parse fixture strings into the expected maps; missing binary → unknown; refresh invalidates; env propagation test with a fake `gst-inspect` script.
  - **Depends on:** 4.1.

- [x] **4.3 Implement FFmpeg tool/encoder/filter detection**
  - **Files:** `src-tauri/src/media_compat/capabilities.rs`, `src-tauri/src/utils/ffmpeg.rs`.
  - **Behavior:** Run the resolved `ffmpeg`/`ffprobe` paths (not bare `shell.command("ffmpeg")`) for `-version`, `-encoders`, `-filters`; detect `libx264`, `aac`, `zscale`, `tonemap`, and hardware candidates (`h264_videotoolbox`, `h264_nvenc`, `h264_qsv`, `h264_amf`). Report versions and booleans; never mark an encoder usable until the canary (Phase 6). Also correct `check_ffmpeg_available` to use the resolved path so macOS GUI builds do not report a false negative.
  - **Edge cases:** old FFmpeg output format; missing tools; localized output; command timeout.
  - **Test:** fixture outputs for FFmpeg 4.4/5.1/9; booleans match; missing → false/`unknown`.
  - **Depends on:** 3.1, 4.1.

- [x] **4.4 Implement Windows/macOS/Android/iOS/web policy**
  - **Files:** `src-tauri/src/media_compat/capabilities.rs`.
  - **Behavior:** On non-Linux, do not enumerate OS codecs. Return `unknown` for decoder/demuxer maps, `ffmpeg` info on desktop, and warnings. Android/iOS return conversion-unavailable metadata. Browser is not a Rust runtime but the type supports it.
  - **Edge cases:** Windows FFmpeg present but WebView2 codec unknown; macOS Homebrew; Android PATH containing a stray ffmpeg (must still not offer conversion).
  - **Test:** platform-gated unit tests using a test-only platform parameter; Android/iOS conversion capability false.
  - **Depends on:** 4.1, 4.3.

- [x] **4.5 Implement frontend exact-codec detection**
  - **Files:** new `src/lib/media/capabilities.ts`.
  - **Behavior:** Build `DeclaredCodecSupport` from the exact `canPlayType` matrix in D4. Record raw evidence strings. Map `"probably"` → supported, `""` → unsupported, `"maybe"` → unknown for codecs, bare container `"maybe"` → declared container support. Include `truehd` as unknown unless the GStreamer registry provides evidence. Include bitmap/text subtitle queries only where meaningful; do not infer DTS/TrueHD from MP4 codec strings.
  - **Edge cases:** jsdom returns `""` for everything (tests must mock); absent `canPlayType`; browser privacy modes.
  - **Test:** table tests for each MIME result; DTS gap; bare container behavior.
  - **Depends on:** 2.5.

- [x] **4.6 Merge capability evidence and compute the runtime fingerprint**
  - **Files:** `src-tauri/src/media_compat/capabilities.rs`, `src/lib/media/capabilities.ts`.
  - **Behavior:** Merge GStreamer/declared/playback evidence by D4. `supported` wins over unknown; strong negatives require registry absence + declared unsupported; record `evidence`. Compute `runtime_fingerprint` from platform + engine + app version + ffmpeg/ffprobe version + GStreamer plugin-set id/registry. Cache the report in `MediaCompatState` for 10 minutes.
  - **Edge cases:** conflicting evidence; registry unavailable; app version unknown; plugin set id missing.
  - **Test:** merge table tests; fingerprint changes when an input changes; cache TTL/refresh.
  - **Depends on:** 4.2, 4.3, 4.5.

- [x] **4.7 Add the `get_media_runtime_capabilities` command**
  - **Files:** `src-tauri/src/media_compat/commands.rs`, `src-tauri/src/lib.rs`.
  - **Behavior:** Expose the report with `refresh: Option<bool>`. Never panic if tools are missing. Register in `generate_handler`.
  - **Test:** command returns a report on Linux; refresh toggles; missing tools → warnings.
  - **Depends on:** 4.6.

- [x] **4.8 Build the settings diagnostics payload**
  - **Files:** `src/lib/media/capabilities.ts`, `src/components/settings/MediaPlaybackSettings.tsx` (Phase 10).
  - **Behavior:** Provide a pure `formatCapabilityRows(report)` for the settings UI: decoder name, level, evidence, and FFmpeg/GStreamer status. Do not show raw command lines to ordinary users.
  - **Test:** snapshot/table test for rows including unknown/unsupported/supported.
  - **Depends on:** 4.6.

## Phase 5 — Decision engine and compatibility policy

- [x] **5.1 Define plan types and reasons**
  - **Files:** `src-tauri/src/media_compat/types.rs`, new `src-tauri/src/media_compat/decision.rs`.
  - **Behavior:** Add `PlaybackStrategy`, `PlanConfidence`, `SubtitlePolicy`, `OutputProfile`, `CachedArtifact`, `ConversionEstimate`, `MediaPlaybackPlan`, `MediaPlaybackPlanRequest`, `MediaProcessingPolicy`, `PlaybackRecoveryContext`, `StartMediaCompatibilityJobRequest`, and reason/limitation constants. Derive `Serialize`/`Deserialize` for plan/manifest types. Keep reason strings machine-readable and documented in one module.
  - **Edge cases:** optional output for native/unavailable; no audio; no video; unknown duration.
  - **Test:** serde shape; reason constants unique; plan round-trip.
  - **Depends on:** 3.2, 4.1.

- [x] **5.2 Implement stream selection**
  - **Files:** `src-tauri/src/media_compat/decision.rs`.
  - **Behavior:** Select the first non-attached default video, else first non-attached video; select default audio, else first audio; classify subtitles as text/bitmap; count tracks; record language/title/commentary. Never select attached_pic.
  - **Edge cases:** no video; no audio; multiple defaults; commentary default; forced subtitles; PGS.
  - **Test:** table tests with the golden inspection fixtures, including the reported shape (video #0 HEVC, audio #1 DTS, subs #2–6 PGS, video #7 attached_pic).
  - **Depends on:** 5.1.

- [x] **5.3 Implement the core strategy rules**
  - **Files:** `src-tauri/src/media_compat/decision.rs`.
  - **Behavior:** Implement D5 rules 1–5 using merged capability evidence. Return `native`, `remux`, `audio_transcode`, `video_transcode`, or `unavailable` with reasons/confidence. Unknown codec/container evidence is optimistic for a native attempt (confidence `indeterminate`), not a claim of support; known `unsupported` evidence selects conversion. If `inspection.is_protected` is true, return `unavailable` with `unsupported_protected_media` and never start a conversion. Bitmap-subtitle incompatibility is evaluated only on Linux/WebKitGTK; other platforms do not preempt native playback from a bitmap track alone.
  - **Edge cases:** unknown container; unknown video; unknown audio; no audio; bitmap subtitles; no conversion tools; policy never.
  - **Test:** exhaustive decision table (at least the 20 rows in D5); property test that `remux` never sets a re-encode codec and `audio_transcode` never sets a video codec other than copy.
  - **Depends on:** 5.2, 4.6.

- [x] **5.4 Implement output container/codec selection**
  - **Files:** `src-tauri/src/media_compat/decision.rs`.
  - **Behavior:** Implement the `target_container`/`container_can_hold` rules. Prefer the source container when supported and capable; otherwise MP4 for H.264/HEVC/AV1 + AAC/MP3/AC3/EAC3; WebM for VP8/VP9/AV1 + Opus/Vorbis; MKV when supported and needed for DTS/FLAC/Opus. Never put DTS in MP4. Set `hvc1` for HEVC in MP4. If no supported container can hold the copied video + converted audio, promote to `video_transcode`. Never target the same container that was found unsupported; choose another supported container or escalate.
  - **Edge cases:** VP9 in MP4 (avoid unless source is MP4 and copy); Opus in MP4 (avoid); FLAC in MP4 (avoid); no audio; WebM chapters.
  - **Test:** table tests for each container/codec combination; negative assertions for DTS/MP4 and Opus/MP4.
  - **Depends on:** 5.3.

- [x] **5.5 Implement subtitle policy**
  - **Files:** `src-tauri/src/media_compat/decision.rs`.
  - **Behavior:** If the platform is Linux/WebKitGTK and any bitmap subtitle is present, force `remux` when video/audio are supported (or add subtitle stripping to an audio/video plan), set `subtitle_policy=strip_all`, reason `bitmap_subtitles_present`, limitation `subtitles_not_rendered`. Record counts. On Android/iOS, bitmap subtitles do not preempt native playback; on Windows/macOS, container support decides. Text subtitles alone never force a remux. Any derived artifact (remux/audio/video) uses `strip_all`; native keeps the original tracks.
  - **Edge cases:** only text subs; only bitmap; mixed; no subs; MP4 mov_text; forced PGS.
  - **Test:** table tests; assert the reported shape yields `remux` + `strip_all` even when all codecs are supported.
  - **Depends on:** 5.3.

- [x] **5.6 Implement HDR/DV policy**
  - **Files:** `src-tauri/src/media_compat/decision.rs`.
  - **Behavior:** Classify SDR/HDR10/HLG/DV/HDR10+ from inspection. For native/remux, no tone map. For video transcode of HDR, require `hdr_tone_mapping` consent and `zscale`/`tonemap`; add `hdr_converted_to_sdr`. For DV profile 5, return `unavailable`/`dolby_vision_unsupported` unless a DV-capable runtime is positively known. For DV profile 8, allow native/remux; add `dolby_vision_signalling_not_preserved` on a container change; never claim preservation. Add `resolution_reduced` when balanced scaling applies, `bit_depth_reduced_to_8` for 10-bit SDR→8-bit, and `audio_downmixed_to_5_1` for >6 channels.
  - **Edge cases:** missing color metadata; HLG; HDR10+; DV profile 8 with no HDR10 base flag; DV tag only; tone-map filters missing.
  - **Test:** table tests for each HDR kind and DV profile; assert no tone map for remux; assert consent reason/filters.
  - **Depends on:** 5.3, 5.4.

- [x] **5.7 Implement consent, quality, and availability evaluation**
  - **Files:** `src-tauri/src/media_compat/decision.rs`.
  - **Behavior:** Evaluate `requires_consent` from strategy/policy/HDR/output size. `automatic-inexpensive`: consent for HDR tone mapping or an *expensive* video transcode (duration > 10 min, source height > 1080, or mode `ask`); short/SD SDR video transcodes auto-run. `ask`: consent for any non-native; `never`: `can_convert=false`, unavailable reason `policy_never`. Compute output floor, free-space requirement, cache fit. Set `can_convert=false` with `ffmpeg_missing`, `ffprobe_missing`, `encoder_missing`, `filter_missing`, `cache_limit_too_small`, or `insufficient_storage`. `encoder_missing` means neither `libx264` nor a hardware candidate is available; a candidate still has to pass the canary at job time.
  - **Edge cases:** remux/audio-only of any size is automatic when mode permits (disk preflight still applies); 4K/HDR/long video transcode asks; short 720p SDR transcode auto-runs; unknown duration makes video transcode conservative (ask); cache limit exactly equal; free space unknown.
  - **Test:** table tests for modes/strategies/sizes; assert no video transcode without consent in automatic/ask; assert never mode never starts.
  - **Depends on:** 5.4, 5.6.

- [x] **5.8 Add the `plan_media_playback` command**
  - **Files:** `src-tauri/src/media_compat/commands.rs`, `src-tauri/src/lib.rs`.
  - **Behavior:** Re-authorize the file, verify the inspection fingerprint/hash, load/refresh the inspection, merge the client `DeclaredCodecSupport` with the runtime report, apply `recovery` overrides (native failure evidence), call the pure planner, check cache for a valid artifact, and return the plan. Do not trust a client-provided plan. Register the command.
  - **Edge cases:** stale fingerprint; unauthorized path; inspection unavailable; cache DB row missing but manifest valid; policy invalid; document ID mismatch.
  - **Test:** command-level tests with temp fixtures/mocks: native, remux, cache hit, stale fingerprint, unauthorized, missing ffmpeg.
  - **Depends on:** 5.7, 3.6, 4.7.

- [ ] **5.9 Implement "try original anyway" and capability override**
  - **Files:** `src-tauri/src/media_compat/commands.rs` (optional evidence-recording command) or frontend-only session state; `src/hooks/useMediaCompatibility.ts`.
  - **Behavior:** A non-native plan can be overridden by attaching the original. On successful playback, record a session positive for `(runtime_fingerprint, source_fingerprint, stream signature)` and cancel any pending job. On failure, downgrade the relevant capability for the session and re-plan with `PlaybackRecoveryContext { trigger: "native_failed", failure_code, media_error_code }`. Do not persist authoritative negatives.
  - **Edge cases:** override while a job is queued/running; override success then later failure; native failure after a positive declared capability; indeterminate failure selects a remux first, then a full transcode on the next retry.
  - **Test:** hook/command test for override success/failure; `recovery` plan table; job cancellation called; no persisted negative.
  - **Depends on:** 5.8.

## Phase 6 — FFmpeg command construction, profiles, and verification

- [x] **6.1 Build the FFmpeg argument builder**
  - **Files:** new `src-tauri/src/media_compat/ffmpeg.rs`.
  - **Behavior:** Pure `build_args(plan, inspection, input, output, tool, hardware) -> Vec<OsString>` for remux/audio/video. Include `-nostdin -hide_banner -loglevel error -y`, input, absolute `-map` indices, `-sn -dn -map_chapters -1`, codecs, metadata, container flags, `-copyts -start_at_zero`, `-threads` for video transcode, and version-appropriate `-fps_mode`/`-vsync`. No shell, no user-controlled flags.
  - **Edge cases:** no audio; no video; multiple audio (only selected); PGS; DV tag; HEVC MP4 `hvc1`; VP9/WebM; paths with spaces/unicode/newlines; FFmpeg 4.4 vs 9; hardware vs software.
  - **Test:** exact argument vectors for each profile/version; property test that no argument contains an unescaped shell metacharacter requirement (they are passed as separate args); path safety.
  - **Depends on:** 5.4, 3.1.

- [x] **6.2 Implement the process runner**
  - **Files:** `src-tauri/src/media_compat/ffmpeg.rs`.
  - **Behavior:** Spawn with `tokio::process`, `kill_on_drop`, piped stdout/stderr, read `-progress` and stderr concurrently, cap stderr to a 64 KiB tail, parse progress fields (`out_time_us`/`out_time_ms`/`out_time`, `speed`, `total_size`, `progress`), and return an exit result. Support a cancellation watch and timeout/watchdog hooks.
  - **Edge cases:** non-UTF8 stderr; partial lines; no progress; exit before progress; signal termination; spawn failure.
  - **Test:** a fake FFmpeg shell script emitting known progress; parse tests; cancellation kills; stderr cap; spawn failure.
  - **Depends on:** 6.1.

- [x] **6.3 Implement the remux profile**
  - **Files:** `src-tauri/src/media_compat/ffmpeg.rs`.
  - **Behavior:** Execute Profile A. Choose `-f mp4|matroska|webm`, `+faststart` for MP4, `hvc1`/`dvh1` tags, copy video/audio, omit subtitles/data, preserve metadata. Output to staging `.part`.
  - **Edge cases:** MKV→MKV PGS strip; MKV→MP4 H.264/AAC; HEVC MP4; no audio; DV tag; chapters omitted.
  - **Test:** integration with generated fixtures: MKV H.264/AAC → MP4; MKV HEVC/DTS/PGS → MKV (if encoders/fixtures available); assert streams/codecs/no subs/duration; original unchanged.
  - **Depends on:** 6.2.

- [ ] **6.4 Implement the audio-only profile**
  - **Files:** `src-tauri/src/media_compat/ffmpeg.rs`.
  - **Behavior:** Execute Profile B. Copy video, convert only the selected audio to AAC at the channel-based bitrate, 48 kHz, up to 5.1; preserve metadata; choose MP4/MKV/WebM per plan.
  - **Edge cases:** mono/stereo/5.1/7.1; no audio; DTS-HD; Opus source; WebM target (use Opus only if available); audio shorter/longer than video.
  - **Test:** integration with generated HEVC/DTS or H.264/DTS fixture; assert video stream hash/bitstream copy (compare packet size or codec params), audio AAC 5.1, duration; no video re-encode.
  - **Depends on:** 6.2.

- [ ] **6.5 Implement the video-transcode profile**
  - **Files:** `src-tauri/src/media_compat/ffmpeg.rs`.
  - **Behavior:** Execute Profile C. Software `libx264` CRF/preset by quality; optional 1080p scale; HDR tone-map chain; AAC/audio copy; `yuv420p`; version-appropriate frame mode; faststart.
  - **Edge cases:** 4K→1080p; quality profile keeps 4K; HDR/PQ/HLG; 10-bit SDR; VFR; no audio; hardware encoder.
  - **Test:** integration with a generated HDR10 or SDR fixture (short); assert codec/profile/resolution/color metadata/duration; unit arg tests for HDR filter chain; verify no tone map for SDR.
  - **Depends on:** 6.2, 5.6.

- [ ] **6.6 Implement hardware encoder canary and fallback**
  - **Files:** `src-tauri/src/media_compat/ffmpeg.rs`, `capabilities.rs`.
  - **Behavior:** Detect candidates from capabilities; run a 1 s 320×180 `testsrc2` canary to a temp file with the encoder's args; verify with FFprobe/decode; cache result per session. On job hardware failure, delete partial output and retry once in software.
  - **Edge cases:** encoder listed but broken; driver crash; canary timeout; no GPU; `off` setting; multiple candidates.
  - **Test:** fake canary scripts (success/failure/timeout); fallback argument selection; no hardware attempt when off.
  - **Depends on:** 6.5, 4.3.

- [x] **6.7 Implement output verification**
  - **Files:** `src-tauri/src/media_compat/ffmpeg.rs` or new `verify.rs`.
  - **Behavior:** Verify stream count/codecs/container, start time, duration tolerance, A/V PTS delta, HDR color metadata for copied video, DOVI side data when the source had DV and the container was unchanged, and a 2 s decode. Return a typed verification report or a `conversion_verification_failed` error with expected/actual. If same-container DV copy lost the DOVI record, do not publish; if a container change necessarily loses it, record the limitation and continue.
  - **Edge cases:** no audio; no video (not a video doc); audio-only? (not in P1); variable frame rate; AAC encoder delay; HEVC `hvc1`; copied DTS; 10-bit HDR.
  - **Test:** valid/invalid generated fixtures; deliberately truncated output; duration mismatch; missing color metadata; decode failure.
  - **Depends on:** 6.3, 6.4, 6.5.

- [ ] **6.8 Map FFmpeg failures to typed errors**
  - **Files:** `src-tauri/src/media_compat/ffmpeg.rs`.
  - **Behavior:** Map spawn errors → `conversion_dependency_missing`; missing encoder/filter → `conversion_encoder_missing`/`conversion_filter_missing`; non-zero exit → `conversion_failed` with a bounded stderr tail; verification → `conversion_verification_failed`; cancellation → `conversion_cancelled`; disk → `insufficient_storage`. Do not leak full paths in `message`; `detail` may include a redacted command summary.
  - **Edge cases:** FFmpeg exit 1 with a useful tail; signal exit; OOM; "Unknown encoder"; "No such filter".
  - **Test:** table tests with fake exit/stderr; assert codes and redaction.
  - **Depends on:** 6.2, 6.7.

- [x] **6.9 Write the fixture generator and verifier**
  - **Files:** `scripts/media-fixtures/generate.sh`, `verify.sh`, `src-tauri/tests/fixtures/media/README.md`.
  - **Behavior:** Generate tiny synthetic fixtures: MP4 H.264/AAC; WebM VP9/Opus; MKV H.264/AAC; MKV SubRip; MKV multi-audio; MKV cover; optionally HEVC/AAC, HEVC/DTS, AV1/Opus, HDR10. Verify each with FFprobe and print skips. Support `PLETHORA_PGS_FIXTURE` for an external PGS file.
  - **Edge cases:** missing encoders; license-safe content; output under `.gitignore`; deterministic sizes/streams.
  - **Test:** `generate.sh --list`; `verify.sh` on generated files; a Rust test reads the manifest and skips absent fixtures.
  - **Depends on:** 6.3, 6.4, 6.5.

## Phase 7 — Job manager, events, and persistence

> **Ordering exception.** The cache core in tasks 8.1–8.3 is a prerequisite for
> the cache lookup in 7.3 and for publication in 7.6–7.7. Implement 8.1–8.3
> immediately after Phase 6, before starting 7.3/7.6. The remaining cache tasks
> (8.4–8.8) can follow Phase 7. This is the only exception to top-to-bottom
> ordering; the dependency lines remain authoritative.

- [x] **7.1 Define job state and event types**
  - **Files:** `src-tauri/src/media_compat/types.rs`, new `src-tauri/src/media_compat/jobs.rs`.
  - **Behavior:** Add `MediaCompatibilityJobState`, `MediaCompatibilityJobPhase`, `JobProgress`, `JobOutput`, `MediaCompatibilityJobEvent` with schema/sequence. Define `MediaCompatState` with jobs map, active-by-key/document maps, semaphores, capability cache, and a job counter.
  - **Edge cases:** terminal states; optional progress; error payload; output absent.
  - **Test:** serde shape; state transition helper tests.
  - **Depends on:** 5.1, 6.1.

- [x] **7.2 Register the state and job commands**
  - **Files:** `src-tauri/src/lib.rs`, `src-tauri/src/media_compat/commands.rs`.
  - **Behavior:** Manage `MediaCompatState` in setup; register `start_media_compatibility_job`, `cancel_media_compatibility_job`, `list_media_compatibility_jobs`. Use UUID job IDs. Validate document ownership.
  - **Edge cases:** unknown job ID; job from another document; duplicate registration.
  - **Test:** command tests with a mock app/state; unknown job → typed error.
  - **Depends on:** 7.1, 3.5.

- [x] **7.3 Implement job scheduling and deduplication**
  - **Files:** `src-tauri/src/media_compat/jobs.rs`.
  - **Behavior:** Re-plan in Rust; check cache; dedupe by cache key; enforce one active job per document, queue cap 8, and semaphores (1 video, 2 light). Emit `queued`; acquire permit; transition to `running`. Never spawn on app launch/import.
  - **Edge cases:** two documents same cache key (document ID is in the key, so different); same document different plan; queue full; cancelled while queued.
  - **Test:** concurrency tests with fake workers; dedupe; queue cap; per-document limit; semaphore counts.
  - **Depends on:** 7.2, 5.8.

- [ ] **7.4 Implement progress event emission**
  - **Files:** `src-tauri/src/media_compat/jobs.rs`, `ffmpeg.rs`.
  - **Behavior:** Forward parsed progress into the job event, throttle to 4/s, compute percent only with known duration, clamp to 99 until ready, include processed/duration/speed/output bytes. Emit with `app.emit("media-compat:job", ...)`.
  - **Edge cases:** no progress; duration unknown; out-of-order updates; event emit failure.
  - **Test:** fake FFmpeg progress → event sequence; throttle; percent clamp; unknown duration → null.
  - **Depends on:** 7.3, 6.2.

- [ ] **7.5 Implement cancellation, watchdogs, and disk monitoring**
  - **Files:** `src-tauri/src/media_compat/jobs.rs`.
  - **Behavior:** `watch::channel` cancel; select on child wait; kill within 2 s; delete staging; no-progress 120 s based on either a new progress line or `.part` file growth (checked every 30 s); max 6 h; free-space < 512 MiB; stderr cap; final event. Cancellation idempotent.
  - **Edge cases:** cancel queued job; cancel during verify/publish; kill fails; cleanup fails; Windows file locks.
  - **Test:** fake long-running child; cancel; watchdog with fake clocks; disk check via an injected free-space function; idempotency.
  - **Depends on:** 7.4, 6.2.

- [x] **7.6 Implement cache publication from jobs**
  - **Files:** `src-tauri/src/media_compat/jobs.rs`, `cache.rs` (Phase 8).
  - **Behavior:** On exit 0 → verify → atomic publish → DB ready → emit ready. On any failure → cleanup → DB failed → emit failed. Never emit ready before the manifest/output exist.
  - **Edge cases:** publish conflict; DB failure after publish; app crash between rename and DB; existing valid artifact.
  - **Test:** integration with temp cache: ready event only after files; DB failure leaves recoverable manifest; conflict reuses.
  - **Depends on:** 7.5, 6.7, 8.2.

- [ ] **7.7 Implement startup recovery**
  - **Files:** `src-tauri/src/media_compat/jobs.rs`, `cache.rs`, `lib.rs`.
  - **Behavior:** On startup, mark `building` rows failed/cancelled with detail `interrupted`, delete `.staging/*` older than 24 h, and never auto-start jobs. Run after DB readiness, off the UI-critical path.
  - **Edge cases:** DB unavailable; read-only cache; stale trash; multiple app instances.
  - **Test:** temp DB/cache with a building row + staging dir → marked failed/cleaned; ready artifact preserved.
  - **Depends on:** 7.6, 3.5.

- [x] **7.8 Add frontend job subscription helpers**
  - **Files:** `src/api/mediaCompatibility.ts`.
  - **Behavior:** Provide `subscribeToMediaCompatibilityJobs(handler)` using `@tauri-apps/api/event` `listen("media-compat:job")`; validate the payload shape; drop malformed events with a diagnostic; return an unsubscribe function. Provide `getActiveCompatibilityJob(documentId)` via `list_media_compatibility_jobs`. Do not implement the React hook here (Phase 9 consumes these helpers).
  - **Edge cases:** event before subscription; app reload; duplicate events; stale job; unsubscribe twice.
  - **Test:** mock event emitter; out-of-order sequences; reattach via list; unsubscribe.
  - **Depends on:** 7.2, 2.6.

- [ ] **7.9 Add job diagnostics**
  - **Files:** `src-tauri/src/media_compat/jobs.rs`.
  - **Behavior:** Log job start/phase/exit/duration/output size/cache key prefix; no full paths; include document ID and failure code.
  - **Test:** assert log fields via a pure `JobLog` struct; manual log check.
  - **Depends on:** 7.4.

## Phase 8 — Compatibility cache

- [x] **8.1 Implement the cache key**
  - **Files:** `src-tauri/src/media_compat/cache.rs`.
  - **Behavior:** Implement the fixed `CacheKeyInput` struct from D9 and SHA-256 hex. Include key/pipeline versions, document, canonical path, source fingerprint, inspection hash, strategy/indices/subtitle policy/output, hardware, tool versions. Stable serialization.
  - **Edge cases:** optional hardware; same inputs → same key; every field change → different key; unicode paths; very long paths (hash, not truncate).
  - **Test:** golden key tests; mutation table for each field; stable across runs.
  - **Depends on:** 5.1, 3.4.

- [x] **8.2 Implement cache paths, manifest, and atomic publish**
  - **Files:** `src-tauri/src/media_compat/cache.rs`.
  - **Behavior:** Create `media_compat/<key>/`, `.staging/<job>`, `.trash/<uuid>`; write/validate manifest; fsync; rename staging; move-aside invalid target; cleanup. Ensure the final path is canonical and under the cache root.
  - **Edge cases:** target exists valid/invalid; rename fails; Windows rename-over-existing; disk full; symlinked cache root; crash mid-publish.
  - **Test:** temp-dir tests for publish/reuse/conflict/invalid target; simulated crash leaves no ready manifest; path containment.
  - **Depends on:** 8.1.

- [x] **8.3 Implement reuse validation**
  - **Files:** `src-tauri/src/media_compat/cache.rs`.
  - **Behavior:** Validate schema/key/fingerprint/inspection hash/output exists/size/state/plan output. Compare ffmpeg/ffprobe versions when the tools are available; a missing tool does not invalidate an already verified artifact. Return a `CachedArtifact` or invalidate.
  - **Edge cases:** missing manifest; mismatched size; zero-byte output; older pipeline; ffmpeg upgrade; DB row missing but manifest valid.
  - **Test:** table tests for each invalidation; valid reuse.
  - **Depends on:** 8.2.

- [x] **8.4 Implement cache usage, LRU eviction, and clear**
  - **Files:** `src-tauri/src/media_compat/cache.rs`, `commands.rs`.
  - **Behavior:** Sum ready artifact bytes; list; evict oldest `last_accessed_at` until ≤90% of limit, skipping building and recently accessed; expose an explicit `prune_media_compatibility_cache(limit_gb)` command; clear all/one document; refuse while a job is active. Startup only cleans staging/interrupted jobs and does not enforce a hard-coded limit. Never delete originals.
  - **Edge cases:** delete failure (Windows lock); zero limit; artifact larger than limit; concurrent GC/publish; cache root missing.
  - **Test:** temp cache with artifacts/timestamps; eviction order/limit; skip active; clear; original file untouched.
  - **Depends on:** 8.3, 7.3.

- [ ] **8.5 Implement cache preflight and limit checks**
  - **Files:** `src-tauri/src/media_compat/cache.rs`, `decision.rs`.
  - **Behavior:** Compute the output floor: remux/audio-only = source bytes; video transcode = duration × target bitrate / 8 × 1.15 + 256 MiB. Required free space = floor + 1 GiB. Check cache limit and free disk; return `cache_limit_too_small`/`insufficient_storage` before starting. Use the existing `sysinfo` crate or platform stat APIs; do not add a new dependency.
  - **Edge cases:** unknown duration; free space unknown; cache limit exactly equal; remux floor = source size.
  - **Test:** injected free-space/cache-limit table tests.
  - **Depends on:** 8.1, 5.7.

- [x] **8.6 Add cache commands and TS wrappers**
  - **Files:** `src-tauri/src/media_compat/commands.rs`, `src-tauri/src/lib.rs`, `src/api/mediaCompatibility.ts`.
  - **Behavior:** `get_media_compatibility_cache_usage`, `prune_media_compatibility_cache(limit_gb)`, `clear_media_compatibility_cache`, `get_media_compatibility_artifact_url`. Validate document ownership/cache state/canonical path; return a loopback URL through `media_server::mint_stream_url` (do not expose paths).
  - **Edge cases:** missing artifact; failed/building; path escape; server start failure; document mismatch.
  - **Test:** command tests; unauthorized cache key; URL starts with `http://127.0.0.1:` and path is under cache; no path in response.
  - **Depends on:** 8.4, 2.6.

- [x] **8.7 Add cache DB repository integration**
  - **Files:** `src-tauri/src/media_compat/cache.rs`, `database/media_compat_repository.rs`.
  - **Behavior:** Upsert/touch/list/delete rows; `last_accessed_at` on cache hit; `state` transitions; `mark_interrupted`. Keep the manifest as truth.
  - **Edge cases:** DB write failure; duplicate key; row without file; file without row.
  - **Test:** repository round-trip; cache hit touches; DB failure doesn't delete a valid manifest.
  - **Depends on:** 3.5, 8.2.

- [ ] **8.8 Prove original immutability**
  - **Files:** `src-tauri/src/media_compat/*` tests.
  - **Behavior:** After remux/audio/video jobs, assert source size/mtime/hash unchanged and no output beside the source.
  - **Edge cases:** source on read-only volume; cache on another volume.
  - **Test:** integration temp-dir test.
  - **Depends on:** 8.2, 6.7.

## Phase 9 — Frontend orchestration, recovery UX, and learning integration

- [x] **9.1 Update the local source resolver**
  - **Files:** `src/components/viewer/localMediaSource.ts`.
  - **Behavior:** Keep Tauri → `get_media_stream_url`. Remove the `backend-blob` fallback for all video. Keep the existing Tauri audio fallback and browser-object-url behavior unchanged so audiobook/podcast playback is not regressed. Keep `backend-blob` only for non-Tauri web/PWA audio when no browser `File` exists and `readDocumentFile` is available. Never for video. Add `originalPath` to the returned descriptor (already present) and do not infer codec support from the MIME. Extend `inferMimeType` with the same server container map (mkv, mka, mov, avi, m4v, ts/m2ts, flv, wmv, 3gp, ogv, weba, aiff, wma, ape) so browser/blob descriptors are consistent. Update comments.
  - **Edge cases:** mobile Tauri audio; PWA audio without a File; server failure; empty descriptor.
  - **Test:** update `localMediaSource.test.ts`: video never calls `readDocumentFile`; Tauri audio behavior is unchanged; PWA audio can use the blob; object URL revocation unchanged.
  - **Depends on:** 2.9, 1.6.

- [x] **9.2 Add the `filePath` prop and pass it from DocumentViewer**
  - **Files:** `src/components/viewer/LocalVideoPlayer.tsx`, `src/components/viewer/DocumentViewer.tsx`, `src/components/viewer/LocalVideoPlayerWrapper.tsx` if needed.
  - **Behavior:** Add optional `filePath?: string`; DocumentViewer passes `currentDocument.filePath`. Use it for the compatibility hook and `VideoFeatures`/transcription instead of waiting for `getDocumentAuto`. Keep the existing `documentFilePath` fallback.
  - **Edge cases:** remote URL documents; YouTube; missing file path; document switch.
  - **Test:** DocumentViewer render test asserts the original path reaches the player/VideoFeatures; no new document ID.
  - **Depends on:** 9.1.

- [x] **9.3 Implement the `useMediaCompatibility` hook**
  - **Files:** new `src/hooks/useMediaCompatibility.ts`, new `src/lib/media/playbackPlan.ts` (pure helpers).
  - **Behavior:** Implement D11's state machine: idle/inspecting/native/preparing/consent/ready/failed; keyed on `documentId|filePath`; parallel inspection + capabilities; build declared support; plan; cache/consent/job dispatch (cache hit before the `can_convert=false` native-attempt branch); subscribe/reconnect; actions; no duplicate work. Return `{ state, inspection, plan, job, failure, confirmConsent, cancelJob, retry, tryOriginal, refreshCapabilities, dismiss }`. On inspection failure, return native with no plan. On non-Tauri/video/audio, idle. If the original is already playing when a non-native plan arrives, keep `native`, record the positive fact, and do not show preparation/consent or start a job. If `can_convert` is false, retain the plan but attach the original for one native attempt; only after it fails show `failed` with the `unavailable_reason` combined with the playback failure.
  - **Edge cases:** StrictMode double mount; unmount during async; document switch; stale responses (generation counter); job already running; policy changes; refresh.
  - **Test:** RTL `renderHook` tests for each transition; generation/stale response; no duplicate inspect on re-render; reattach to job; cancel; retry.
  - **Depends on:** 2.6, 3.6, 4.5, 5.8, 7.8.

- [x] **9.4 Integrate the hook into LocalVideoPlayer**
  - **Files:** `src/components/viewer/LocalVideoPlayer.tsx`.
  - **Behavior:** Remove the primary `probeLocalMediaSource` call. Replace the source-resolution effect with: if no candidates → error; otherwise select candidate 0 immediately and set `isResolvingSource=false` (no media-element probe). Attach the original optimistically for mp4/m4v/webm; wait for inspection for mkv/avi/ts/wmv/flv/unknown. Use `artifactUrl` as an override when ready. Keep the player mounted during preparing/consent and suppress media-error classification while the panel controls the state. Preserve `resolvedSourceIndex` fallback for descriptor arrays. Do not interrupt an original that has already reached `playing` because of a late non-native plan.
  - **Edge cases:** source changes while a job is preparing; document unmount; player ref null; multiple candidates; remote URL; mobile.
  - **Test:** RTL tests for MP4 immediate native, MKV waiting, artifact switch, no double media element/probe, source change resets hook, mobile no hook.
  - **Depends on:** 9.3.

- [x] **9.5 Implement artifact source switching with resume/rate/focus**
  - **Files:** `src/components/viewer/LocalVideoPlayer.tsx`.
  - **Behavior:** On ready, capture `currentTime`/`wasPlaying`; set the artifact override; on `loadedmetadata` seek, apply `playbackRate`, and resume if it was playing; retain the existing audio-focus lease; keep `currentTime` state until the seek; do not reset duration to 0 unnecessarily. On failure, clear the override before trying the original or a descriptor fallback, and offer retry conversion/try original once.
  - **Edge cases:** seek before metadata; user pauses during switch; audio focus lost; rate persisted; initialSeekTime/armed extract; end-of-video; stale fallback after override.
  - **Test:** RTL with fake media element: switch from 42 s playing → artifact `currentTime=42`, rate 1.5, play called once, lease retained; armed extract range preserved; artifact failure clears override.
  - **Depends on:** 9.4.

- [x] **9.6 Replace player error writers with the unified panel**
  - **Files:** `src/components/viewer/LocalVideoPlayer.tsx`, new `src/components/viewer/MediaCompatibilityPanel.tsx`, new `src/components/viewer/MediaFailureDetails.tsx`.
  - **Behavior:** Render one primary failure from `MediaPlaybackFailure`. Panel states: checking, preparing (progress/cancel), consent (convert/cancel/try original), ready (brief transition, no banner), failed (message/actions/details). Props: `{ state, inspection?, plan?, job?, failure?, onConfirmConsent, onCancel, onRetry, onTryOriginal, onConvert, onManageCache, onReimport, onInstallHelp, onShowDetails, onCopyDiagnostics }`. Use the design tokens, `role="alert"`, `role="progressbar"`, focus trap for consent, Escape cancel, 44 px touch targets. Keep advanced details collapsed.
  - **Edge cases:** long filenames/titles; 320 px width; keyboard-only; screen reader phase announcements; reduced motion.
  - **Test:** RTL per failure code/actions; accessibility roles/labels; consent focus/escape; progress aria; no contradictory text.
  - **Depends on:** 9.4, 2.8.

- [ ] **9.7 Add failure copy, actions, and all-locale keys**
  - **Files:** `src/lib/i18n/locales/{en,zh,es,de,fr,ja}.ts`, `src/lib/media/failureCopy.ts`.
  - **Behavior:** Add keys for every failure code, panel state, consent reasons, limitations, and actions. English copy is authoritative; translate naturally in the other five locales. Do not hardcode English in the component. Use the exact keys in D11/D17.
  - **Edge cases:** missing key fallback to English; interpolation for codec names; pluralization for subtitle counts; no technical jargon in primary copy.
  - **Test:** a test asserts every `MediaFailureCode` has a message/action key in `en`; locale files parse and contain the new keys; snapshot primary copy.
  - **Depends on:** 9.6.

- [ ] **9.8 Add the diagnostics ring buffer and copy action**
  - **Files:** new `src/lib/media/diagnostics.ts`, `MediaFailureDetails.tsx`.
  - **Behavior:** Record bounded events (50, 7-day TTL, localStorage) with the D17 fields; redact full paths to basename + 12-char hash; dedupe; `copyDiagnostics()` writes JSON to the clipboard; clear on user action. No network.
  - **Edge cases:** localStorage full/unavailable; clipboard denied; sensitive title (do not include); concurrent writes.
  - **Test:** ring bound/TTL/dedupe/redaction; clipboard mock; no path leakage.
  - **Depends on:** 9.6.

- [ ] **9.9 Preserve learning integrations in tests**
  - **Files:** `src/components/viewer/__tests__/LocalVideoPlayer.*.test.tsx`, `src/components/video/__tests__` (new if needed).
  - **Behavior:** Add regression tests for position save/resume, playback rate, audio focus, transcript sync/seeking, extract loop, VideoFeatures original filePath, and document ID after an artifact switch. Also assert `LanguageVideoHost`'s `sourceFingerprint` is stable across the switch (use document/source identity + transcript signature or rounded duration, not raw artifact duration).
  - **Edge cases:** artifact switch mid-playback; paused switch; initialSeekTime; armed extract; transcript load failure; duration differing by 0.04 s.
  - **Test:** the listed assertions with mocked APIs/media element; no new document created; language-host fingerprint unchanged.
  - **Depends on:** 9.5, 9.6.

- [ ] **9.10 Add mobile/web native-only states**
  - **Files:** `src/hooks/useMediaCompatibility.ts`, `MediaCompatibilityPanel.tsx`, `src/lib/platformCapabilities.ts`.
  - **Behavior:** On Android/iOS, skip Rust inspection/conversion, attach native, and map a non-native failure to `conversion_platform_unsupported` with details and no Convert action. On browser/PWA, use `canPlayType` + media events + optional blob transport probe; code 4 without evidence → indeterminate.
  - **Edge cases:** Android with a stray ffmpeg on PATH; iOS local path; PWA blob URL; no documentId.
  - **Test:** platform-mocked hook/panel tests; no invoke calls on mobile/web for conversion; no Convert button.
  - **Depends on:** 9.3, 9.6.

- [x] **9.11 Add settings diagnostics action wiring**
  - **Files:** `src/components/settings/MediaPlaybackSettings.tsx`, `src/api/mediaCompatibility.ts`.
  - **Behavior:** "Check media support" calls `get_media_runtime_capabilities({refresh:true})` and renders the rows; "Copy diagnostics" uses the same redacted bundle. Disabled on web; native-only message on mobile.
  - **Edge cases:** tool missing; command failure; refresh while a video is open (do not restart playback).
  - **Test:** RTL settings panel tests with mocked capabilities; refresh call; no crash when unavailable.
  - **Depends on:** 4.8, 9.8.

- [ ] **9.12 Map source-resolution failures in DocumentViewer**
  - **Files:** `src/components/viewer/DocumentViewer.tsx`, `src/components/viewer/MediaCompatibilityPanel.tsx`, `src/lib/media/errorClassification.ts`.
  - **Behavior:** When `resolveLocalMediaSource` fails before the video player mounts, classify the error into `source_not_found` (message contains "not found"), `source_permission_denied` (contains "HTTP 403"/"registered document"/"not a regular file"), `source_server_unavailable` (contains "media_server"/"bind"/"stream"), or `source_transport_failed` (timeout), and render the same primary message/actions as the player failure panel (re-import, retry, details) instead of a raw server string. Do not start conversion from this state. Only change the video branch; PDF/EPUB/HTML error rendering is unchanged. If the error cannot be mapped, use `media_compatibility_indeterminate` with details.
  - **Edge cases:** missing file path; unauthorized imported-in-place file; server bind failure; timeout; non-Tauri browser resolution.
  - **Test:** RTL DocumentViewer tests for each code/action; no raw "Tauri command failed" string in primary copy.
  - **Depends on:** 9.1, 9.6, 2.8.

- [ ] **9.13 Extend the video picker filter**
  - **Files:** `src/components/import/VideoImport.tsx`.
  - **Behavior:** Add `ts`, `m2ts`, `flv`, `wmv`, `3gp`, `ogv`, and `mka`? (mka is audio; omit) to the video file filter while keeping existing types. Do not change import copying or document creation.
  - **Edge cases:** platform picker case-insensitivity; unsupported codecs still handled by the compatibility pipeline.
  - **Test:** component test asserts the filter extension list; import still calls `import_video_file` with the selected path.
  - **Depends on:** 9.1.

## Phase 10 — Settings architecture and user controls

- [x] **10.1 Add the settings type, defaults, and merge**
  - **Files:** `src/stores/settingsStore.ts`.
  - **Behavior:** Add `MediaPlaybackSettings` and `mediaPlayback` to `Settings`; defaults from D12; `mergeMediaPlaybackSettings` validates enums and clamps `cacheLimitGb` to 5–500 (non-finite → 25). Wire into hydration next to the other nested merges.
  - **Edge cases:** partial persisted object; unknown enum; `0`/negative/NaN/Infinity; old installations.
  - **Test:** merge table tests; defaults; persisted partial object; clamp; no mutation of other settings.
  - **Depends on:** 9.3.

- [x] **10.2 Add the Settings section metadata**
  - **Files:** `src/components/settings/settingsSections.ts`, `src/components/settings/SettingsPage.tsx`.
  - **Behavior:** Add `SettingsTab.MediaPlayback = "media-playback"` with label key `settings.mediaPlayback`, keywords, icon (`FilmStrip`/`PlayCircle` from Phosphor), description. Add the lazy section render. Ensure mobile/desktop Settings both include it.
  - **Edge cases:** tab order; icon import; lazy chunk; search section registration.
  - **Test:** `SettingsPage` renders the new tab; `SETTINGS_SECTION_METADATA` includes it; no duplicate IDs.
  - **Depends on:** 10.1.

- [x] **10.3 Build `MediaPlaybackSettings.tsx`**
  - **Files:** new `src/components/settings/MediaPlaybackSettings.tsx`.
  - **Behavior:** Implement the controls in D12: mode radio/segmented, quality, hardware, cache usage/limit/clear, media support diagnostics. On mount and after a cache-limit change, call `prune_media_compatibility_cache(limit_gb)` and refresh usage. Use existing settings primitives and `SettingsSearchTarget` IDs. Show platform-specific notes. Confirm clear-cache (existing dialog/toast patterns). Do not expose FFmpeg flags.
  - **Edge cases:** cache usage loading/error; clear while job active; mobile/web gating; long numbers; keyboard/aria.
  - **Test:** RTL: change each setting persists; cache usage renders; clear calls the command and refreshes; mobile hides conversion controls; diagnostics refresh.
  - **Depends on:** 10.2, 8.6, 4.8.

- [x] **10.4 Add search catalog entries and coverage**
  - **Files:** `src/components/settings/search/settingsSearchCatalog.ts`, `src/components/settings/search/settingsSearchCoverage.ts`, `src/components/settings/search/__tests__/*`.
  - **Behavior:** Add section entry and targets: `mediaPlayback.compatibilityMode`, `mediaPlayback.quality`, `mediaPlayback.hardwareAcceleration`, `mediaPlayback.cacheLimit`, `mediaPlayback.clearCache`, `mediaPlayback.diagnostics`. Add a coverage row with sources and exclusions. Ensure target IDs are produced by the component.
  - **Edge cases:** target IDs must be unique; labels use i18n keys; availability desktop-only where appropriate; no cache path in copy.
  - **Test:** existing coverage/catalog tests pass; new target IDs found; search navigation reveals the panel; availability test.
  - **Depends on:** 10.3.

- [ ] **10.5 Register the platform capability**
  - **Files:** `src/lib/platformCapabilities.ts`, tests.
  - **Behavior:** Add `media_compatibility_conversion` as desktop-only (ios/android/web unavailable with `unsupported_platform`). Use it to gate conversion controls/actions. Keep protected capabilities unchanged.
  - **Edge cases:** store build profile; unknown platform; test environment.
  - **Test:** registry test for each platform; protected-surface test unchanged; settings/player gates.
  - **Depends on:** 10.1.

- [ ] **10.6 Add settings i18n keys**
  - **Files:** all six locale files.
  - **Behavior:** Add section/control/description/notes/error keys. Keep labels short; descriptions explain defaults and consequences. Translate.
  - **Edge cases:** pluralization for GB; no untranslated English in primary labels; fallback.
  - **Test:** locale parse; key presence; settings search tests.
  - **Depends on:** 10.3.

- [ ] **10.7 Add settings persistence tests**
  - **Files:** `src/stores/__tests__/settingsStore*.test.ts` (existing pattern).
  - **Behavior:** Round-trip, partial merge, clamp, and no-reset of unrelated settings.
  - **Test:** as described.
  - **Depends on:** 10.1.

## Phase 11 — Packaging, Linux dependencies, and AppImage

- [ ] **11.1 Update the Arch PKGBUILD**
  - **Files:** `PKGBUILD`.
  - **Behavior:** Add `ffmpeg`, `gst-plugins-bad`, `gst-libav` to `depends`; add `optdepends=('gst-plugins-ugly: additional legacy codecs')`; add a comment explaining HEVC/DTS/Matroska and that `gst-plugins-good` provides `matroskademux`. Keep the existing array formatting/style.
  - **Edge cases:** dependency names in Arch; `gst-libav` pulling ffmpeg; no duplicate `ffmpeg`.
  - **Test:** `bash -n PKGBUILD`; a small node/shell test asserts the names; `namcap` if available (not a gate).
  - **Depends on:** 0.4.

- [ ] **11.2 Update the AppImage GStreamer bundle**
  - **Files:** `scripts/ci-build-appimage.sh`.
  - **Behavior:** Add the required/recommended plugins and dependency-copy cases from D15 (`libogg*`, `libvorbis*`, `libopus*`, `libde265*`, `libdca*` as applicable); keep the core-library removal. Do not remove existing plugins. Add comments explaining Matroska/PGS/DTS.
  - **Edge cases:** plugin filename differences across distros (`libgstpulse.so` vs `libgstpulseaudio.so`); missing optional plugins; symlinks (`cp -L`); `libde265`/`libdca` deps.
  - **Test:** `bash -n`; update `scripts/__tests__/appimagePackaging.test.mjs` to assert the new names.
  - **Depends on:** 11.1.

- [ ] **11.3 Add isolated bundled-plugin verification**
  - **Files:** `scripts/ci-build-appimage.sh` (new `verify_bundled_gstreamer`), `scripts/__tests__/appimagePackaging.test.mjs`, `.github/workflows/build.yml`.
  - **Behavior:** Implement D15's isolated `gst-inspect-1.0` check; accept `libde265dec` as HEVC proof and `dtsdec`/`avdec_dca` as DTS proof; fail the build if Matroska/MP4/HTTP/volume or an HEVC/DTS decoder is absent. Set `LD_LIBRARY_PATH="$APPDIR/usr/lib:${LD_LIBRARY_PATH:-}"` so bundled libav/codec deps load, isolate plugin paths from the host, and use a temporary `GST_REGISTRY`. Add `gstreamer1.0-tools` to the AppImage job's apt packages. Log the found elements.
  - **Edge cases:** `gst-inspect-1.0` missing in the build image (install `gstreamer1.0-tools` in CI or fail with a clear message); plugin load warnings; registry cache from a previous build.
  - **Test:** shell test with a fake AppDir/plugin dir and fake `gst-inspect` script; packaging test asserts the function and required elements.
  - **Depends on:** 11.2.

- [ ] **11.4 Verify Debian/Ubuntu dependency declarations**
  - **Files:** `src-tauri/tauri.conf.json`, a packaging test.
  - **Behavior:** Keep the existing `deb.depends` list; add an assertion test that it contains `ffmpeg` and the GStreamer base/good/bad/ugly/libav packages. Document optional `gstreamer1.0-tools` for diagnostics.
  - **Test:** node test parses the JSON and asserts entries.
  - **Depends on:** 0.4.

- [ ] **11.5 Update Linux documentation**
  - **Files:** `docs/LINUX_WEBKITGTK.md`, new `docs/media-compatibility.md`.
  - **Behavior:** Add exact install commands for Arch/Ubuntu/Debian/Fedora; explain FFmpeg vs GStreamer; explain `gst-inspect-1.0`; document the PGS limitation and Plethora's remux behavior; document AppImage vs native package differences; add the platform matrix and privacy/cache notes.
  - **Edge cases:** commands must be correct for each distro; no claims that FFmpeg fixes WebKit; no claims of DV preservation.
  - **Test:** `npm run docs:validate`; markdown link check if available; manual proofread.
  - **Depends on:** 11.1–11.4.

- [ ] **11.6 Add Windows/macOS FFmpeg guidance**
  - **Files:** `docs/media-compatibility.md`, `src/lib/media/failureCopy.ts`, settings diagnostics copy.
  - **Behavior:** Windows: `winget install Gyan.FFmpeg`, Chocolatey, Scoop; macOS: `brew install ffmpeg`; explain PATH/Homebrew discovery and that the app does not bundle it. Link from `conversion_dependency_missing`.
  - **Edge cases:** no network instructions in-app; text only; localization.
  - **Test:** copy key exists; docs validate; no automatic command execution.
  - **Depends on:** 11.5, 9.7.

- [ ] **11.7 Document mobile/browser boundaries**
  - **Files:** `docs/media-compatibility.md`, settings panel.
  - **Behavior:** Android/iOS: native only, no conversion; browser/PWA: native only, no Rust. Explain what users can do (external player, desktop). Do not offer unsupported actions.
  - **Test:** platform gate tests; docs review.
  - **Depends on:** 11.5, 10.5.

- [ ] **11.8 Add the AppImage packaging regression test**
  - **Files:** `scripts/__tests__/appimagePackaging.test.mjs`.
  - **Behavior:** Assert required plugins (`libgstmatroska.so`, `libgstaudioparsers.so`, `libgstsoup.so`, `libgstvolume.so`), the verification function, and the isolated env usage. Keep existing AppDir/manifest tests.
  - **Test:** `npm run test:scripts`.
  - **Depends on:** 11.2, 11.3.

## Phase 12 — Cross-platform validation and release gates

- [ ] **12.1 Linux native package validation**
  - **Files:** `docs/media-compatibility.md` validation log (append evidence).
  - **Behavior:** Build/install the Arch package in a clean environment; verify `gst-inspect` elements; play a generated MKV HEVC/DTS/PGS fixture (or the documented external PGS fixture); verify remux, seek, resume, transcript, extract, cache reuse.
  - **Edge cases:** missing optional plugins; AppImage host without ffmpeg; NVIDIA/VAAPI off.
  - **Test:** recorded commands/results; screenshots/log excerpts (no copyrighted content).
  - **Depends on:** 11.8.

- [ ] **12.2 AppImage validation**
  - **Files:** `docs/media-compatibility.md` validation log (append evidence).
  - **Behavior:** Build the AppImage; run the isolated plugin verification; launch on a clean Arch/Ubuntu host; repeat the fixture playback; verify no host-plugin false pass and no FFmpeg bundling claim.
  - **Test:** recorded results; `ldd`/`gst-inspect` logs.
  - **Depends on:** 11.8.

- [ ] **12.3 Windows/macOS validation**
  - **Files:** `docs/media-compatibility.md` validation log (append evidence).
  - **Behavior:** Build release binaries; verify native MP4; MKV H.264/AAC remux; HEVC capability/transcode; FFmpeg present/absent guidance; VideoToolbox canary/fallback (macOS); cache/job/progress.
  - **Test:** recorded results; no claims without evidence.
  - **Depends on:** 11.6, 10.5.

- [ ] **12.4 Android/iOS validation**
  - **Files:** `docs/media-compatibility.md` validation log (append evidence).
  - **Behavior:** Native MP4/WebM; MKV/HEVC/DTS failure messaging; no conversion UI; no OOM; existing audiobook path unchanged.
  - **Test:** recorded device results; logcat for Android; no JS whole-file reads.
  - **Depends on:** 10.5, 11.8.

- [ ] **12.5 Browser/PWA validation**
  - **Files:** `docs/media-compatibility.md` validation log (append evidence).
  - **Behavior:** Object URL playback; no Rust calls; code 4 without evidence → indeterminate; no conversion UI; revocation.
  - **Test:** recorded browser results; console/network check for no localhost Rust calls.
  - **Depends on:** 10.5.

- [ ] **12.6 Run the original reproduction end-to-end**
  - **Files:** validation log.
  - **Behavior:** On the Arch/Omarchy reference, import a legally obtained MKV matching the reported shape (HEVC Main10 HDR10/DV8 + DTS-HD MA 5.1 + PGS + cover). Verify: inspection values, plan `remux`/`strip_all`, MIME `video/x-matroska`, playback, seek, resume, transcript, extract, cache reuse, original unchanged, no misleading codec/source-access message.
  - **Edge cases:** if the exact file is unavailable, use the external PGS fixture and a generated HEVC/DTS fixture; record the difference.
  - **Test:** recorded evidence for all 18 items in the proposal's acceptance scenario.
  - **Depends on:** 12.1, 9.5–9.9.

- [ ] **12.7 Run performance measurements**
  - **Files:** validation log.
  - **Behavior:** Measure inspection p50/p95, native startup delta, cache-hit reopen, cancellation latency, seek, UI responsiveness, memory, and cache behavior. Compare to D18 targets. Record machine specs and FFmpeg/GStreamer versions.
  - **Test:** numbers recorded; regressions triaged; no fabricated ETA.
  - **Depends on:** 12.6.

- [ ] **12.8 Run security regression tests**
  - **Files:** Rust/frontend test suites.
  - **Behavior:** Traversal/symlink/unauthorized stream, artifact ownership, transport SSRF, malicious filename args, temp cleanup, log redaction, cache containment.
  - **Test:** all listed tests pass; manual review of command construction.
  - **Depends on:** 12.6.

- [ ] **12.9 Run the full local gates**
  - **Files:** repository.
  - **Behavior:** `cargo test` (targeted media modules + full if feasible), `npm run test:run`, `npm run test:scripts`, `npm run build:check`, `npm run bench:check` (if benchmarks changed; otherwise state why not), `npm run docs:validate`.
  - **Edge cases:** pre-existing unrelated failures; document them separately, do not mask.
  - **Test:** exact commands/results in the validation log.
  - **Depends on:** all previous.

- [ ] **12.10 Run audiobook/podcast non-regression**
  - **Files:** `src/components/viewer/__tests__/AudiobookViewer*.test.tsx`, `src/services/audio/__tests__/*`, `src-tauri/src/commands/audiobook.rs` tests.
  - **Behavior:** Verify `.m4b` preparation, loopback `audio/mp4`, range seeking, mobile bounded playback, podcast chunking, and existing audio error handling are unchanged. Confirm no `media_compat` job/document is created for audio.
  - **Test:** targeted suites pass; `AudiobookViewer` source-resolution mocks unchanged; no new artifact rows for audio documents.
  - **Depends on:** 12.9.

- [ ] **12.11 Update release notes and user help**
  - **Files:** `CHANGELOG.md`, `docs/media-compatibility.md`, help content if applicable.
  - **Behavior:** Describe native-first behavior, PGS remux, HDR consent, cache, settings, platform limits, and packaging requirements. Avoid claiming universal codec support.
  - **Test:** docs validate; copy consistent with specs.
  - **Depends on:** 12.9.

## Phase 13 — OpenSpec validation and handoff

- [ ] **13.1 Validate the change**
  - **Files:** `openspec/changes/reliable-local-video-playback-and-codec-compatibility/`.
  - **Behavior:** Run `openspec validate reliable-local-video-playback-and-codec-compatibility --strict`. Fix structural issues (missing scenarios, duplicate requirement names, malformed deltas). Do not weaken requirements to pass validation.
  - **Test:** command exits 0; paste the exact output into the final report.
  - **Depends on:** 12.9.

- [ ] **13.2 Validate all changes/specs**
  - **Files:** repository.
  - **Behavior:** Run `openspec validate --all --strict` (or `--changes --strict` if the full set has unrelated failures) and record any pre-existing failures separately.
  - **Test:** output recorded; no new validation errors from this change.
  - **Depends on:** 13.1.

- [ ] **13.3 Handoff checklist**
  - **Files:** this `tasks.md`.
  - **Behavior:** Confirm every task has a file, behavior, edge cases, test, and dependency; no task says "implement conversion" without a contract. Confirm the design's decisions cover every requirement. Confirm no application code was changed by the proposal author.
  - **Test:** manual checklist + `git status` shows only OpenSpec/docs changes for this authoring task.
  - **Depends on:** 13.1.

- [ ] **13.4 Record known limitations and future boundaries**
  - **Files:** `design.md`, `docs/media-compatibility.md`.
  - **Behavior:** Record P2 items (progressive playback, subtitle sidecar/OCR, DV5, VAAPI/AMF, bundled FFmpeg, mobile conversion, track picker) with rationale and integration points. Do not leave an unresolved P0/P1 decision.
  - **Test:** design has no "TBD"/"decide later" for P0/P1; P2 items are explicitly labeled.
  - **Depends on:** 13.1.
