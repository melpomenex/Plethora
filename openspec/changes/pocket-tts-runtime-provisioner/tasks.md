## 1. Executable resolution (Rust)

- [x] 1.1 Add a pure `resolve_pocket_tts_executable(app) -> Result<ResolvedExecutable, ResolutionFailure>` in `src-tauri/src/pocket_tts.rs` that walks the three tiers in order — provisioned venv (`<app_data>/pocket-tts/<target-triple>/.venv/bin/pocket-tts`, `Scripts\pocket-tts.exe` on Windows), bundled runtime (`resource_dir/pocket-tts-runtime/<triple>` plus the dev-relative `src-tauri/bin/…` and `../src-tauri/bin/…` candidates copied from `notebooklm_runtime_base_candidates`, `notebooklm.rs:2855-2890`), then `PATH` (`~/.local/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`) — skipping the dir it was invoked from. Verify with `#[cfg(test)]` unit tests over a temp dir that a provisioned copy is preferred over a system one, a bundled copy over `PATH`, and that a candidate which exists but is not executable is reported broken rather than selected. [Spec: Runtime resolution reports its source]
- [x] 1.2 Add `PocketTTSSource` (`Provisioned`/`Bundled`/`System`) and `PocketTTSState` (`NotInstalled`/`Installing`/`Installed`/`Broken`/`Failed`) serde enums, and change `PocketTTSStatus` to `{ state, source, executable, detail, error }`, removing `available`/`downloading`/`download_progress`. Verify both enums round-trip through `serde_json` in a `#[cfg(test)]` test, and that `cargo test --lib -p plethora-tauri pocket_tts` passes.
- [x] 1.3 Rewrite `check_pocket_tts_available` (`pocket_tts.rs:99`) to call the resolver, spawn the `--help` probe through the resolved path, and return `Ok(status)` on every path — no `?` on `spawn()` (currently line 118). Map probe-failure to `Broken` with the failing path in `detail` and keep scanning lower tiers; map resolver-failure to `NotInstalled`. Verify with a test that a status call with no executable anywhere returns `Ok` with `state: NotInstalled` rather than propagating an error.
- [x] 1.4 Widen `volume_space` in `src-tauri/src/models/hf/system_info.rs:245` from `pub(crate)` to `pub` so the Pocket TTS disk gate can call it; verify `cargo check -p plethora-tauri` still passes and no existing caller changes.

## 2. Install command (Rust)

- [x] 2.1 Add `POCKET_TTS_INSTALL_REQUIRED_BYTES` (3 GiB) and a `pocket_tts_install_disk_check(app)` that calls `volume_space` on the Pocket TTS install dir and returns a message naming the required and available space when short; returns `Ok(())` when `volume_space` yields `None`. Verify with tests covering the insufficient, sufficient, and unmeasurable cases.
- [x] 2.2 Add a `detect_pocket_tts_python()` helper mirroring `detect_system_python` (`notebooklm.rs:3069`): try `python3`/`python` plus `~/.local/bin`, `/usr/local/bin`, `/usr/bin` on Unix and `py -3`/`python`/`python3` on Windows, each probed with `--version`; return a `Missing` error naming the Python requirement when none respond. Verify the candidate list and the `Missing` mapping with tests.
- [x] 2.3 Add an `augmented_pocket_tts_env()` helper producing the install environment: `HOME`, `USER`, an augmented `PATH`, and `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`/`PIP_INDEX_URL` when set, with `LD_PRELOAD` and `LD_LIBRARY_PATH` removed (unlike synthesis, which keeps the full `env_clear` at `pocket_tts.rs:209-213`). Comment both sites recording why the environments differ. Verify with a test that `LD_PRELOAD` is absent and `HOME`/`PATH` are present.
- [x] 2.4 Implement the install steps as an async function that creates `<app_data>/pocket-tts/<target-triple>/.venv` via `python -m venv`, then runs the install into that venv with `--progress-bar off --disable-pip-version-check --index-url https://pypi.org/simple --extra-index-url https://download.pytorch.org/whl/cpu pocket-tts`, preferring `uv pip install --python <venv python>` with the same index arguments when a `uv` binary is on the augmented PATH. Verify with tests asserting the argument vectors for both front-ends include the CPU extra-index and that the venv path is the install target.
- [x] 2.5 Verify the provisioned runtime by executing its `pocket-tts --help` under the *synthesis* environment and requiring exit code 0; a non-zero exit fails the install with the CLI's own stderr in the message. Verify with a test that a stub executable exiting non-zero produces a failure whose message contains that stderr.
- [x] 2.6 Remove the venv directory on every install failure path (and on cancellation) before returning, so no partial runtime survives. Verify with a test that forces a failing step and asserts the venv directory is absent afterwards.
- [x] 2.7 Add the `pocket_tts_install` command: run the disk check first, take the in-flight guard (2.8), spawn the install detached via `tokio::spawn`, and return immediately rather than holding the IPC call open for the length of a torch download. Verify `cargo check -p plethora-tauri` passes and the command is registered.

