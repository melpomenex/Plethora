## Context

See proposal.md — Why. The current-state facts that shape the approach:

`src-tauri/src/pocket_tts.rs` is 343 lines and exposes four commands. `check_pocket_tts_available` (line 99) resolves the executable through `tauri_plugin_shell::ShellExt::sidecar("pocket-tts")`, which resolves relative to the current executable (`relative_command_path` in tauri-plugin-shell 2.3.5, `process/mod.rs:121`), and then `.spawn()?` at line 118 — the `?` propagates a raw `std::io::Error` with no context, so a missing executable surfaces as `No such file or directory (os error 2)`. `generate_pocket_speech` (line 169) has the same unwrapped `.spawn()?` at line 237, after having already written a temp text file. `PocketTTSStatus` (line 59) carries `downloading` and `download_progress` that are hardcoded `false`/`None` at both construction sites. The UI's `handleDownloadPocketTTS` (`TTSSettings.tsx:836-871`) calls `generatePocketSpeech({ text: "Download complete." })` and sets a hardcoded `downloadProgress: 50` before the call and `100` after.

The repo already has two working precedents this change must line up with:

- **A managed venv provisioner.** `ensure_managed_notebooklm_runtime` (`src-tauri/src/notebooklm.rs:3151-3233`) detects a system Python (`detect_system_python`, line 3069), creates a venv under `app_dir/runtime/<target-triple>/.venv`, then runs `-m pip install` through `run_command_required` (line 3109). It is the exact shape Pocket TTS needs — but it is fully blocking: it captures output with `.output().await` and emits no progress, so it cannot be reused as-is for a UI-driven install.
- **A progress-event downloader.** `src-tauri/src/models/hf/downloader.rs` defines `PROGRESS_EVENT = "hf://install-progress"` and `FINISHED_EVENT = "hf://install-finished"`, a `ProgressTracker` that clamps emitted percent/bytes to their high-water marks (lines 78-155), a `CancellationToken`, an in-flight dedup registry with an RAII unregister guard (`models/hf/commands.rs:29-108`), and a free-space gate reusing `volume_space` (`models/hf/system_info.rs:245`, currently `pub(crate)`) via `disk_insufficient` (`models/hf/suitability.rs:315`). The frontend consumer is `src/stores/useHfModelStore.ts` with module-scope `listen(...)` registration and a progress bar in `HuggingFaceModelManager.tsx`.

Two constraints that are not obvious:

- **The bundled runtime is not actually shipped.** `src-tauri/bin/pocket-tts-runtime/` is git-ignored and populated only when `scripts/download-sidecars.js` runs with `POCKET_TTS_BUNDLE_RUNTIME=1` (set in `.github/workflows/{build,release}.yml`, never locally). It is also absent from `bundle.resources` in `tauri.conf.json:51-55`, `tauri.linux.conf.json:29-31` and `tauri.macos.conf.json:7` — `bin/notebooklm-runtime` is declared, `bin/pocket-tts-runtime` is not. The "bundled runtime" fallback is therefore a third-tier path that only exists in CI-produced bundles with a packaging fix, not a dependable one.
- **A default `pip install pocket-tts` pulls ~4.7 GB of GPU wheels.** The locally built runtime measures 3.2 GB in `nvidia/`, 1.2 GB in `torch/`, 896 MB in `triton/`, because pip resolves `torch` from the default index. The runtime the provisioner creates must pin the CPU wheel index or it downloads several gigabytes of CUDA libraries the app can never use on a CPU-only engine.

## Goals / Non-Goals

**Goals:**

- The Download control performs a real install, reports real progress, can be cancelled and removed.
- A raw OS errno never reaches the user; every failure names the executable tried and the recovery step.
- Install state is structural (not installed / installing / installed / broken / failed) so the UI branches on a code, not a substring.
- CPU-only wheels. A working install should be hundreds of megabytes, not gigabytes.
- The provisioned runtime is invisible to Python tooling the user owns.

**Non-Goals:**

- Shipping the runtime in the installer bundle. That is a packaging-size decision, not a correctness one, and it is deferred — the resolver already has a bundled tier for it.
- Unifying the two download mechanisms. The HF `downloader.rs` fetches pinned files from a known URL with a known SHA; provisioning a Python package means letting pip resolve a dependency closure, which is a different problem with a different failure surface. Reuse the HF *patterns* (event names, tracker, dedup guard, disk gate), not the fetcher.
- Migrating `notebooklm.rs` to the new helper. Out of scope, and it would put a working path at risk for a cosmetic gain.
- Fixing the 0-byte `pocket-tts-x86_64-pc-windows-msvc.exe` placeholder. The provisioned path does not need it; the packaged Windows path does, and that is a separate packaging task.
- Streaming synthesis audio or voice previews.

