# Change: Supertonic 3 as a first-class cross-platform local TTS model

Covers the follow-up to requirement **#19 (Hugging Face speech model manager)**: make a
supported Supertonic 3 Hugging Face repository installable **and actually runnable** on
Android, Linux, macOS (Apple Silicon), and Windows through the existing sherpa-onnx
infrastructure.

## Why

A user who pastes `Supertone/supertonic-3` (or the canonical sherpa export
`csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11`) into the Hugging Face TTS
model manager is told:

> "No artifact in this repository is runnable by any installed Plethora speech runtime.
> Installation is blocked."

Repo inspection works; the failure is in compatibility detection and, more deeply, in
execution. Three gaps must close before Supertonic is real:

### Current state discovered

- **Detection** (`src-tauri/src/models/hf/adapters.rs`): `SherpaOnnxTtsAdapter` only
  recognizes the VITS/Kokoro layout — `model.onnx`/`model.int8.onnx` + `tokens.txt` +
  optional `voices.bin`. Supertonic's sherpa export is a **7-file multi-model pipeline**
  (`duration_predictor.int8.onnx`, `text_encoder.int8.onnx`, `vector_estimator.int8.onnx`,
  `vocoder.int8.onnx`, `tts.json`, `unicode_indexer.bin`, `voice.bin`) and matches
  nothing. `RunContract::SherpaTts { model_file, tokens_file, voices_file }` cannot
  represent it.
- **Desktop execution**: there is **no desktop TTS path at all**. The bundled sherpa
  sidecar is `sherpa-onnx-offline` (STT only), pinned `v1.12.24`
  (`scripts/download-sidecars.js:110`) — a version that predates Supertonic support
  (added upstream in **v1.12.29**). `tts_runtime_note()` (`suitability.rs:281–291`)
  explicitly tells users installed TTS models are "registered and ready" but not
  synthesizable on desktop. The only desktop local TTS is Pocket TTS, whose sidecar
  requires a user-installed Python `uv` tool — explicitly not acceptable for Supertonic.
- **Android execution**: the `plethora-android-tts` plugin knows only
  `TtsModelKind.KITTEN|KOKORO` and consumes **pinned** GitHub-release tarballs via
  `TtsModelRegistry` (`TtsModelRegistry.kt`). HF-installed models in
  `<app_data>/models/tts/` are invisible to it. The pinned AAR (`com.github.k2-fsa:sherpa-onnx:1.13.4`)
  already contains the Kotlin `OfflineTtsSupertonicModelConfig`, so the native runtime is
  ready; only the model plumbing is missing.
- **Upstream facts verified**: sherpa-onnx Supertonic TTS support exists since v1.12.29
  (C++ `OfflineTtsSupertonicModelConfig`, C API
  `SherpaOnnxOfflineTtsSupertonicModelConfig`, Kotlin `OfflineTtsSupertonicModelConfig`,
  CLI flags `--supertonic-*`); all 7 files are mandatory in sherpa's `Validate()`;
  output sample rate is **44100 Hz** (`tts.json: ae.sample_rate`); synthesis supports
  sid-selected voice styles and callback streaming; v1.13.5 fixed dropped diacritics in
  the Supertonic text frontend; latest release is v1.13.6. The upstream
  `Supertone/supertonic-3` repo (fp32 ONNX under `onnx/`, `unicode_indexer.json`,
  `voice_styles/*.json`) is **not** sherpa-loadable, which is why the sherpa export repo
  is the canonical target.

## What Changes

- **Family-aware sherpa TTS contracts.** Introduce `SherpaTtsFamily` (`Vits`, `Kokoro`,
  `Kitten`, `Supertonic`) beneath the existing `HfRuntime::SherpaOnnxTts` runtime and
  reshape `RunContract::SherpaTts` to carry family-specific file sets (multi-file
  pipeline for Supertonic). Serde stays backward compatible: existing serialized rows
  deserialize and infer their family. No new top-level runtime is added.
- **Conservative Supertonic artifact detection.** The sherpa-onnx TTS adapter detects
  the exact 7-file Supertonic layout (consistent precision suffix across all four ONNX
  files, required `tts.json`/`unicode_indexer.bin`/`voice.bin`), computes size/memory,
  and produces an executable contract with `confidence: exact` for the canonical INT8
  repo. Incomplete, mixed-precision, or arbitrary multi-ONNX layouts are rejected; the
  upstream `Supertone/supertonic-3` layout remains correctly blocked.
- **Install/registry reuse, no parallel downloader.** The existing HF pipeline
  (inspection, revision pinning, resolved URLs, LFS SHA-256, `.part` atomicity,
  cancellation, progress, retries, disk preflight, hash-pinning gate, registry rows,
  uninstall) installs all 7 assets under the existing `<app_data>/models/tts/<id>`
  convention with unchanged model IDs. Works on desktop **and** Android (the Rust HF
  stack is platform-neutral).
- **Desktop native sherpa TTS engine.** New in-process Rust engine that dynamically
  loads the already-shipped `libsherpa-onnx-c-api` shared library (present in the
  tarballs the build already downloads for all three desktop OSes), configures
  `SherpaOnnxOfflineTtsSupertonicModelConfig`, and synthesizes with callback streaming,
  cancellation, and explicit load/unload lifecycle. No Python, no onnxruntime-web, no
  user-installed system packages. A time-boxed spike validates FFI/ABI/loading per OS
  before commitment, with the `sherpa-onnx-offline-tts` CLI sidecar as the documented
  fallback.