## 3. Install state, events, cancel, uninstall (Rust)

- [x] 3.1 Rework `PocketTTSState` (`pocket_tts.rs:82`): replace the unused `available` flag and the dead `current_process` field (nulled but never acted on by `stop_pocket_tts`, line 291) with a single install slot holding a `CancellationToken` and the current phase. Verify `cargo check -p plethora-tauri` passes with no unused-field warnings.
- [x] 3.2 Add the in-flight guard copied from `models/hf/commands.rs:29-108` — `try_register` returning false when an install is already running, and an RAII guard whose `Drop` unregisters on every exit path including panic. Verify with tests: a second register returns false, and the guard releases the slot when dropped.
- [x] 3.3 Add `PocketTTSInstallProgress { id, phase, received, total, percent }` and `PocketTTSInstallFinished { id, ok, cancelled, message }`, emitted on `pocket-tts://install-progress` and `pocket-tts://install-finished`. Emit exactly one finished event on every outcome — success, failure, and cancellation. Verify with tests that the payload shapes serialize and that the phase set covers runtime-fetch, environment-prep, and weight-preload.
- [x] 3.4 Add a `ProgressTracker` in `pocket_tts.rs` shaped like `models/hf/downloader.rs:78-155`: clamp emitted `percent` and `received` to their high-water marks so a retry or late-discovered dependency cannot move progress backwards, and throttle to 100 ms or a 1% jump. Verify with tests that a decreasing byte sequence never produces a decreasing event and that `total: None` yields `percent: 0` with a non-zero `received`.
- [x] 3.5 Parse pip/uv output from the `CommandEvent::Stderr` stream (the same channel already consumed at `pocket_tts.rs:244`) for `Downloading <pkg> (<size>)` and `Using cached <pkg>` lines, maintaining a running announced total and completed count fed into the tracker from 3.4. Verify with unit tests over a fixture of real pip output lines, including output with no parseable sizes.
- [x] 3.6 Preload the model weights as a distinct phase after the runtime is provisioned, by running one short generation through the provisioned CLI, and treat a preload failure as an install failure rather than a warning. Verify with a test that a preload failure marks the install failed and cleans up per 2.6.
- [x] 3.7 Add `pocket_tts_cancel_install`: cancel the token, remove the partial venv, and emit a finished event with `cancelled: true`; return `Ok(())` when nothing is in flight. Verify the no-op path returns success and emits nothing.
- [x] 3.8 Add `pocket_tts_uninstall`: refuse while an install is running, otherwise remove the provisioned venv directory and nothing else — a user-installed `pocket-tts` on `PATH` must remain reported as available afterwards. Return `Ok(())` when no provisioned runtime exists. Verify with tests that a `PATH` candidate still resolves after uninstall and that uninstall during install returns an error.
- [x] 3.9 Register the three new commands in `src-tauri/src/lib.rs` (next to the existing list at lines 2114-2117) and manage the reworked state alongside `app.manage(pocket_tts::PocketTTSState::default())` at line 1398. Verify `cargo check -p plethora-tauri` passes and the app boots with the new commands reachable.

