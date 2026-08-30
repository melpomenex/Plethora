# Proposal: fix-nemotron-model-download

## Why

Downloading the local Nemotron ASR model (495 MB GGUF) is effectively broken: the progress bar repeatedly jumps back toward 0% and then the install dies with an opaque `error decoding response body` message. Two concrete defects cause this: (1) the downloader's retry loop restarts the byte count — and the whole download — from zero on every attempt, and (2) the shared `hf_client()` applies a 60-second *total* request timeout that a ~495 MB body can never satisfy on typical connections, so mid-stream aborts (and therefore visible progress resets followed by failure) are near-guaranteed.

## What Changes

- Remove the total-request timeout from the HTTP client used for artifact downloads (keep connect + a read/idle inactivity timeout instead), so a slow-but-alive 495 MB stream is never killed mid-body.
- Make download progress monotonic and honest across retries: on retry, resume from the bytes already on disk via HTTP `Range` requests (server-supported), or at minimum carry the cumulative byte count forward so the emitted percent never moves backwards.
- Emit a clear `attempt N of M — resuming at X%` style progress/state signal on retry instead of silently restarting the bar.
- Preserve the partial `.part` file across retries so `Range: bytes=<received>-` resume is possible; only delete it on cancel, final failure, or integrity mismatch (unchanged).
- Replace raw reqwest error text (`error decoding response body: …`, `request or response body error: operation timed out`) with user-readable causes (connection lost, server closed the stream early, timed out waiting for data, disk full, etc.) with the underlying cause appended for diagnosis.
- Emit the `hf://install-finished` event with `ok: false` on download/install failure so both progress stores (`useTranscriptionStore`, `useHfModelStore`) clear their `installing`/progress state and the UI never shows a stale in-progress row after a failure.
- Guard against duplicate concurrent installs of the same model id (reject or join the in-flight install instead of letting two downloads interleave under one progress key).

## Capabilities

### New Capabilities
- `hf-model-download-reliability`: Streaming artifact-download behavior for HF-managed models — monotonic progress, resumable retries, large-file-safe timeouts, human-readable failures, and terminal failure events that clear UI state.

### Modified Capabilities
<!-- None: the hf-model-manager capability spec was never archived into openspec/specs/, so there is no existing spec to delta. -->

## Impact

- **Rust backend (`src-tauri/src/models/hf/`)**
  - `downloader.rs`: retry/resume logic, progress emission, error translation, `.part` retention policy.
  - `hf_client.rs`: split into a metadata client (total timeout fine) and a download client (no total timeout; connect + idle/read timeouts).
  - `manager.rs` / `commands.rs`: failure-path `install-finished { ok: false }` emission, in-flight install dedupe.
- **Frontend stores**
  - `src/stores/useHfModelStore.ts`, `src/stores/useTranscriptionStore.ts`: handle `ok: false` finished events (clear progress/installing; surface message).
- **Tests**: new/updated unit tests in `downloader.rs` (resume-with-Range, monotonic progress, timeout-client config, readable errors) and store tests for the failure path.
- **No breaking API changes** — Tauri command signatures and event payload shapes stay compatible (`InstallFinished` already carries `ok`).