- **Controlled sherpa-onnx upgrade.** Bump `SHERPA_ONNX_VERSION` from v1.12.24 to a
  Supertonic-capable release (v1.13.5+ recommended; v1.13.6 current), keep the
  version-marker provisioning guard, and stop discarding the C-API shared libraries on
  Windows. Existing STT sidecar flags are unchanged; regression-test Parakeet /
  SenseVoice / Zipformer / Paraformer. Optionally bump the Android AAR 1.13.4 → 1.13.5+
  for the Supertonic text-frontend fix.
- **Android Supertonic via the existing plugin.** Add a `SUPERTONIC` kind to
  `TtsModelKind`, construct `OfflineTtsSupertonicModelConfig`, and let the plugin
  consume **HF-installed** model directories through a shared storage contract (resolve
  HF model id → install dir + contract) instead of duplicating weights into the plugin's
  own asset area. Kitten/Kokoro behavior is preserved.
- **One shared user-facing provider.** A single `supertonic` local TTS provider
  (desktop + Android) whose model picker lists installed HF Supertonic models by their
  shared `hf:sherpa-onnx-tts:<repo>[@rev]` ids. Selection is a synced-able preference;
  installation state stays device-local, and a missing local install surfaces a
  "download required" state. No "Android Supertonic" vs "Desktop Supertonic" split.
- **Playback integration through the existing surface.** Sentence chunking, prefetch,
  rate, pause/resume/stop, position persistence, and highlighting flow through
  `useTTS` / `ReaderTTSControls` unchanged. Android keeps native AudioTrack playback and
  sentence-position events; desktop synthesizes per sentence chunk on a persistent
  engine with look-ahead prefetch and plays via the existing audio pipeline. Word-level
  timestamps are not fabricated.
- **Settings / HF manager UX.** Inspection shows model family, precision, asset list,
  size, memory estimate, license, revision, and per-device suitability; the
  "desktop sidecar is STT-only" caveat is removed; installed Supertonic models appear as
  selectable TTS models; unsupported repos stay blocked.
- **Tests and acceptance.** Detection/serialization/installer/engine tests in Rust,
  plugin tests on Android, vitest suites for the manager/provider/settings, and a
  four-platform manual acceptance matrix.

## Capabilities

### New Capabilities
- `local-sherpa-tts`: Cross-platform local sherpa-onnx TTS execution — TTS model
  families, desktop native engine, Android plugin integration for HF-installed models,
  the shared `supertonic` provider surface, playback semantics, offline behavior,
  resource lifecycle, and platform capability gating.

### Modified Capabilities
- `hf-model-manager`: Adds Supertonic artifact detection with a family-aware
  `RunContract::SherpaTts` (backward-compatible), multi-asset Supertonic installation
  under the existing registry, TTS runtime availability/suitability reporting that no
  longer claims desktop TTS is impossible, and unchanged model-ID/install-dir
  conventions.

## Impact

### Affected Code Areas
- **Rust (HF stack)**: `src-tauri/src/models/hf/adapters.rs` (new `SherpaTtsFamily`,
  reshaped `RunContract::SherpaTts`, Supertonic detection), `manager.rs` (family-aware
  contract migration on read, unchanged install dirs/ids), `suitability.rs` (replace the
  STT-only note; CPU-first Supertonic classification), `hf_client.rs` (index candidates
  for the new file names).
- **Rust (new desktop engine)**: new `src-tauri/src/tts/` module (engine wrapper over
  `libsherpa-onnx-c-api`, session lifecycle, cancellation, Tauri commands), registration
  in `src-tauri/src/lib.rs`.
- **Build/packaging**: `scripts/download-sidecars.js` (version bump, provision C-API
  libs incl. Windows, keep `sherpa-onnx-offline` untouched), `src-tauri/tauri.conf.json`
  / `build.rs` (bundle/sign the shared libs), macOS signing/notarization, Linux rpath,
  Windows DLL search-path handling, installer size budget.
- **Android**: `src-tauri/plugins/plethora-android-tts/` — `TtsModelRegistry.kt`
  (`SUPERTONIC` kind + HF bridge types), `SherpaTtsEngine.kt` (Supertonic config),
  `AndroidTtsPlugin.kt` (HF-model speak path), Rust shim DTOs (kind serial
  `"supertonic"`), optional AAR bump.
- **Frontend**: `src/api/hfModels.ts` (contract mirror), `src/api/tts/types.ts` +
  `registry.ts` + new `providers/supertonic.ts`, `src/utils/ttsSettings.ts` (provider
  entry), `src/hooks/useTTS.ts` routing, `src/components/settings/TTSSettings.tsx`,
  `HuggingFaceModelManager.tsx`, `AndroidTtsModelManager.tsx` untouched behavior.
- **Dependencies**: sherpa-onnx desktop tarballs v1.12.24 → v1.13.5+ (adds ~10–25 MB
  installed footprint for the C-API libs; `sherpa-onnx-offline-tts` binary only if the
  fallback path is taken); Android AAR 1.13.4 → 1.13.5+ (optional). No new Rust crates
  beyond a dynamic-loading helper (e.g. `libloading`).

### Non-goals
- No `onnxruntime-web` / WebView WASM inference; Supertonic runs natively only.
- No support for the raw `Supertone/supertonic-3` fp32 layout (not sherpa-executable);
  it stays blocked with the existing unsupported-runtime error.
- No arbitrary multi-ONNX repo acceptance; the compatibility gate stays conservative.
- No voice cloning, no custom user-supplied style vectors in v1 (metadata designed so
  they can be added later).
- No GPU/NPU accelerators (CoreML/NNAPI/CUDA/DirectML) in the critical path — CPU-first.
- No word-level timestamp fabrication; sentence/chunk timing only.
- No silent cloud fallback when local synthesis fails; existing provider settings rule.
- No changes to Pocket TTS, Kokoro, KittenTTS, system/cloud TTS, or HF STT behavior.
