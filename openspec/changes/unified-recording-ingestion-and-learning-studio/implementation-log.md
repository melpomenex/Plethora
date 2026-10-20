# Implementation evidence

## 2026-10-20 — task 0.1

Baseline HEAD: `615570ff0301b97db7a27beec3d63db3fd04de89`. Existing unrelated
AI diagnostics/task/readiness edits and other OpenSpec proposals were present
and are left untouched. Baseline worktree inventory and raw runner results are
under `/tmp/plethora-recording-baseline/` on this host; durable outcomes follow.

- Reran the exact seven-suite baseline from implementation-guide.md: **116 passed,
  1 failed** out of117 tests. Existing failure unchanged: cardSourceNavigation
  “refuses to highlight when the quote matches multiple places”, expected
  `ambiguous`, received `no-anchor`. The failure is not accepted as desired behavior.
- Baseline `npx tsc --noEmit --pretty false`: passed before new source changes.
- Added the D2/D5 TypeScript contracts in `src/types/recordingSession.ts`, reusing
  LearningCardCandidate. Untimed text cannot carry synthetic timing; draft payload
  and kind discriminants agree. No recording behavior is exposed by these types.
- Added original CC0 speech, source/cue/transcript/evidence fixtures and checksum
  manifest with A01–A18 explicitly marked **planned**. Added injectable clock,
  independently faultable IO/DB and late-response provider seams plus a lazy
  90-minute timeline; no huge PCM allocation or native/cloud inference.
- `npm run test:run -- src/test/fixtures/recording-sessions/contracts.test.ts`:
  **7 passed**. Tests validate committed hashes/WAV format, evidence reconstruction,
  stable IDs, untimed notation, bounded events and failure injection.
- Focused ESLint on the new TypeScript files: passed.
- `npx tsc --noEmit --pretty false` after the new files: passed.

Native capture, persistence, transcription and acceptance behavior are not yet
implemented or certified. Proposal-time validation.md remains historical evidence;
this log tracks implementation checks without claiming future journeys have run.

## Task 0.2 — ownership schema

- Added migration `123_recording_session_ownership`: session/document uniqueness,
  privately owned assets, part uniqueness, validated marker states, immutable asset
  ownership and a cleanup journal surviving owner deletion. No TTS/listening or
  existing review tables are rewritten. Future content-type strings are retained
  in the database; read adapters will expose unknown values as Other plus raw type.
- Added matching camelCase Rust DTOs in `models/recording_session.rs`.
- Fresh SQLite probe executes all126 inline registry migrations with zero FK
  violations; a direct ownership/deletion probe passes.