## 4. Error construction (Rust)

- [x] 4.1 Replace the bare `.spawn()?` at `pocket_tts.rs:237` with a context-carrying error naming the resolved executable path, the underlying IO error, and the recovery step (`Reinstall from Settings → Text to Speech, or install it with uv tool install pocket-tts`). Verify with a test asserting the message contains the path and the recovery command and does not consist solely of an OS errno.
- [x] 4.2 Append the same recovery sentence to the non-zero-exit path at `pocket_tts.rs:259-264`, which already carries the CLI's stderr, and to the sidecar-resolution failure at `pocket_tts.rs:189`. Verify with tests that both messages remain readable and include the CLI's own output.
- [x] 4.3 Make the temp text file written at `pocket_tts.rs:193-194` clean up on every exit path via a scope guard — today it is removed only inside the `Terminated` arm (line 252), so a spawn failure leaks it. Keep the `--text-file` mechanism as the `ARG_MAX` workaround and comment why it exists. Verify with a test that the file is gone after a failed spawn.

## 5. Frontend API layer

- [x] 5.1 Update `src/api/pocketTts.ts`: replace `PocketTTSStatus` with the new `{ state, source, executable, detail, error }` shape plus the `PocketTTSState`/`PocketTTSSource` unions, and add TypeScript types for the progress and finished event payloads. Verify `npx tsc --noEmit` passes.
- [x] 5.2 Add `installPocketTTS()`, `cancelPocketTTSInstall()` and `uninstallPocketTTS()` invoking `pocket_tts_install`, `pocket_tts_cancel_install` and `pocket_tts_uninstall`, each guarded by `isTauri()` like the existing wrappers (line 33). Verify `npx tsc --noEmit` passes.
- [x] 5.3 Add `onPocketTTSInstallProgress` / `onPocketTTSInstallFinished` subscribe helpers following the `safeListen` shape in `src/stores/useHfModelStore.ts:113-153` (listener registration that degrades to a no-op unsubscribe when the app is not running under Tauri). Verify with a test that both return an unsubscribe function when `isTauri()` is false.

## 6. Settings panel

- [x] 6.1 Delete `handleDownloadPocketTTS` (`TTSSettings.tsx:836-871`) and replace it with a handler that calls `installPocketTTS()` — no synthesis is involved in starting an install. Verify `grep -n "Download complete" src/` returns nothing.
- [x] 6.2 Rewrite the `pocketStatus` state and the mount-time probe (`TTSSettings.tsx:812-834`) to read the new `state`/`source`/`executable` fields, and remove the fabricated `downloadProgress: 50` / `100` writes. Verify `npx tsc --noEmit` passes and no hardcoded percentage remains in the file.
- [x] 6.3 Subscribe to the install progress and finished events at the point the panel mounts, and drive the progress bar from the reported `percent` and `received`/`total`. Show an indeterminate bar with the phase label whenever `total` is 0. Verify with a component test in `src/components/settings/__tests__/` that emitting a progress event moves the bar and a finished event with `ok: false` shows the failure message.
- [x] 6.4 Offer a Cancel control while `state` is `Installing` and a Remove control when a provisioned runtime is present and no install is running; drop both otherwise. Verify with a component test that the right control renders in each state.
- [x] 6.5 Delete the `pocketStatus.error.includes("not installed")` substring test (`TTSSettings.tsx:1168`) and branch the install hint off `state` instead, so a `Broken` runtime offers reinstall rather than a first-time install command. Verify with a component test that a `Broken` status shows a repair affordance.

## 7. Cleanup, i18n, and verification

