## 1. Diagnostic classification (backend)

- [ ] 1.1 Add an `SttFailureKind` enum (`GpuBackend`, `CorruptModel`,
      `MissingSidecar`, `MissingSharedLibrary`, `UnsupportedAudio`,
      `Cancelled`, `OutOfMemory`, `Unknown`) plus a pure
      `classify_stt_failure(stderr: &str, exit_code: Option<i32>,
      gpu_active: bool, saw_progress: bool) -> SttFailureKind` in
      `src-tauri/src/transcription/engine.rs`. Enter `GpuBackend`
      structurally when `gpu_active && !saw_progress` (the silent-crash case),
      and otherwise match the load/library/audio/OOM patterns; verify with
      `cargo test --lib transcription::` unit tests covering the reported log
      (ends at `n_langs = 99`, `use gpu = 1`, no progress) → `GpuBackend`, and
      each other kind's representative stderr.
- [ ] 1.2 Add a `SttFailure { kind, message, detail }` builder producing one
      sentence plus one next step per kind (e.g. `GpuBackend` names the compute
      backend and points at the CPU retry; `CorruptModel` names the model and
      points at Settings → Audio Transcription). Verify the `GpuBackend` message
      contains neither `whisper_model_load:` nor more than one line.

## 2. Pre-flight model integrity (backend)

- [ ] 2.1 Expose pinned `size_bytes` / `sha256` lookup by model id from
      `src-tauri/src/transcription/model_manager.rs` (values already exist at
      `model_manager.rs:119-165`), reusing the `sha256` crate already used by
      `download_model`; verify with a `cargo test --lib` unit test that a known
      id returns its pinned size and that an unknown id returns `None`.
- [ ] 2.2 Add `validate_model_file(path, profile) -> Result<(), SttFailure>`:
      `metadata()` length vs `size_bytes` on every call, SHA-256 only when the
      size disagrees or a `force_digest` flag is set (see design.md D3). Verify
      with unit tests for exact-size pass, short-file fail, same-size/digest
      mismatch under `force_digest`, and a catalog entry with an empty digest
      (size-only).
- [ ] 2.3 Call the validator from `TranscriptionEngine::transcribe` before
      spawning the sidecar; the HF-registry path (`podcast.rs:587`
      `resolve_installed_path`, no catalog entry) falls back to a length check
      and never blocks; verify with a unit test that a short model file returns
      the `CorruptModel` failure and never spawns a process.

## 3. CPU fallback retry (backend)

- [ ] 3.1 Extract the current spawn/stderr loop body of `transcribe`
      (`engine.rs:492-643`) into a single-attempt runner returning an attempt
      record — `exit_code`, `gpu_active`, `saw_progress`, capped `stderr`,
      `stdout` — with the existing progress parsing, backend-banner detection,
      sidecar env setup and 4000-byte stderr cap unchanged; verify the existing
      audiobook and podcast tests still pass (`cargo test --lib transcription::`).
- [ ] 3.2 Turn `transcribe` into a two-attempt loop over
      `{ no_gpu: false } → { no_gpu: true }` where attempt 2 runs only when
      attempt 1 failed with `gpu_active && !saw_progress` (see design.md D1);
      pass `-ng` on the CPU attempt. Verify with a unit test over the attempt
      record that the predicate fires for the reported failure, does not fire
      for a CPU-only failure, and does not fire after progress was seen.
- [ ] 3.3 Ensure segments are handed to `on_segment` only for the attempt that
      exits 0, and that a failed attempt's stale `<audio>.wav.json` is deleted
      before the retry reuses the same audio path; verify with a unit test that
      a failed-then-successful sequence yields exactly the successful attempt's
      segments with no duplicates.
- [ ] 3.4 Emit `transcription://phase` = `retrying-cpu` before spawning attempt
      2 (existing event at `engine.rs:565`); verify with a test that the event
      precedes the second spawn and is not emitted for a single-attempt run.
- [ ] 3.5 Replace the three raw-stderr error branches in `transcribe`
      (`engine.rs:619-643`, including `format!("Whisper transcription failed:
      {}", stderr_clean)`) with a single `SttFailure` built from
      `classify_stt_failure`, keeping the capped raw excerpt as `detail`; verify
      with a unit test that an uncategorised failure still names the model and
      engine and does not surface the raw excerpt as the message.

## 4. Thread the CPU pin through the podcast command (backend)

