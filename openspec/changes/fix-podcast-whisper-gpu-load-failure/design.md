## Context

The local Whisper path is a subprocess, not an in-process engine:
`transcribe_podcast_episode` (`src-tauri/src/commands/podcast.rs:407`) →
`run_transcription_job` → `TranscriptionEngine::transcribe_route`
(`engine.rs:815`) → `TranscriptionEngine::transcribe` (`engine.rs:492`),
which builds `-m <model> -f <audio> -ojf --print-progress [-l <lang>]`, spawns
the `whisper` externalBin, parses stderr line-by-line for `progress = N%` and
the backend banner, then reads `<audio>.wav.json`.

Constraints that shape the approach:

- **The accelerator is implicit.** No `-ng` is ever passed, so whisper.cpp
  auto-selects a backend. On the reporter's Linux box that banner was
  `use gpu = 1 … backends = 1` (Vulkan); on this dev box the same binary prints
  `whisper_backend_init_gpu: device 0: CPU … no GPU found`. The same binary
  transcodes successfully on CPU (verified: exit 0, valid transcript). The
  crash window is between `whisper_model_load: n_langs = 99` and
  `whisper_model_load: CPU total size` — the tensor-read / offload loop.
  Note the failure is *silent* (no error line), which is why the user sees a
  truncated log rather than a diagnosis.
- **Integrity is already pinned.** `ModelProfile` carries `sha256` and
  `size_bytes` (`model_manager.rs:119-165`) and `download_model` verifies the
  digest of the freshly fetched stream (`model_manager.rs:358-367`) — but only
  at download time. `check_sidecar_usable` (`engine.rs:358`) checks the
  *sidecar binary* for presence/non-zero size and never looks at the model.
- **`transcribe` is shared.** Audiobooks, auto-transcribe on import and the
  podcast route all land in the same function, so a fix here is one fix
  everywhere — but also means any new argument must be optional.
- **The surface is duplicated.** The raw stderr reaches the user twice: via the
  `catch` in the podcast branch of `handleTranscribe`
  (`AudiobookViewer.tsx:2694`) and via the `podcast://transcription-error`
  listener (`:2930`). Both render `String(err)` / `payload.error`.
- **Auto-start re-arms on failure.** The effect at `AudiobookViewer.tsx:2956`
  fires `handleTranscribe()` whenever the panel is open, nothing is
  transcribing, and there is no transcript. After a failure the episode status
  is `error`, which satisfies that condition — so a failed automatic attempt
  re-triggers itself and re-downloads the audio, indefinitely.

See `proposal.md` for motivation and `specs/` for the behavioral contract.

## Goals / Non-Goals

**Goals:**

- A crashed/errored accelerated run is followed by exactly one CPU-only
  re-attempt, and the user is told it is happening.
- A short model or a wrong-bytes model never reaches the engine process.
- The user reads one sentence naming the cause, not 25 lines of
  `whisper_model_load:` output; the raw output is still recorded.
- The podcast view can recover (CPU retry / cloud) and does not re-arm itself
  into a loop after a failure.

**Non-Goals:**

- Rebuilding or re-signing the whisper sidecar, or adding Vulkan/CUDA runtime
  provisioning. If the accelerator is broken on a machine, we degrade past it;
  we do not repair it.
- A user-facing "use GPU / use CPU" preference in Settings. The retry is
  automatic; an explicit pin is only threaded through the internal call for the
  recovery action.
- Changing sherpa-onnx (`parakeet`, `sense-voice`) or Nemotron execution — those
  never touch the whisper CLI. The classifier and events are shaped so a later
  change can reuse them, but nothing is migrated now.
- Anything about audiobooks' UX beyond inheriting the engine fallback.

## Decisions

### D1 — Retry with `-ng` inside the engine, not in the podcast command

The retry lives in `TranscriptionEngine::transcribe` as an attempt loop
(`Attempt { args, no_gpu }`), so every caller benefits and there is no
per-caller re-download of the audio.

*Alternative considered:* retry in `run_transcription_job`. Rejected — it would
duplicate the whole download/prepare step, and the audiobook path would keep the
bug.

The attempt's outcome record needs three facts the current code already tracks
but discards: `gpu_active` (parsed from the banner at `engine.rs:557-576`),
`saw_progress` (from the `progress =` branch at `:579`), and the captured
stderr. The retry predicate is `gpu_active && !saw_progress && !already_retried`.
`saw_progress` is the safety interlock: whisper re-writes the same
`<audio>.wav.json`, so restarting a partially-processed run risks duplicated
segments, and the spec requires the persisted transcript to contain exactly one
attempt's segments. Segments are only handed to `on_segment` after a run exits
0, so the failed attempt contributes nothing.

### D2 — Classify stderr into a fixed enum, and only then build the message

A pure `classify(stderr, exit_code, gpu_active) -> SttFailureKind` over a
`&str`, unit-testable without spawning anything. Kinds:
`GpuBackend`, `CorruptModel`, `MissingSidecar`, `MissingSharedLibrary`,
`UnsupportedAudio`, `Cancelled`, `OutOfMemory`, `Unknown`.

