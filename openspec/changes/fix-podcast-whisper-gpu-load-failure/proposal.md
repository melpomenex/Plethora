## Why

Local podcast transcription is a dead end on any machine whose GPU backend
crashes while the Whisper sidecar loads weights. The user chooses *Transcribe*
in podcast view, waits for the audio download, and gets a toast containing
25 lines of raw `whisper_model_load:` spam instead of a transcript. The
reported run shows `use gpu = 1`, `gpu_device = 0`, `backends = 1` and then
dies immediately after `whisper_model_load: n_langs = 99` — before
`whisper_model_load: CPU total size` ever prints, i.e. inside the tensor-read
/ GPU-offload loop. The same sidecar, model and audio transcribe fine on CPU
(verified standalone on the dev machine: exit 0, valid transcript), and the
on-disk model matches its pinned catalog digest
(`7691eb11…c970a`), so the weights are not at fault. The engine
(`src-tauri/src/transcription/engine.rs`) spawns the sidecar without `-ng`,
has no retry, and validates the sidecar binary but never the model, so there
is no recovery path and no actionable message. This is the flagship local-STT
journey failing outright, and it needs to self-heal.

## What Changes

- **Pre-flight model validation.** Before spawning the Whisper sidecar, verify
  the resolved model file against the pinned catalog (`size_bytes`, and
  `sha256` when the profile provides one). A short/partial download now fails
  with "model file is incomplete or corrupt — re-download in Settings" instead
  of launching a process that is guaranteed to die.
- **CPU fallback retry.** When a Whisper run exits non-zero *and* the sidecar
  reported a GPU backend (`use gpu = 1`, or a `ggml_vulkan_init` /
  `ggml_cuda_init` / `ggml_metal_init` line) *and* no audio was processed
  (no progress emitted), the engine re-spawns the sidecar once with `-ng`
  (`--no-gpu`) and continues on CPU. One retry, no loops.
- **Retry is announced.** A `transcription://phase` = `retrying-cpu` event
  (plus the mirrored podcast progress status) fires before the retry so the UI
  can say "GPU backend failed — retrying on CPU" instead of appearing hung.
- **Failure classification.** Whisper stderr is mapped to a small set of
  actionable categories — `gpu-backend-failure`, `corrupt-model`,
  `missing-sidecar`, `missing-shared-library`, `unsupported-audio`, `cancelled`,
  `out-of-memory`, `unknown` — each with a short user-facing message that names
  the cause and the next step. The raw stderr is preserved (capped) for the
  episode's `error` column, but is no longer what the user reads.
- **Frontend surfaces the cause and offers a way out.** The podcast transcribe
  handler stops rendering `String(err)` into the toast, shows the classified
  message, and offers a *Retry on CPU* action for `gpu-backend-failure`
  (re-runs with the CPU-pinned backend) when a Groq key is configured.
- **Regression coverage.** Rust unit tests for the stderr classifier and the
  retry predicate; a live sidecar test (opt-in, skipped when the binary is a
  placeholder) proving `-ng` still produces a transcript.

No breaking API changes: existing Tauri command signatures and the podcast
transcript schema are unchanged. Local Whisper transcription becomes strictly
more likely to succeed and strictly more legible when it does not.

## Capabilities

### New Capabilities

- `local-stt-engine-resilience`: Reliability contract for the local
  speech-to-text sidecar — pre-flight model integrity validation, deterministic
  GPU→CPU fallback retry, retry visibility events, and classification of local
  engine failures into actionable, user-facing diagnostics.

### Modified Capabilities

- `audiobook-podcast-stt-routing`: the podcast route must treat a local
  sidecar failure as retryable-on-CPU (and offer cloud) rather than terminal,
  so a GPU-backend crash no longer ends the user's transcribe journey. Routing
  *selection* rules are unchanged; only failure handling is added.

## Impact

- `src-tauri/src/transcription/engine.rs` — sidecar arg construction (`-ng`
  retry), stderr classification, phase event emission, existing
  `format!("Whisper transcription failed: {}", …)` branch at line 627.
- `src-tauri/src/transcription/model_manager.rs` — expose catalog
  `size_bytes` / `sha256` lookup for pre-flight validation (pinned values
  already exist at lines 119–165).
- `src-tauri/src/commands/podcast.rs` — surface the classified error and the
  `retrying-cpu` status; the existing `update_episode_transcript_status(...,
  "error", …)` at line 693 keeps working with the new message.
- `src/components/viewer/AudiobookViewer.tsx` — podcast `handleTranscribe`
  error branch (line 2692) renders the classified message plus the retry
  affordance instead of `String(err)`.
- Frontend: `src/api/podcast.ts` (a CPU-pinned transcribe entry point) and the
  error-shape used by the toast.
- No new runtime dependencies; the whisper sidecar already accepts `-ng`.
- Cross-cutting: every other caller of `TranscriptionEngine::transcribe`
  (audiobooks, auto-transcribe on import) inherits the fallback for free.