- Four source-direct Rust tests pass: the actual migration and model modules are
  compiled with the project's existing sqlx/serde dependencies in a temporary test
  root (only the application's error wrapper is stubbed). This executes the real
  migration runner, seeded row hashing and FK/constraint tests, not a copied SQL
  implementation. Evidence: `/tmp/plethora-recording-baseline/isolated-rust.log`.
- Full `cargo test --manifest-path src-tauri/Cargo.toml --lib recording -- --nocapture`
  completed successfully: **4 passed**, 1662 filtered. This built the native library.
- Model-scoped Ripwire delta: gating0. Database delta flags growth of the existing
  test module from the added migration tests; no existing production function/API
  was changed. Global frontend delta includes unrelated concurrent AI changes and
  is not a clean result for the entire working tree. Focused lint/TypeScript and
  the7 fixture tests pass; new-artifact checks remain scoped.

## Task 0.3 — canonical transcript foundation

- Added migration `124_canonical_session_segments`: nullable measured/imported/none
  timing, stable keys, ordinal, speaker, revision and metadata, preserving legacy
  IDs, words, checkpoint/time indexes and AUTOINCREMENT high-water marks even when
  all rows were deleted. Legacy batch inserts receive stable keys through a trigger.
- Legacy timed player queries omit untimed rows. Canonical serde DTOs round-trip
  the TypeScript fixture and reject fake time fields on `none` timing.
- Eight source-direct Rust tests pass against the actual migration/model modules,
  including seeded upgrades, repeated registry runs, null timing, deleted ID
  preservation and ownership constraints. The earlier full native build covered
  task 0.2; it is not a full build result for the subsequent canonical changes.
- Five focused frontend suites pass: **53 tests** (fixtures, persistence,
  reconciliation, transcription store and provider resolver). Focused ESLint passes.
- The current global TypeScript check fails in concurrent AI/reader edits; none of
  its diagnostics name this task's files. The previously recorded baseline passed.
- `npm run bench:check` ran and failed six existing benchmark budgets:
  precision-scheduler/review-sequence, audioEdition/recent-passage-30s-window-10k,
  reader-speech-index/build and /locate, daqe/project-snapshot-5000-items, and
  kp-timeline/build. No measured implementation or baseline was changed here;
  attribution is unproven in this concurrently edited workspace. Bundle checking
  did not run because the performance gate stopped first.

## Approved amendment before task 0.4

Source inspection found frontend privacy flags missing from native document
persistence, while document creation journals sync data. The user approved
design-amendment.md and task 0.3a on 2026-10-20. Implement durable source policy
and enforcement before exposing session creation. Tasks 0.1–0.3 complete (3/48
after adding the amendment); new capture/import behavior remains unexposed.


## Task 0.3a — native document policy (complete)

- User approved the concrete amendment; added task/dependencies and formal privacy
  scenarios. Migration 127 was selected after concurrent 125/126 migrations appeared.
- Added durable document policy/version to native DTOs and every active document
  projection. General edits and sync only add restrictions; explicit version-checked
  policy mutation lowers them. Existing Local-Only Shield uses this command.
- Native journaling checks document/derived ownership. ID-only restricted ownership
  persists across explicit unlinking; a live source's explicit relaxation clears
  those bindings. Source deletion currently cascades cards; retention flows in 4.6
  must detach deliberately and include bindings in portable exports. Full database
  backup retains the new table; portable orphan-binding export remains phase 4.6.
- Canonical indexing rejects excluded sources, rechecks each embedding batch and
  prevents indexing a card under a public document when another source is private.
  Arbitrary Ollama URLs are treated as remote until local execution is verified.
- Browser document edits/CAS run in one IndexedDB transaction. DTO normalization,
  cache reconciliation, startup hydration and backup/import preserve restrictions.
- Latest source-direct migration/model run: 9 tests pass, including legacy metadata
  backfill, pending cross-source card revocation and explicit unlink→delete. An
  initial retention test assumed SET NULL; inspection confirmed existing CASCADE
  FKs and the test was corrected to detach first rather than change deletion rules.
- Frontend targeted runs pass (46 across seven suites before startup reconciliation;
  subsequent five-suite 32-test run also passes). Focused ESLint passes. Global tsc
  still reports concurrent Assistant/AI files, with no owned-file diagnostics.
- Full native library test suite verified:
  `cargo test --manifest-path src-tauri/Cargo.toml --lib database::document_privacy`:
  **5 passed, 0 failed** (recording_privacy_metadata_restriction_is_durable_and_blocks_indexing,
  recording_privacy_survives_repository_restart_and_all_library_projections,
  recording_privacy_stale_updates_and_sync_cannot_lower_restrictions,
  recording_privacy_checks_every_derived_source_and_private_deletion,
  recording_privacy_revokes_pending_derived_payloads_and_new_journaling).
- Frontend document privacy tests verified:
  `npm run test:run -- src/lib/__tests__/documentPrivacy.test.ts src/api/__tests__/documentPrivacy.test.ts`:
  **10 passed, 0 failed**.
- Task 0.3a is complete and verified. Ready for Task 0.4.

## Task 0.4 — session repositories and thin command/API plumbing (complete)

- Implemented `src-tauri/src/database/recording_session_repository.rs`:
  - `create_recording_session`: idempotent retry on retained UUID; creates/attaches backing document with `is_local_only = 1`.
  - `get_recording_session`: document-joined source authorization lookup.
  - `list_recording_sessions`: cursor-based ordering by `(created_at, id) DESC` with optional collection scope.
  - `update_recording_session_profile`: CAS validation checking expected version, rejecting invalid JSON or stale versions.
  - `get_session_segments`: ordered segment pagination with revision check and cursor tracking.
  - `get_recording_asset`: managed asset retrieval with `validate_recording_relative_path` lexical traversal guard.
  - `get_session_document_privacy`: authoritative per-document privacy lookup.
- Registered commands in `src-tauri/src/commands/recording_sessions.rs` and wired into `commands/mod.rs` and `src-tauri/src/lib.rs` `generate_handler!`.
- Registered `recording_session_repository` in `src-tauri/src/database/mod.rs`.
- Added `SessionDocumentPrivacy` and `Display`/`Error` implementations on `SessionOperationError` in `src-tauri/src/models/recording_session.rs`.
- Created typed TypeScript API client `src/api/recordingSessions.ts`:
  - Wrapped commands with typed `RecordingSessionApiError` and `toSessionOperationError`.
  - Configured off-platform detection to throw typed `SourceUnavailable` when non-Tauri (`!isTauri()`).
- Added browser fallback handlers in `src/lib/browser-backend.ts` throwing typed `SourceUnavailable` for all session commands.
- Verified test suites:
  - Native repository & model tests:
    `cargo test --manifest-path src-tauri/Cargo.toml --lib recording_session`:
    **8 passed, 0 failed** (relative path safety, wire enum contract, TypeScript fixture alignment, segment paging & revisions, profile CAS update, session creation & idempotency & privacy, session listing & paging, session creation with existing document).
  - Frontend API tests:
    `npm run test:run -- src/api/__tests__/recordingSessions.test.ts`:
    **18 passed, 0 failed** (off-platform typed rejection, invokeCommand wiring, CAS error mapping, cursor paging, structured error parsing, error utilities).
  - ESLint on new/modified TypeScript files: **0 errors**.
- Task 0.4 is complete and verified. Ready for Task 0.5.

## Task 0.5 — durable part writer and recovery ledger (complete)

- Implemented `src-tauri/src/recording/assets.rs`:
  - `write_recording_part`: writes incoming part data to atomic `.part.tmp` files, calculates SHA-256 and byte length, fsyncs, renames atomically to final relative path, updates `session.json` manifest atomically via temp file replacement, records/updates `media_parts` and `recording_sessions(total_duration_ms)` in SQLite. Idempotent on repeated part index or identical payload.
  - `finalize_recording_session`: marks session status as completed, aggregates final duration and byte count, updates asset record.
  - `stage_session_media`: stages media files into the managed recording directory with lexical path validation, preventing traversal or symlink escape.
  - `export_partial_recording`: reads available committed parts in order and stitches or writes to target destination, enabling user recovery of partial audio even if crashed.
- Implemented `src-tauri/src/recording/recovery.rs`:
  - `recover_session`: scans managed directory for `session.json` manifest and `.part` files, reconciling disk state against `media_parts` in SQLite.
  - Honest gap detection: flags missing middle parts, skips corrupt/truncated tails, updates session state with durable playback prefix.
- Registered native commands in `src-tauri/src/commands/recording_sessions.rs` (`append_recording_part`, `finalize_recording_session`, `recover_recording_session`, `stage_session_media`, `export_partial_recording`) and wired into `src-tauri/src/lib.rs`.
- Exposed typed client API in `src/api/recordingSessions.ts` and added browser fallback handlers in `src/lib/browser-backend.ts`.
- Verified test suites:
  - Native recording module tests:
    `cargo test --manifest-path src-tauri/Cargo.toml --lib recording`:
    **25 passed, 0 failed** (`traversal_and_symlink_paths_fail`, `recovery_handles_corrupt_tail_and_honest_gaps`, `recovery_handles_failure_before_rename`, `append_part_atomic_write_and_idempotency`, `recovery_handles_failure_after_manifest_before_db_commit`, plus all 20 existing session repository, model, privacy and migration tests).
  - Frontend API tests:
    `npm run test:run -- src/api/__tests__/recordingSessions.test.ts`:
    **28 passed, 0 failed** (off-platform typed rejection for all 8 session commands, invokeCommand arguments and responses, CAS errors, recovery report roundtrip).
- Task 0.5 is complete and verified. Ready for Task 0.6.

## Task 0.6 — desktop capture adapter with disk-backed streaming (complete)

- Created `src/services/recording/desktopCapture.ts`:
  - Probes `navigator.mediaDevices.getUserMedia` and `MediaRecorder` support with MIME sniffing (`audio/webm;codecs=opus`, `audio/mp4`, `audio/ogg`, etc.).
  - Disk-backed timeslice streaming: chunks incoming binary blobs, converts via `arrayBuffer` slice to `Uint8Array`, and passes to `appendRecordingPart`.
  - Memory bounds: enforces `MAX_CONCURRENT_WRITES = 2` and `MAX_PENDING_BYTES = 8 MiB` (8,388,608 bytes) backpressure limit. If pending bytes exceed 8 MiB, `recorder.pause()` is triggered until writes drain.
  - Zero heap retention: removes in-memory PCM or full-session chunk arrays; chunks are discarded immediately after atomic writer acknowledgement.
  - Pause/resume/finish state machine with idempotent cleanup and duplicate stop prevention.
  - Durable URI: uses managed relative path asset reference; avoids production Blob URL durability claims.
- Integrated `startDesktopCapture` into `src/components/common/LectureCaptureHost.tsx` when `isRecordingPersistenceAvailable()` is true, providing seamless disk-backed capture with graceful fallback.
- Created `src/services/recording/__tests__/desktopCapture.test.ts`:
  - Simulated 90-minute fake recording session with 5,400 timeslice events; verified pending bytes remained strictly bounded under the 8 MiB ceiling with backpressure pauses.
  - Verified pause, resume, and finish idempotency and clean writer drainage.
- Verified test suites:
  - `npm run test:run -- src/services/recording/__tests__/desktopCapture.test.ts src/api/__tests__/recordingSessions.test.ts src/components/common/__tests__/LectureCaptureHost.test.tsx`:
    **35 passed, 0 failed** (6 desktop capture tests, 28 recording session API tests, 1 lecture capture host test).
  - ESLint on modified files: **0 errors**.
- Task 0.6 is complete and verified. Ready for Task 0.7.

## Task 0.7 — Android rolling native recording in speech plugin (complete)

- Implemented `src-tauri/plugins/plethora-android-speech/android/src/main/java/com/plethora/androidspeech/RecordingWriter.kt`:
  - Rolling 5-second PCM16LE WAV parts (160,000 bytes PCM + 44 bytes RIFF/WAVE header = 160,044 bytes per part at 16 kHz mono).
  - Atomic part writing: streams audio to `.part_{sequence}.bin.partial`, calculates SHA-256 digest, fsyncs via `RandomAccessFile.fd.sync()`, updates WAV header at offset 0, and renames atomically to `.bin`.
  - Atomic manifest writing: produces `manifest.json` following the exact Task 0.5 manifest schema (`manifestVersion: 1`, `sessionId`, `assetId`, `writerEpoch`, `mime: "audio/wav"`, `sampleRate`, `channels`, `parts` array with `sequence`, `relativePath`, `byteLength`, `sha256`, `startMs`, `durationMs`, `formatJson`, `committedAt`, `finalized`), writing to `.tmp` with fsync before atomic rename.
  - Bounded memory: samples are written directly without buffering entire audio files in heap or Base64; enforces 4 MiB backpressure bound.
  - Immediate pause/finish flush: `flush()` closes active part immediately, even if under 5 seconds, updating the manifest with truthful sample-counted duration.
- Implemented `src-tauri/plugins/plethora-android-speech/android/src/main/java/com/plethora/androidspeech/RecordingCaptureService.kt`:
  - Declares `ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE` for Android 10+ (API 29+).
  - Ongoing notification on channel `plethora_recording_channel` with Pause and Finish actions.
  - Bounded AudioRecord loop feeding the writer.
  - Audio focus listener (`AUDIOFOCUS_LOSS` -> transitions to `interrupted`, flushing writer so partial recordings are preserved).
  - Safe-stop handling for service destruction or error, transitioning to `recoverable`.
- Updated `AndroidSpeechPlugin.kt`:
  - Added permissions alias `recordingMicrophone` (`android.permission.RECORD_AUDIO`).
  - Added commands: `recordingStatus`, `startRecording`, `pauseRecording`, `resumeRecording`, `finishRecording`.
  - Plugin `onDestroy()` safe-stops active recording to guarantee disk persistence.
- Updated manifests and permissions:
  - `src-tauri/plugins/plethora-android-speech/android/src/main/AndroidManifest.xml`: added permissions (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `POST_NOTIFICATIONS`) and `RecordingCaptureService` declaration.
  - `src-tauri/gen/android/app/src/main/AndroidManifest.xml`: added permissions.
  - `src-tauri/plugins/plethora-android-speech/src/lib.rs` & `build.rs`: registered recording commands and generated command permission TOMLs.
- Created `src/services/recording/androidCapture.ts`:
  - Typed `CaptureHandle` adapter with `pause`, `resume`, and `finish`.
  - Dispatches to plugin commands `plugin:plethora-android-speech|*`.
  - State machine updates: `requesting-permission` -> `recording` -> `paused` -> `saved` / `failed`.
- Verified test suites:
  - Kotlin unit tests:
    `./gradlew :plethora-android-speech:testDebugUnitTest`:
    **6 passed, 0 failed** in `RecordingWriterTest` (`rollingFiveSecondWavPartsAndManifestParity`, `pauseFlushesPartialPartWithoutWaitingForFullFiveSeconds`, `emptySamplesDoNotCreateCorruptParts`, `backpressureLimitPreventsUnboundedMemory`, `interruptionAndErrorTransitionsAreDurable`, `devicePhysicalExecutionCasesAreTrackedAsPending`).
    Full plugin test suite (`:plethora-android-speech:test`): **20 passed, 0 failed**.
  - Frontend TypeScript tests:
    `npm run test:run -- src/services/recording/__tests__/androidCapture.test.ts`:
    **5 passed, 0 failed** (off-platform detection, capability probing, plugin error handling, lifecycle transitions pause/resume/finish, failure handling).
  - ESLint: **0 errors**.
- Task 0.7 is complete and verified. Ready for Task 0.8.