*Alternatives considered:* (a) pass stderr through unchanged — the status quo,
rejected by the spec; (b) regex the message in the frontend — splits the
knowledge across two languages and makes it untestable in one place.

The classifier is deliberately pattern-based over a *bounded* stderr prefix: the
engine already caps `stderr_buf` at 4000 bytes (`engine.rs:607`), and the
classifier only needs the first lines, where whisper prints its banner and any
load error. `GpuBackend` is also entered structurally when `gpu_active` is true
and the run died before `CPU total size`, so it does not depend on matching a
driver-specific string.

The user-facing message is one sentence plus one next step, assembled from the
kind. The raw excerpt is retained in the error value for
`update_episode_transcript_status(..., "error", ...)` so the episode still
carries a diagnosable record — the frontend just stops being the primary reader
of it.

### D3 — Pre-flight validation: size always, digest only on suspicion

Full SHA-256 of `ggml-distil-small.en.bin` is ~336 MB per transcription — not
acceptable on the hot path. So: compare `metadata().len()` against
`ModelProfile::size_bytes` on every run (a stat, effectively free), and compute
the digest only when the size already disagrees or when the caller asked for a
verification pass. A size-correct / digest-wrong file is not a real failure mode
here — the digest exists to catch a bad *download*, which truncates.

*Alternative considered:* always verify the digest. Rejected on cost.
*Alternative considered:* no pre-flight check at all, relying on the retry.
Rejected — a short file also breaks the CPU run, so the retry cannot save it and
the user would get two confusing failures.

`ModelManager` gains a lookup for a profile's pinned `size_bytes` / `sha256`
by id; `resolve_installed_path` (the HF-registry branch, `podcast.rs:587`) has
no catalog entry, so it falls back to a size check against `metadata()` only
and never blocks.

### D4 — Thread an optional `no_gpu` flag for the explicit recovery action

`transcribe_podcast_episode` gains an optional trailing `no_gpu: Option<bool>`;
`run_transcription_job` forwards it to `transcribe_route` →
`transcribe(..., attempt: WhisperAttempt { no_gpu })`. When `no_gpu` is set at
entry, the first attempt is already the CPU one and the fallback is skipped
(there is nothing to fall back *from*).

*Alternative considered:* a settings key `audioTranscription.preferCpu`. Rejected
as premature — the automatic retry covers the real case, and the flag is only
needed for a one-shot user action after both attempts already failed.

### D5 — Recovery UI driven by the diagnostic kind, not by string matching in the view

The classified failure must reach the frontend structurally. The podcast branch
of `handleTranscribe` catches the rejected value and renders `kind` +
`message`; for `GpuBackend` it shows a *Retry on CPU* action that re-invokes
`transcribePodcastEpisode(..., no_gpu: true)`, and — only when a cloud provider
is configured — a *Try cloud transcription* action that routes through
`transcribePodcastEpisodeWithGroq`. The `podcast://transcription-error` listener
gets the same treatment, so the auto-started path (which never goes through the
`catch`) is covered too.

Ordering with the auto-start effect: `podcastTranscriptStatus === "error"` must
become part of the effect's bail-out condition, otherwise a failed automatic
attempt re-arms itself and re-downloads the audio forever. That guard is the
difference between "one clear failure" and "a user watching the same episode
download repeatedly".

### D6 — Bounded, capped excerpts everywhere

The retry needs the failed attempt's stderr for classification, and the episode
needs a diagnosable reason. Both use the existing 4000-byte cap rather than an
unbounded buffer, and neither is what the user reads.

## Risks / Trade-offs

- **The retry makes a broken-GPU machine 2× slower to fail.** Mitigation: the
  retry only triggers when nothing was transcribed, so the wasted work is model
  load plus a partial decode, not a full pass. And it succeeds, so it is not a
  failure path in practice.
- **The accelerator may be slow rather than broken.** `-ng` is only added on an
  actual failure, so healthy GPU runs are untouched.
- **`use gpu = 1` with a working Vulkan backend still crashes**, so the classifier
  matches "accelerated and died before producing anything" rather than any
  specific driver string — the fix is correct even for drivers whose message we
  have never seen.
- **Silent process death loses the cause.** A SIGSEGV leaves no stderr; the
  structural `gpu_active && !saw_progress` signal is what carries the diagnosis
  in that case, which is why `GpuBackend` is reachable without a string match.
- **The size-only integrity check can pass a same-size corrupt file.**
  Deliberate; covered in D3. If it ever matters, a Settings-driven
  "verify model" action reuses the same code path.
- **Adding a Tauri command parameter is a wire change.** It is optional with
  `Option<bool>`, so older frontends and the auto-transcribe path keep working.
- **Two spawn sites for the classifier to keep in sync.** The retry and the
  final failure message must agree; both read the same attempt record, and the
  classifier is the single place that decides the kind.