## Why

The "Download" button in TTS settings does not download anything. `handleDownloadPocketTTS` (`src/components/settings/TTSSettings.tsx:836-871`) calls `generatePocketSpeech({ text: "Download complete." })` to "force a model download", which invokes the `pocket_tts_generate` Tauri command. On any machine where the sidecar cannot spawn, that command fails with the bare string `No such file or directory (os error 2)` — the raw `std::io::Error` from `Command::spawn()` propagated unwrapped through `src-tauri/src/pocket_tts.rs:237`. The user clicked Download and got an OS errno with no install path.

The underlying problem is that Pocket TTS has no installer at all. There is no `pocket_tts_download` command on any layer; the `downloading` and `download_progress` fields in `PocketTTSStatus` are hardcoded to `false`/`None` at both construction sites (`pocket_tts.rs:152-164`); and the progress bar is driven by a hardcoded `50` then `100`. The sidecar launchers in `src-tauri/bin/pocket-tts-*` are finders, not installers — they look for a bundled portable Python runtime, then `~/.local/bin`, then `PATH`, and give up with instructions to run `uv tool install pocket-tts` by hand. The bundled runtime is built only when `POCKET_TTS_BUNDLE_RUNTIME=1` (set in CI, never locally) and is not even declared in `bundle.resources`, so released bundles ship a launcher whose runtime is absent.

## What Changes

- Add a real `pocket_tts_install` Rust command that provisions a Pocket TTS runtime into the app's data directory: it creates an isolated virtual environment, installs `pocket-tts` into it from PyPI, and verifies the result by executing the provisioned CLI. Install is a single serialized operation guarded against concurrent invocation.
- Stream real installation progress to the frontend as `pocket-tts://install-progress` events (phase, bytes, percent) and a terminal `pocket-tts://install-finished` event, following the `hf://install-progress` / `hf://install-finished` pattern already used by the Hugging Face model manager.
- Add `pocket_tts_cancel_install` and `pocket_tts_uninstall` so an install can be aborted and its partial state removed; `pocket_tts_uninstall` also backs a "Remove" control in settings.
- Resolve the Pocket TTS executable from the provisioned runtime first, then the bundled runtime, then `PATH`. The resolver reports *which* source it used, so a status call can distinguish "not installed" from "installed but broken".
- Replace the stub Download handler with a real one driven by the install events: a determinate progress bar during install, a Cancel button, and a Remove button once installed. The fabricated `50` → `100` progress is removed.
- Gate the install on a disk-space preflight that reuses the existing `detect_system_info` / `volume_space` free-space measurement, and show a readable shortfall message before any download starts.
- Wrap every sidecar spawn failure so the user sees an actionable message naming the executable path that was tried and the recovery step, instead of a raw OS errno. `pocket_tts_status` will no longer propagate a bare `Err` when the sidecar is missing — it returns a structured unavailable status.
- Preload the model weights as part of install (a single short synthesis after the runtime is provisioned) so the first real synthesis is not blocked on a multi-hundred-megabyte Hugging Face fetch, and surface that phase distinctly in the progress UI.
- Remove the dead `pocketAvailable` schema field that no UI reads, and drop the `error.includes("not installed")` string-matching in the settings panel in favour of a structured error code.

## Capabilities

### New Capabilities

- `pocket-tts-runtime-installation`: Covers provisioning a Pocket TTS runtime into app storage, install progress and cancellation events, uninstall, executable resolution across provisioned/bundled/PATH sources, disk-space preflight, the structured install state the settings panel branches off, and actionable error reporting when no runtime is present. The availability-reporting requirements land here rather than in a delta on `pocket-tts-availability` because that capability is still unarchived (it lives only in the unarchived `fix-pocket-tts-module-error` change), and a delta against a non-existent spec fails validation. When `fix-pocket-tts-module-error` is archived this change's availability requirements should be folded into it.

## Impact

- `src-tauri/src/pocket_tts.rs` — new `pocket_tts_install` / `pocket_tts_cancel_install` / `pocket_tts_uninstall` commands, an executable resolver, progress event emission, install state, and rewritten error construction.
- `src-tauri/src/lib.rs` — register the three new commands; manage the new install state.
- `src/api/pocketTts.ts` — TypeScript wrappers and types for the new commands plus the install-event payloads.
- `src/components/settings/TTSSettings.tsx` — replace `handleDownloadPocketTTS`, add event subscriptions, real progress/cancel/remove controls, and switch the status panel to a structured state.
- `src/utils/ttsSettings.ts`, `src/utils/settingsValidation.ts` — remove the unread `pocketAvailable` field.
- `src/lib/i18n/locales/{en,de,es,fr,ja,zh}.ts` — new strings for install phases, cancel, remove, and error recovery; removal of the now-unused `ttsSettings.download` / `ttsSettings.downloadingModel` keys.
- `src-tauri/Cargo.toml` — no new dependencies; the provisioner reuses `reqwest` (already present), `tauri-plugin-shell`, and the existing HF free-space helpers.
- Network: the install path reaches PyPI and, during the preload phase, the Hugging Face Hub. This is a one-time first-use cost; the provisioned runtime afterwards works offline. Users who already have `pocket-tts` on `PATH` are unaffected and the resolver prefers the provisioned copy only once it exists.
