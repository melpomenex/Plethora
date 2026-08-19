# Security model: Hugging Face speech-model manager

This document is the security model for requirement **#19** (installing
compatible Hugging Face TTS/STT models with hardware-suitability analysis). It
is enforced by the implementation in `src-tauri/src/models/hf/`.

## Threat model

Downloaded Hugging Face repositories are **untrusted data**. A model repo
could be malicious, compromised, or simply malformed. The manager's job is to
install *weights* and *tokens files* that are then executed only by Plethora's
own, vetted speech runtimes (the `whisper` and `sherpa-onnx` sidecars).

The model card, file listing, and any file bytes are attacker-controlled
input. We never execute code from a repo, and we never let a repo influence
which code runs or with what privileges.

## Principles

1. **No arbitrary repository code execution.** Nothing in the install path
   runs scripts, `trust_remote_code`-style Python, model cards, ONNX custom
   ops from the repo, or anything else from the download. Only the model
   weights/tokens are downloaded; only the known `whisper` / `sherpa-onnx`
   sidecar binaries (bundled by Plethora, not the repo) ever execute.

2. **Conservative artifact detection.** A repo is only installable when a
   supported artifact is detected by an explicit runtime adapter (ggml
   `.bin` for whisper.cpp; ONNX + tokens for sherpa-onnx). A repo tagged
   TTS/STT that matches no supported artifact is reported `unsupported_runtime`
   and installation is blocked — we never "try" arbitrary repos. Heuristic
   matches are labeled as estimates in the UI and the user must confirm.

3. **Fail-closed integrity.** Every artifact file is verified against its
   SHA-256 when the repo exposes one (via LFS metadata). A mismatch deletes the
   partial download and does **not** register the model. Downloads without a
   known hash are still written atomically (`.part` → rename) so a partial or
   interrupted file can never masquerade as an installed model.

4. **Atomic installs + partial cleanup.** Files stream to a `.part` sibling
   and are renamed into place only after verification. Cancellation or failure
   removes the partial file and leaves no "half installed" state; the registry
   row is written only after every artifact file verifies.

5. **Sidecar isolation preserved.** Any runtime is spawned through the
   existing `tauri-plugin-shell` `.sidecar()` mechanism with the established
   `env_clear()` / whitelisted-env pattern (see `src-tauri/src/utils/` and the
   transcription engine). The manager itself never spawns processes; it only
   writes files and delegates execution to the existing engine code paths.

6. **No silent `trust_remote_code`.** There is no code-execution flag anywhere
   in this feature. If a future runtime genuinely requires executing
   untrusted/custom code to run a model, the user must be explicitly informed
   and must explicitly consent — it will never be enabled silently, and the
   default is to refuse.

7. **Path containment.** Uninstall refuses to delete directories outside the
   managed `<app_data>/models` tree, so a tampered registry row cannot be used
   to delete arbitrary user files. Install directories are sanitized
   (`safe_dir_name`) so a repo id can never escape the models tree via `..`.

8. **Only public repos.** Inspection rejects private repositories; no auth
   tokens are ever sent or stored by this feature.

9. **Privacy.** System-info detection gathers only what suitability needs (OS,
   arch, cores, RAM, GPU/VRAM, disk free space). It never collects hostnames,
   MAC addresses, serials, or other identifying data.

## What the user is told

- Installed models appear in the STT picker / TTS surface and are re-verified
  on disk after restart.
- The license from the HF card is shown with a note that downloading does not
  grant usage rights.
- Suitability is always presented with an explanation and labeled estimates;
  no performance is promised.
