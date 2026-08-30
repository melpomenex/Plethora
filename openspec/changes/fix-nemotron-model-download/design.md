# Design: fix-nemotron-model-download

## Context

The Nemotron pinned install (`install_pinned_nemotron_asr` → `manager::install` → `downloader::download_file`) streams a 495,831,520-byte GGUF through a reqwest client built by `hf_client()` (`src-tauri/src/models/hf/hf_client.rs:215`), which sets `.timeout(60s)` — in reqwest 0.12 a *total* deadline covering body streaming. Three observable defects follow:

1. `downloader.rs` retry loop (`for attempt in 0..=MAX_RETRIES`, line 73) re-creates the `.part` file and resets `received = 0` (line 98) on every attempt, so each mid-stream abort visibly rewinds the progress bar; after 4 attempts the install fails with `Err(last_error)`.
2. Mid-stream aborts surface as `Stream interrupted: error decoding response body: …` (reqwest `Kind::Decode` from `bytes_stream()`, wrapped at `downloader.rs:141/174`) or `… request or response body error: operation timed out` (total-timeout mid-body) — neither is actionable for users.
3. On failure no `hf://install-finished { ok: false }` is ever emitted (`InstallFinished` is only emitted on success paths), so `useHfModelStore`/`useTranscriptionStore` keep stale `installing`/progress entries.

Constraints: SHA-256 fail-closed verification, `.part` + atomic-rename, and cancellation semantics must be preserved (they are security/correctness invariants from the `hf-model-manager` work). Tauri command signatures and event payload structs stay compatible.

## Goals / Non-Goals

**Goals:**
- A 495 MB download on a slow (but live) connection completes without user-visible progress resets and without spurious failures.
- Retries waste no bandwidth: resume via HTTP `Range` from the bytes already on disk.
- Every terminal state (success/cancel/failure) clears UI state via the existing `hf://install-finished` event.
- Error text a non-engineer can act on ("connection lost", "timed out waiting for data", "disk full").

**Non-Goals:**
- No general download manager (no concurrent multi-file parallelism, no global bandwidth limits).
- No persistent cross-restart resume bookkeeping beyond the `.part` file itself (an app restart starts the download fresh — same as today).
- No changes to the legacy whisper/sherpa `transcription/model_manager.rs` downloader beyond what falls out for free.
- No UI redesign of the progress bar; only honest data underneath it.

## Decisions

### D1: Two clients, not one — `hf_metadata_client()` and `hf_download_client()`
`fetch_repo_info`/`fetch_file_metadata` are small JSON/text requests that *should* be bounded by a total timeout. Artifact streaming must not be. Rather than removing the timeout globally, split `hf_client()`:
- `hf_metadata_client()`: today's config (connect 15 s, total 60 s) — used for API/pointer probes.
- `hf_download_client()`: connect 15 s, **no total timeout**, `.read_timeout(60 s)` (per-read inactivity; reqwest 0.12 `read_timeout` is idle-gap based, refreshed on every chunk) — used by `manager::install` for `download_file`.

*Alternative considered:* keep one client and only raise the total timeout (e.g. 30 min). Rejected: a total deadline that large masks genuinely-stalled connections, and any finite total is still a latent bug for bigger future models. Inactivity-based abort is the correct semantic for streaming.

### D2: Range-resume retry loop in `download_file`
Per attempt, instead of `File::create` (truncate):
1. Stat the `.part` file; if it exists, that length is `resume_from`.
2. Send `Range: bytes=<resume_from>-`.
   - `206 Partial Content`: append (`OpenOptions::append`), start `received = resume_from`, seed nothing into the hasher (see D3).
   - `200 OK`: server ignored the range → truncate and restart from zero (progress stays monotonic via the high-water rule below).
   - Lower than requested (e.g. `416`): truncate and restart.
3. On mid-stream error: **keep** the `.part` file (retry can resume), backoff, retry.
Delete `.part` only on: cancel, integrity mismatch, final failure (loop exhausted), or restart-from-zero.

The existing 4-attempt / 1-2-4 s backoff stays.

### D3: Hash across resumes — hash the final file
The incremental `Sha256` cannot span a resume (the first segment's hasher state is gone after the failed attempt, and a 200-restart makes offsets ambiguous). Change verification to: after `flush` + rename-ready, compute the hash over the assembled `.part` via the existing `sha256_of_file()` helper (already used elsewhere). Cost: one extra sequential read of ≤495 MB (~1–3 s on modern disks) per install — acceptable for a once-per-model operation, and it also *strengthens* verification (catches wrong-byte-scope assembly bugs the streaming hasher couldn't).

