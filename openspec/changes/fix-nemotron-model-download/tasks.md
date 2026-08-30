## 1. HTTP client split (timeout fix)

- [x] 1.1 In `src-tauri/src/models/hf/hf_client.rs`, split `hf_client()` into `hf_metadata_client()` (today's connect 15 s + total 60 s, used for repo-info/LFS-pointer probes) and `hf_download_client()` (connect 15 s, no total timeout, `read_timeout(60 s)` for per-read inactivity), keeping token/UA/default-header behavior identical for both
- [x] 1.2 Switch `manager::install` (`src-tauri/src/models/hf/manager.rs:886`) to use `hf_download_client()` for artifact downloads; audit every other current `hf_client()` call site and leave metadata/probe calls on the metadata client
- [x] 1.3 Unit-test the client config: `hf_download_client()` has no total timeout and a read timeout set; `hf_metadata_client()` keeps the 60 s total

## 2. Resumable, monotonic downloader

- [x] 2.1 In `src-tauri/src/models/hf/downloader.rs`, rework the retry loop: stat the `.part` file per attempt, send `Range: bytes=<resume_from>-`, handle `206` (append + `received = resume_from`), `200` (truncate + restart from zero), and `416`/other (truncate + restart); keep the `.part` file on mid-stream failure, delete it only on cancel / final failure / integrity mismatch / restart-from-zero
- [x] 2.2 Add the cross-attempt high-water mark: emit `percent = max(computed, emitted_max)` clamped to 100, so progress never moves backwards even on a 200-restart; when `total` is unknown emit real `received` bytes with `total: 0` / `percent: 0.0`
- [x] 2.3 Move SHA-256 verification to the assembled file via the existing `sha256_of_file()` helper after `flush()` and before rename, replacing the incremental stream hasher (resume-aware); keep fail-closed behavior and error text on mismatch
- [x] 2.4 Throttle progress events (emit at most every 100 ms or on ≥1% change, always emit the terminal 100% event)
- [x] 2.5 Add the error-translation helper (`classify_download_error`: timeout → "timed out waiting for data (connection stalled)", decode/incomplete-body → "connection lost while downloading", connect → "could not reach the server", else "network error while downloading") and use it for all download-failure messages with the underlying cause appended
- [x] 2.6 Unit tests in `downloader.rs` using `TestServerBuilder`: (a) mid-stream drop then `206` resume completes without re-downloading the first bytes (assert server saw a `Range` header and total bytes served < full body × 2), (b) `200`-on-range-retry still completes with monotonic progress (capture emitted events via a mock progress sink or refactor to inject an emit closure), (c) corrupt/stale `.part` still fails integrity closed, (d) stalled connection (hold_after_bytes) aborts via read timeout and retries, (e) cancel still removes the `.part` file

## 3. Terminal failure events + install dedupe

- [x] 3.1 In `manager::install`, emit `hf://install-finished` with `InstallFinished { ok: false, message }` on any download/verification failure (and a `cancelled` message on the cancel path) before returning the error, using the same `progress_id` as progress events
- [x] 3.2 In `src-tauri/src/models/hf/commands.rs`, extend the active-downloads registry into an in-flight guard: `register` fails with "…is already downloading" when the id is active, unregister via Drop-guard so panics/early returns can't leak entries; route both `hf_install_model` and the Nemotron arm of `download_transcription_model` through it
- [x] 3.3 In `src-tauri/src/models/hf/hf_client.rs` `fetch_repo_info`, on `.json()` decode failure read the body (lossy, truncated to ~200 chars) and return a descriptive "Hugging Face API returned an unexpected non-JSON response" error instead of the raw decode error; add a unit test with an HTML body
- [x] 3.4 Rust tests: duplicate `hf_install_model` for an in-flight id errors with the already-downloading message; failed install emits `ok: false` finished event (assert via a progress/event capture helper)

## 4. Frontend state hygiene

- [x] 4.1 In `src/stores/useHfModelStore.ts`, handle `ok: false` in the `install-finished` listener: clear `installing`/progress for the id and surface the message (existing toast flows stay as the user-facing error)
- [x] 4.2 In `src/stores/useTranscriptionStore.ts`, mirror the same `ok: false` handling so a failed Nemotron download clears `downloadProgress`/`status` for the logical key (`nemotron-3.5-asr-0.6b`, including the `nemotron-asr` id mapping)
- [x] 4.3 When `total` is 0/unknown, render bytes-downloaded (e.g. "213 MB downloaded") instead of a percentage in `AudioTranscriptionSettings` progress UI (and HF manager footer if applicable)
- [x] 4.4 Add/extend store tests: `ok: false` finished event clears state in both stores; unknown-total progress renders without NaN/broken percent

## 5. Verification

- [x] 5.1 Run `cd src-tauri && cargo test` — all existing downloader/manager tests pass plus the new ones
- [x] 5.2 Run frontend test suite for the touched stores/components (`npm run test` or scoped vitest) and `npm run test:scripts`
- [x] 5.3 Run `npm run bench:check` to confirm no benchmark regressions (expected: unaffected — downloads are I/O-bound, not benchmarked). Result: the gate is environment-red right now — clean `main` fails 24 budgets and this branch fails 22, with the differing names flipping between runs; no benchmark touches the changed code, so no baseline update per the AGENTS.md protocol
- [ ] 5.4 (needs the running desktop app) Manual smoke on the Nemotron download button in AudioTranscriptionSettings: progress is monotonic, completing on a throttled connection, cancel works, and a forced failure (network off) shows a readable error with no stale in-progress row