- [x] 7.1 Remove the unread `pocketAvailable` field from `src/utils/ttsSettings.ts` and `src/utils/settingsValidation.ts` — it is declared in the schema and referenced by no UI. Verify `grep -rn "pocketAvailable" src/` returns nothing and `npx tsc --noEmit` passes.
- [x] 7.2 Add the new i18n strings (install phases, cancel, remove, and the Python-missing and disk-shortfall recovery messages) to all six locales `src/lib/i18n/locales/{en,de,es,fr,ja,zh}.ts`, and delete the unreferenced `ttsSettings.download` / `ttsSettings.downloadingModel` keys from all six. Verify `npm run docs:validate` passes and `grep -rn "ttsSettings.download" src/` returns nothing.
- [x] 7.3 Run the full gate: `cargo test --lib -- --test-threads=1` for the Rust side and `npx vitest run` for the frontend; confirm both pass and that no existing Pocket TTS, HF downloader, or NotebookLM provisioner test regressed. Verify by the two commands exiting 0.
- [ ] 7.4 Manually exercise the end-to-end flow on a machine with no `pocket-tts` installed: click Download, observe phase-tagged progress advancing to completion, confirm the venv appears under the app data dir and the status reports `Installed` with `source: Provisioned`, then confirm a synthesis succeeds and a second synthesis uses the cached weights without a network stall. Verify by observing both the status response and audio output.
- [ ] 7.5 Manually verify the failure and recovery paths: remove any `pocket-tts` from `PATH`, confirm the status reports `NotInstalled` and the panel offers install; cancel a running install and confirm the venv is removed and the button becomes usable again; remove a provisioned runtime and confirm a `PATH` installation is still reported as available afterwards. Verify all three by observing the status response and the panel state.

## Implementation notes

Deviations from the plan, recorded so the artifacts and the code agree:

- **1.2/3.1 name collision.** The design's status enum (`PocketTTSState`) and the
  managed state both wanted the name `PocketTTSState`. The enum keeps the name
  (it is the contract the frontend branches on) and the managed state is now
  `PocketTTSInstallState`; `lib.rs:1398` was updated to match.
- **1.2 emitted `percent` stays phase-local.** `PocketTTSInstallPhase::share()`
  reports each phase's slice of the bar and the panel composes it, because the
  design requires `percent: 0` (an indeterminate bar) whenever the total is
  unknown — folding a server-side window in would put a made-up number on the
  wire.
- **2.1 disk gate split.** `decide_install_disk_space(measured, required, dir)`
  holds the rule and `check_install_disk_space` does the volume probe, because
  `volume_space` effectively never returns `None` on a live machine, so the
  "unmeasurable ⇒ proceed" case is otherwise untestable.
- **3.5/4.x process spawning.** Install steps spawn through `tokio::process`
  rather than `tauri-plugin-shell`'s `CommandEvent`, because they need an
  explicit environment and a cancel that can kill the child. `spawn_tolerant`
  retries `ETXTBSY` (exec'ing a script pip wrote moments earlier), which also
  removed a real flake in the stub-based tests.
- **4.x synthesis resolves tiers.** `generate_pocket_speech` walks the resolved
  candidates and falls through on failure, because a runtime this app
  provisioned has to be usable for synthesis. The packaged sidecar wrapper is
  the last-resort entry. The resolution itself is not re-probed per utterance —
  `pocket-tts --help` imports torch and would cost seconds.
- **7.2 install refusals carry a reason code.** The plan called for localized
  Python-missing and disk-shortfall recovery text; the design kept install
  messages as prose. Both were honoured by making `pocket_tts_install` reject
  with `{ reason, message }` (`PocketTTSInstallRefusal`) — a code, so the panel
  never has to match a substring, which is the thing this change removes.
- **6.x panel extracted.** The Pocket TTS panel moved out of the 1500-line
  `TTSSettings.tsx` into `src/components/settings/PocketTtsStatusPanel.tsx` so
  it owns its own event subscription and is testable on its own.