- [ ] 4.1 Add `no_gpu: Option<bool>` to `transcribe_podcast_episode`
      (`podcast.rs:407`), `run_transcription_job`, `transcribe_route`
      (`engine.rs:815`) and the sherpa/nemotron branches it fans out to (ignored
      there, so their signatures stay uniform); verify with
      `cargo test --lib` that the command compiles with an omitted argument and
      that `no_gpu: Some(true)` skips the retry loop.
- [ ] 4.2 Set `podcast://transcription-progress` status `retrying-cpu` from
      `run_transcription_job`'s throttled progress callback so the podcast
      progress band does not look stalled during the fallback; verify with a
      test that the emitted status reaches the existing
      `podcastTranscriptionProgress` state shape (`{ status: string, progress:
      number }`).
- [ ] 4.3 Ensure the failure path still records `update_episode_transcript_status
      (..., "error", Some(<classified message + detail>), None)`
      (`podcast.rs:693`) and that a retry via `no_gpu` overwrites it with
      `"done"`; verify with a repository-level test that a failed-then-retried
      episode ends in `done` with no leftover error reason.

## 5. Podcast view recovery UI (frontend)

- [ ] 5.1 Stop rendering raw errors in the podcast branch of `handleTranscribe`
      (`AudiobookViewer.tsx:2692-2695`): render the classified message and keep
      the detail out of the toast; verify with a component test that a
      `GpuBackend` failure shows the short message and no `whisper_model_load:`
      text.
- [ ] 5.2 Add a *Retry on CPU* action for `GpuBackend` that re-invokes
      `transcribePodcastEpisode(..., no_gpu: true)` (add the optional param to
      `src/api/podcast.ts:341`); verify with a test that the action issues one
      extra invoke with `no_gpu: true`.
- [ ] 5.3 Add a *Try cloud transcription* action shown only when a cloud
      provider is configured, routing through
      `transcribePodcastEpisodeWithGroq`; verify with a test that it is absent
      without a configured key and present with one.
- [ ] 5.4 Apply the same message + recovery handling to the
      `podcast://transcription-error` listener (`AudiobookViewer.tsx:2924-2932`),
      which is the path the auto-started transcription uses; verify with a test
      that an emitted error event renders the same actions as the `catch`.

## 6. Stop the auto-start retry loop (frontend)

- [ ] 6.1 Add `podcastTranscriptStatus === "error"` to the bail-out condition of
      the auto-start effect at `AudiobookViewer.tsx:2956-2965` so a failed
      automatic attempt does not re-trigger itself and re-download the audio;
      verify with a test that after an `error` status the effect issues no second
      invoke, and that an episode with no attempt still auto-starts once.
- [ ] 6.2 Show the recorded failure and its recovery actions in the transcript
      panel header (`:3952-3956`) when the episode status is `error` and there
      is no transcript; verify with a component test that the panel shows the
      actions rather than only "Transcribing Audio...".

## 7. Archive prerequisite (pre-existing, unrelated to the fix)

- [ ] 7.0 Before `openspec archive`, repair the structural defect in
      `openspec/specs/audiobook-podcast-stt-routing/spec.md`: it still carries
      the leftover delta header `## ADDED Requirements` instead of
      `## Requirements`, so its four requirements are invisible to validate,
      list and archive (`openspec list --specs` reports it as
      `requirements 0`) and `openspec validate --strict` warns that this
      change's delta for that capability would be refused at archive time.
      Renaming the header is a one-line fix, but it is outside this change's
      scope — confirm with the user before touching a main spec, and note that
      several other archived specs in `openspec/specs/` share the same defect.

## 8. Verification

- [ ] 8.1 `cargo test --lib transcription::` and `cargo test --lib
      commands::podcast` pass.
- [ ] 8.2 `npm run lint` and `npx tsc --noEmit` pass.
- [ ] 8.3 `npx vitest run` for the touched frontend test files passes.
- [ ] 8.4 Add an opt-in live sidecar test (skipped when
      `src-tauri/bin/whisper-*` is absent or a 0-byte placeholder) that
      transcribes a short generated WAV through the engine twice — once
      normally, once with `no_gpu: true` — and asserts segments are produced
      both times; verify by running it once on a machine where the binary exists.
- [ ] 8.5 Manually confirm on a GPU-equipped Linux box that a podcast
      transcribe which fails on the accelerated attempt completes on the
      `retrying-cpu` attempt, and that the toast shows one sentence rather than
      the `whisper_model_load:` dump. Record the result in the change folder.