## Decisions

### The provisioner mirrors the NotebookLM managed venv, with progress added

Create `<app_data_dir>/pocket-tts/<target-triple>/.venv`, run `python -m venv`, then `python -m pip install` inside it, then verify by executing the venv's `pocket-tts --help`.

**Why this and not a downloaded tarball.** The repo already builds exactly this layout at build time (`scripts/download-sidecars.js:621-746`, `buildPortablePocketTTSRuntime`) and the wrapper scripts already know how to consume it (`bin/pocket-tts-x86_64-unknown-linux-gnu:33-41`: `PYTHONHOME` + `PYTHONPATH` + `python3 -m pocket_tts`). A provisioned venv is the same contract with a different owner, so `resolve_pocket_tts_executable` can treat both tiers identically. It also needs no archive extraction code, no new dependency, and no URL manifest to keep in sync with the release pipeline.

**Alternative considered — download a prebuilt runtime archive.** It would work without Python on the machine, and it is the only option that helps a user with no Python at all. It rejected because it requires publishing per-triple archives, verifying them, and unpacking them safely, and the machine still needs nothing else only if the archive is self-contained (5.7 GB as currently built). Revisit if "no Python available" proves to be the common case.

**Alternative considered — `uv tool install`.** Faster and the resolver already falls back to `~/.local/bin`. Rejected: `uv` is not a dependency of the app, and installing into a uv tool directory means mutating a user-global tool store, which the "does not touch a pre-existing user environment" requirement rules out. `uv` is still worth *using* if present, as a faster `pip install` front-end — see the pip decision below.

### pip runs with the CPU wheel index and emits parseable progress

Inside the venv:

```
python -m pip install --progress-bar off --disable-pip-version-check \
    --index-url https://pypi.org/simple \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    pocket-tts
```

**Why `--extra-index-url` for torch and not a `torch==...+cpu` pin.** In PEP 440 a local version (`2.5.1+cpu`) sorts *above* the plain release (`2.5.1`), so pip prefers the CPU wheel from the PyTorch index without pinning a version that would go stale and break the install on the day PyTorch publishes a new one. `--index-url` stays PyPI so `pocket-tts` and its non-torch dependencies resolve normally.

**Why the wrapper script's `env_clear` is not reused here.** `generate_pocket_speech` clears the environment (line 209-213) to stop AppImage `LD_LIBRARY_PATH`/`LD_PRELOAD` leaking into the sidecar's child processes. Install must *keep* `HOME`, `PATH` and proxy variables — pip needs them to reach the index and to land the HF cache. The install command therefore sets an explicit augmented environment (the pattern in `augmented_path_env` / `detect_system_python`, `notebooklm.rs:3069-3088`) and only strips `LD_PRELOAD`/`LD_LIBRARY_PATH`.

**Progress from parsing pip's own output.** `tauri-plugin-shell`'s `CommandEvent::Stderr` stream already exists in this module (used at line 244). pip emits `Downloading torch-2.x-....whl (755.1 MB)` / `Using cached <pkg>` lines; the provisioner parses those sizes, keeps a running `announced` total and a `completed` received count, and feeds a `ProgressTracker` identical in shape to `downloader.rs:78-155` so percent and bytes are clamped to their high-water marks and throttled to 100 ms. When pip emits nothing parseable (a cache hit with no output, or a resolver-only pass) `total` stays `None`: events carry `total: 0` and `percent: 0`, and the UI shows an indeterminate bar with the phase label. That is honest — the spec requires bytes to be reported when the total is unknown, and it does not require inventing a percentage.

`uv pip install` is used instead when a `uv` binary is on the augmented PATH, because it is much faster for a torch-sized dependency set and prints machine-readable progress. It targets the same venv (`uv pip install --python <venv python>`), so the two paths are interchangeable. This is a speed optimisation behind the same interface, not a separate code path in the UI.