*Alternative:* persist hasher state to disk per chunk. Rejected: complexity and I/O for no user-visible gain.

### D4: Monotonic progress via high-water mark
Keep `received` per attempt, but track `emitted_max` across the whole `download_file` call; emit `percent = max(computed, emitted_max)` and clamp to 100 for the final event. Combined with resume (D2) the common case is genuinely-cumulative bytes; the clamp only matters for the rare 200-restart path. Also: when `total` is unknown (no content-length, no hint), emit `percent: 0` + real `received`/`total: 0` and let the UI show "MB downloaded" — the stores already carry `received`/`total`.

Progress-event throttling (emit at most every ~100 ms or on ≥1% change) is added while touching this code to cut IPC noise on fast connections.

### D5: Error translation layer
A small `classify_download_error(e: &reqwest::Error) -> &'static str` mapping to readable heads:
- `is_timeout()` → `timed out waiting for data (connection stalled)`
- `is_decode()` / body-incomplete → `connection lost while downloading`
- connect errors → `could not reach the server`
- otherwise → `network error while downloading`
Wrapped as `anyhow!("Download failed: {readable} (retried {MAX_RETRIES+1}×; {underlying})")`. `fetch_repo_info` gets the same treatment for its `.json()` call: on decode failure, read the body as text (lossy, truncated) and report `Hugging Face API returned an unexpected non-JSON response` with a snippet. reqwest 0.12's `read_timeout`-triggered aborts classify as timeouts, satisfying the stalled-connection scenario.

### D6: Failure terminal event + in-flight dedupe
- `manager::install` wraps `download_artifact_files` so any `Err` emits `FINISHED_EVENT` with `InstallFinished { id: progress_id, ok: false, message }` before returning (today only success emits, `manager.rs:957`). Cancel path already deletes partials; it also emits `ok: false` with a `cancelled` message.
- `commands.rs` `ActiveHfDownloads` gains an in-flight guard: `register(id)` returns `Err("…already downloading")` if the id is active; `unregister(id)` on completion/failure/cancel (RAII-ish guard struct so early-returns can't leak entries). Both `hf_install_model` and `download_transcription_model` (Nemotron arm) go through it.
- Frontend: `useHfModelStore` and `useTranscriptionStore` `install-finished` listeners handle `ok: false` — clear `installing`/progress for the id, expose `error` message; transcription settings already toasts the command error, so the store change is state-hygiene only.

### D7: Multi-file progress (small, while here)
`download_artifact_files` loops files under one install id; per-file percent restarts at 0 per file. With D4's per-file high-water this is still per-file. Emit `file` label (already present) and leave aggregation out of scope; Nemotron is single-file, so no user-visible change there. Not spec'd beyond the existing monotonicity requirement.

## Risks / Trade-offs

- [HF CDN range behavior varies] Some edge cases return `200` for a Range request → we restart from zero (correct, slightly slower). → Mitigation: D2 handles 200 explicitly; progress stays monotonic (D4), so the user never sees the bar rewind even then.
- [Stale `.part` from a previous app run] A leftover `.part` could be stale/corrupt. → Mitigation: resume only reuses length, and D3 hashes the *final assembled file* against the pinned SHA-256 — a corrupt resume can never be installed (fail closed preserved).
- [Read-timeout vs slow trickling servers] A server sending 1 byte/59 s stays alive; one pausing 61 s dies. 60 s idle window is generous; retry+resume makes a false abort cheap. → Tunable constant if field reports demand it.
- [Extra full-file hash read] ~1–3 s extra per install. → Acceptable for once-per-model; not on any hot path (no benchmark gate impact; downloads are I/O-bound, `npm run bench:check` unaffected).
- [Dedupe guard leak on panic/early-return] → Guard struct with Drop-based unregister in `commands.rs`, plus the registry already self-heals on next install attempt.

## Migration Plan

Pure backend-behavior + store-hygiene change; no data or config migration. Rollback = revert commit; `.part` files left behind by an older/newer version are ignored-or-restarted safely (D3 verifies the final file regardless).

## Open Questions

None blocking — read-timeout window (60 s) and throttle cadence (100 ms / 1%) are tunable constants that don't affect the contract.