**Alternative considered — run `pip download` ourselves and reuse `hf/downloader.rs` byte-for-byte.** This would give real SHA-256 verification and the existing retry/`Range`-resume machinery for free. Rejected because it requires us to resolve the transitive dependency closure ourselves (pip's job), and a hand-maintained requirements pin list would rot. The security argument that pinned hashes exist for the sherpa ONNX path (`ensure_sherpa_hash_pinned`, `manager.rs:958`) is about feeding unverified weights to a native parser; a pip install from PyPI over TLS is a different trust model, and the verification step below covers the case that actually matters — that the thing we just built works.

### Install is a single `tokio::spawn`-ed task guarded by the HF dedup pattern

`PocketTTSState` gains an install slot holding a `CancellationToken` plus the current phase, and a `try_register`-style guard whose `Drop` unregisters — copied from `models/hf/commands.rs:29-108`. A second `pocket_tts_install` returns "an install is already running" rather than starting a second pip against the same venv. The command returns as soon as the guard is taken; the work runs detached and reports through events, so a long torch download does not hold an IPC call open.

`PocketTTSState.available`, currently written once and never updated (line 84, read at line 292), stops being a cache and becomes the phase slot. The existing `current_process` field is dead — `stop_pocket_tts` (line 291) only nulls it and the comment concedes the process is not killed — so it is replaced rather than kept alongside.

**Why events and not a resolved command.** The alternative is awaiting the install inside `pocket_tts_install` and returning the result, which is simpler and needs no event wiring. Rejected because a torch download can run for many minutes; a long-held IPC response is fragile against webview reloads and gives the UI nothing to render. The HF store's module-scope `listen` registration is the proven shape and is copied.

### Status returns a structural state and a source; it never fails

`PocketTTSStatus` becomes:

```rust
pub struct PocketTTSStatus {
    pub state: PocketTTSState,        // NotInstalled | Installing | Installed | Broken | Failed
    pub source: Option<PocketTTSSource>, // Provisioned | Bundled | System
    pub executable: Option<String>,   // absolute path actually used
    pub detail: Option<String>,       // executable's own stderr when Broken
    pub error: Option<String>,        // actionable, human-readable
}
```

`check_pocket_tts_available` stops using `?` on `spawn()` (line 118) and returns `Ok(status)` on every path, matching the shape at lines 159-165. `check_pocket_tts_available` is also split into a pure `resolve_pocket_tts_executable(app) -> Result<ResolvedExecutable, ResolutionFailure>` that does the path/argument work and a thin async wrapper that spawns the probe, so the resolution table is unit-testable without a `Tauri` app — the same split the HF module uses for `manager::install` vs. the command.

**Resolution order:** provisioned venv (`<app_data>/pocket-tts/<triple>/.venv/bin/pocket-tts`, or `Scripts\pocket-tts.exe`) → bundled runtime (`resource_dir/pocket-tts-runtime/<triple>`, then the dev-relative `src-tauri/bin/…` and `../src-tauri/bin/…` candidates copied from `notebooklm_runtime_base_candidates`, `notebooklm.rs:2855-2890`) → `PATH` (`~/.local/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`). Each candidate is confirmed by running `--help` and checking exit code 0; a candidate that exists but fails the probe yields `Broken` with the failing path, and resolution continues to the next tier so a broken provisioned copy does not shadow a working system one.

**Why resolve in Rust rather than keep the shell wrapper as the resolver.** The wrapper already does a version of this search, but it cannot report *which* tier it picked, cannot distinguish "not found" from "found and broken", and its stderr is the only channel — which is why `pocket_tts.rs:140-142` matches three hardcoded substrings to guess at the cause. Resolving in Rust makes `source` a real value and lets the error message name the path. The wrapper stays as the last-resort launcher for the packaged-app case where the executable is expected to be a sibling of the binary, and it is left otherwise untouched.

### Errors carry the executable path and a recovery step

`spawn()` failures become `anyhow!("Could not start Pocket TTS at {path}: {io_err}. Reinstall from Settings → Text to Speech, or install it with `uv tool install pocket-tts`.")`. A wrapper that starts and exits non-zero keeps its stderr (`Pocket TTS synthesis failed: <stderr>` at line 260) and gains the same recovery sentence. The UI's `pocketStatus.error.includes("not installed")` test (`TTSSettings.tsx:1168`) is deleted — the panel now branches on `state`.

**Why keep the recovery sentence in the string rather than an error code enum.** The Rust side already returns `Result<T, String>` for all four Pocket TTS commands (lines 310, 322, 331, 339) and the HF module does the same via `PlethoraError::Internal(e.to_string())`. Introducing a typed error enum for one module is not worth the churn; the *state* field is structured, and the message stays prose.

### The disk gate reuses `volume_space` against a declared install size

`volume_space` (`models/hf/system_info.rs:245`) is widened from `pub(crate)` to `pub` and called with the Pocket TTS install directory. The required size is a named constant, `POCKET_TTS_INSTALL_REQUIRED_BYTES`, set to 3 GiB — comfortably above the measured CPU-only install (torch CPU wheel ~200 MB, `pocket-tts`, `mimi`, tokenizers, a few hundred MB of numpy/scipy) and below the 4.7 GB the unpinned GPU resolution pulls. It is a constant rather than a computed estimate because a computed estimate would need the resolved wheel set, which is pip's answer, not ours; over-estimating is the safe direction for a gate. When `volume_space` returns `None` the install proceeds, matching `disk_insufficient`'s behaviour.

### The pre-existing `--text-file` workaround is kept and becomes explicit

`generate_pocket_speech` already writes the text to a temp file and passes `--text-file` (lines 191-195) precisely to stay under `ARG_MAX`, and the wrapper translates it back to `--text` (wrapper lines 3-32). The spec's "text longer than the argument limit" requirement is satisfied by keeping this, with a comment recording that the temp file is what makes it work — and the leak fixed: on the `!success` path (line 259) the temp file is only removed inside the `Terminated` arm, so a spawn failure leaves it on disk forever. Removal moves to a scope guard so every exit path cleans up.

## Risks / Trade-offs

**[A machine with no Python cannot install anything]** → The gate message names the requirement explicitly ("Python 3.10+ is required; install it and retry") instead of failing with an ENOENT on `python3`. This is the main functional gap versus the tarball approach and is the reason that approach stays on the table as a follow-up.

**[pip resolution changes upstream break the install]** → `pocket-tts` is installed unpinned, so a bad upstream release surfaces as an install failure with pip's own stderr, not as a silently broken runtime — the verify step runs `--help` after install and fails the install if it does not load. Rolling back means removing the venv (`pocket_tts_uninstall`) and reinstalling; the verify step is what keeps a bad wheel from being reported as success.

**[A torch download exceeds the 3 GiB gate estimate]** → The gate refuses to start rather than filling the disk, which is the correct failure direction. If real CPU-only installs routinely exceed the constant it trips, the fix is raising the constant, not removing the gate.

**[Install leaves a partially written venv that a later status check reports as broken]** → Install removes the venv directory on every failure path before emitting the terminal event, and the resolver's "candidate exists but fails probe" result maps to `Broken` with the path, so a leftover is visible and removable rather than silent.

**[Progress percentages are approximate for pip]** → `ProgressTracker`'s high-water clamp means a retry or a late-discovered dependency cannot make the bar go backwards, and the UI shows an indeterminate bar whenever `total` is `0`. The alternative — reporting a fake determinate percentage — is what the current hardcoded `50` does and is what the spec forbids.

**[Detached install outlives the webview]** → The guard unregisters on `Drop`, so a cancelled or panicking install cannot wedge the "already running" gate. If the app exits mid-install the venv is partial; the next status check reports `Broken` or `NotInstalled` and the UI offers a retry.

**[Two provisioning paths (`uv` and `pip`) drift]** → Both target the same venv with the same index arguments, and the `uv` path is a drop-in substitution behind one function. The verify step is the shared gate: if `uv` produced a venv that does not load, install fails the same way it would for `pip`.

**[`env_clear` divergence between install and synthesis]** → Install keeps `HOME`/`PATH`/proxy and strips only `LD_PRELOAD`/`LD_LIBRARY_PATH`; synthesis keeps the existing full clear. Two different environments for the same CLI is a real inconsistency, documented in comments at both sites, with the verify step exercising the *synthesis* environment so a runtime that only works under the install environment is caught.

## Migration Plan

No data migration. The provisioned runtime lives in a fresh directory under the app data dir, so nothing existing is touched and a rollback is `pocket_tts_uninstall` (or deleting the directory).

`pocket_tts_status` changes shape: `available`/`downloading`/`download_progress` are replaced by `state`/`source`/`executable`/`detail`. The only caller is `checkPocketTTSAvailable` in `src/api/pocketTts.ts:42` and the settings panel, both updated in the same change, so there is no window where the frontend reads a field the backend stopped sending.

Rollback: revert the change. A user who already installed a provisioned runtime keeps it on disk; after rollback the old resolver finds nothing at that path and falls back to the bundled/`PATH` tiers exactly as today.

## Open Questions

- Should the `Bundled` resolution tier be repaired in this change (add `bin/pocket-tts-runtime` to `bundle.resources` in `tauri.conf.json`, `tauri.linux.conf.json`, `tauri.macos.conf.json`) or left to a packaging follow-up? It does not change the specs — the resolver's tier order and the `Bundled` source value are fixed either way — and it does not change the task breakdown beyond one config line. Default: leave it out, since a 5.7 GB unstripped runtime in the installer is a separate decision, and record the missing declaration in the follow-up.
- Should `pocket-tts` be pinned to a floor version (e.g. `pocket-tts>=0.1`) rather than fully unpinned? A floor costs nothing and guards against resolving to a hypothetical 0.0.x. It does not change the specs, the approach, or the task count — it is one argument. Default: install unpinned and add the floor only if a 0.0.x is ever observed on PyPI.
