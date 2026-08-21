# Design: Supertonic 3 as a first-class cross-platform local TTS model

## 0. Verified upstream facts (researched, not assumed)

All names below were verified against the sherpa-onnx repository and the canonical HF
model repo during proposal research.

### sherpa-onnx version requirements

| Fact | Value | Consequence |
|---|---|---|
| Supertonic TTS support added upstream | **v1.12.29** (absent in v1.12.28) | Desktop sidecar pin `v1.12.24` (`scripts/download-sidecars.js:110`) MUST be bumped |
| Supertonic text-frontend diacritics fix | **v1.13.5** (PR #3750) | Target **v1.13.6** (current stable) or ≥ v1.13.5 |
| Android AAR pinned by plugin | `com.github.k2-fsa:sherpa-onnx:1.13.4` (`plugins/plethora-android-tts/android/build.gradle.kts:57`) | Already contains Supertonic; bump to 1.13.5+ optional but recommended |
| Release tarballs consumed by Plethora | `*-osx-{arm64,x86_64}-jni.tar.bz2`, `*-linux-x64-shared.tar.bz2`, `*-linux-aarch64-shared-cpu.tar.bz2`, `*-win-x64-shared-MD-Release.tar.bz2` | All ship TTS-enabled builds: `bin/sherpa-onnx-offline-tts` **and** the C-API shared libraries (`libsherpa-onnx-c-api.*`) alongside `bin/sherpa-onnx-offline`. The linux workflow has a `-no-tts` variant; the asset Plethora consumes is the with-tts one. |

### sherpa-onnx Supertonic configuration surface (verified)

C++ (`sherpa-onnx/csrc/offline-tts-supertonic-model-config.h`, since v1.12.29):

```cpp
struct OfflineTtsSupertonicModelConfig {
  std::string duration_predictor;   // duration_predictor.int8.onnx
  std::string text_encoder;         // text_encoder.int8.onnx
  std::string vector_estimator;     // vector_estimator.int8.onnx
  std::string vocoder;              // vocoder.int8.onnx
  std::string tts_json;             // tts.json
  std::string unicode_indexer;      // unicode_indexer.bin
  std::string voice_style;          // voice.bin
};
```

`Validate()` requires **all seven** paths to be non-empty and existing — there is no
partial Supertonic configuration. CLI flags (registered verbatim):
`--supertonic-duration-predictor`, `--supertonic-text-encoder`,
`--supertonic-vector-estimator`, `--supertonic-vocoder`, `--supertonic-tts-json`,
`--supertonic-unicode-indexer`, `--supertonic-voice-style` ("use sid
0..NumSpeakers()-1 to select").

C API (c-api.h, verified):

```c
typedef struct SherpaOnnxOfflineTtsSupertonicModelConfig {   // all const char*
  const char *duration_predictor; const char *text_encoder;
  const char *vector_estimator;   const char *vocoder;
  const char *tts_json;           const char *unicode_indexer;
  const char *voice_style;
} SherpaOnnxOfflineTtsSupertonicModelConfig;
// embedded as `.supertonic` in SherpaOnnxOfflineTtsModelConfig

typedef struct SherpaOnnxGenerationConfig {                  // generation-time
  float silence_scale; float speed; int32_t sid;
  const float *reference_audio; int32_t reference_audio_len;
  int32_t reference_sample_rate; const char *reference_text;
  int32_t num_steps; const char *extra;
} SherpaOnnxGenerationConfig;

const SherpaOnnxOfflineTts *SherpaOnnxCreateOfflineTts(const SherpaOnnxOfflineTtsConfig*);
void   SherpaOnnxDestroyOfflineTts(const SherpaOnnxOfflineTts*);
int32_t SherpaOnnxOfflineTtsSampleRate(const SherpaOnnxOfflineTts*);
int32_t SherpaOnnxOfflineTtsNumSpeakers(const SherpaOnnxOfflineTts*);
const SherpaOnnxGeneratedAudio *SherpaOnnxOfflineTtsGenerateWithConfig(
    const SherpaOnnxOfflineTts*, const char *text,
    const SherpaOnnxGenerationConfig*,
    SherpaOnnxGeneratedAudioProgressCallbackWithArg, void *arg);
// callback: int32_t(const float *samples, int32_t n, float progress, void *arg)
//   return 1 = continue, 0 = stop early  -> this is the cancellation mechanism
void SherpaOnnxDestroyOfflineTtsGeneratedAudio(const SherpaOnnxGeneratedAudio*);
// SherpaOnnxGeneratedAudio { const float *samples; int32_t n; int32_t sample_rate; }
```

Kotlin (verified present in AAR 1.13.4, `com.k2fsa.sherpa.onnx`):

```kotlin
data class OfflineTtsSupertonicModelConfig(
  var durationPredictor: String = "", var textEncoder: String = "",
  var vectorEstimator: String = "",  var vocoder: String = "",
  var ttsJson: String = "",          var unicodeIndexer: String = "",
  var voiceStyle: String = "")
// set as `supertonic = ...` on OfflineTtsModelConfig; synthesis unchanged:
// OfflineTts.generateWithCallback(text, sid, speed) { samples -> Int }
// OfflineTts.sampleRate(), OfflineTts.numSpeakers()
```

### Canonical model repo (verified via HF API)

`csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11`, public, not gated,
`sha = cca5a0e…`, `usedStorage = 145,287,515` bytes (~145 MB):

| File | Role | Required? |
|---|---|---|
| `duration_predictor.int8.onnx` | duration prediction | **required** |
| `text_encoder.int8.onnx` | text encoding | **required** |
| `vector_estimator.int8.onnx` | flow-matching vector field | **required** |
| `vocoder.int8.onnx` | latent → waveform | **required** |
| `tts.json` | architecture/runtime config (`ae.sample_rate` = **44100**) | **required** |
| `unicode_indexer.bin` | raw int32 text→id table | **required** |
| `voice.bin` | voice/style vectors (sid-indexed) | **required** |
| `LICENSE`, `README.md`, `.gitattributes` | metadata | optional |

The upstream `Supertone/supertonic-3` repo is **fp32 ONNX under `onnx/`** with
`unicode_indexer.json` and `voice_styles/*.json` — a different layout sherpa cannot
load. It stays blocked; detection targets the sherpa export layout.

Voice handling: sherpa exposes `NumSpeakers()`; `voice.bin` holds style rows indexed by
`sid`. The canonical repo is expected to report a small speaker count (likely 1);
`numSpeakers()` is read at engine-load time and drives the voice roster rather than any
hardcoded list. Custom/user-supplied style vectors are **not** in v1 scope, but nothing
in the metadata design prevents adding more `voice.bin`-style assets later.

## 1. Design decisions

### D1. Keep `HfRuntime::SherpaOnnxTts`; add `SherpaTtsFamily` (not a new runtime)

Supertonic is executed by sherpa-onnx; a new top-level runtime would fork the manager,
installer, and UI for no benefit. The existing `SherpaSttFamily` precedent
(`adapters.rs:50–61`) shows the pattern: a family enum beneath the runtime that selects
engine configuration. We mirror it for TTS:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SherpaTtsFamily {
    /// model.onnx + tokens.txt (+ optional lexicon/data-dir). Existing behavior.
    Vits,
    /// Kokoro-82M: model.onnx + tokens.txt + voices.bin.
    Kokoro,
    /// KittenTTS: model.onnx + tokens.txt + voices.bin.
    Kitten,
    /// Supertonic 3 multi-model pipeline (4 ONNX + tts.json + indexer + voice).
    Supertonic,
}
```

### D2. Reshape `RunContract::SherpaTts` around the family, backward-compatibly

The current variant cannot represent a 7-file pipeline. New shape:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum RunContract {
    Whisper { model_file: String },
    SherpaStt { /* unchanged */ },
    SherpaTts {
        #[serde(default)]
        family: Option<SherpaTtsFamily>,          // None = legacy row, infer on read
        /// Family-primary model file (model.onnx for Vits/Kokoro/Kitten;
        /// duration_predictor*.onnx for Supertonic — anchors containment checks).
        model_file: String,
        #[serde(default)] tokens_file: Option<String>,   // Vits/Kokoro/Kitten
        #[serde(default)] voices_file: Option<String>,   // Kokoro/Kitten
        /// Supertonic pipeline files (repo-relative), all required at run time.
        #[serde(default)] text_encoder_file: Option<String>,
        #[serde(default)] vector_estimator_file: Option<String>,
        #[serde(default)] vocoder_file: Option<String>,
        #[serde(default)] tts_json_file: Option<String>,
        #[serde(default)] unicode_indexer_file: Option<String>,
        #[serde(default)] voice_bin_file: Option<String>,
        /// Optional espeak-ng-data dir (Vits/Kokoro/Kitten), empty = none.
        #[serde(default)] data_dir: Option<String>,
    },
}
```

Rationale:

- **One variant, not per-family variants.** The engine-facing difference is "which
  config struct to fill"; per-family variants would triplicate install/verify/uninstall
  code that is family-agnostic (it just walks `artifact_files`).
- **`Option` fields with `#[serde(default)]`** mean every existing serialized
  `{"type":"sherpa-tts","model_file":...}` row continues to deserialize.
- **Legacy inference:** `family: None` + `voices_file: Some` → `Kokoro` (existing
  installed Kokoro rows), else `Vits`. Inference happens in one place
  (`RunContract::effective_tts_family()`), never mutates the DB lazily, and a write-back
  migration is optional (see D12).
- The TypeScript mirror in `src/api/hfModels.ts` gains the same optional fields;
  `family?: "vits" | "kokoro" | "kitten" | "supertonic"`.

A `validate()` on the contract (family ↔ required files consistent) runs at detection
time and again before engine use, so a half-filled contract is unusable rather than
misleading.

### D3. Detection: exact Supertonic layout, conservative

Extend `SherpaOnnxTtsAdapter::detect_artifact` (`adapters.rs:452–518`). Order matters —
Supertonic is checked **before** the generic VITS/Kokoro path:

1. Repo is TTS-ish (existing `is_tts_repo_name` / `text-to-speech` tag check).
2. **Supertonic attempt:** for each precision suffix in `[".int8", ".fp16", ""]`
   (prefer `.int8`), require **all seven** files:
   `duration_predictor{suffix}.onnx`, `text_encoder{suffix}.onnx`,
   `vector_estimator{suffix}.onnx`, `vocoder{suffix}.onnx`, `tts.json`,
   `unicode_indexer.bin`, `voice.bin`. All four ONNX files must share the **same**
   suffix (mixed-precision sets are rejected, not guessed). Any miss → not Supertonic.
3. Fall through to the existing VITS/Kokoro logic for `model.onnx`-style repos.

Properties:

- `kind: "supertonic"`, `label: "Supertonic 3 (sherpa-onnx TTS)"`,
  `confidence: Exact` (the layout itself is exact; no name heuristics needed).
- Precision is surfaced in artifact metadata (`"int8"`) for the UI.
- Memory estimate: `download_size × 1.15` (same factor as sherpa STT; INT8 weights +
  activation headroom at 44.1 kHz).
- False-positive resistance: `tts.json` + `unicode_indexer.bin` + `voice.bin` are
  unusual enough that arbitrary multi-ONNX repos (e.g. split ASR encoder/decoder sets)
  do not match; tests pin this.
- `ensure_sherpa_hash_pinned` already refuses sherpa installs without published
  SHA-256s — Supertonic inherits it unchanged (all 7 files are LFS objects with oids).
- The upstream `Supertone/supertonic-3` layout matches nothing and keeps producing the
  existing unsupported-runtime error.

### D4. Installation: reuse the pipeline wholesale

`manager.rs::install` already: re-inspects at install time, builds `DownloadSpec`s from
`artifact.files` (any count), enforces hash pinning, downloads atomically with
progress/cancel/retry, verifies on disk, and writes one registry row. Supertonic needs
**zero** new installer machinery — the artifact simply has 7 files instead of 1–3.

- Install dir: existing `<app_data>/models/tts/<owner>_<repo>[@<rev>]` (flat, matching
  the repo layout; `safe_dir_name` unchanged).
- Model ID: existing `hf:sherpa-onnx-tts:<repo>[@<rev>]` — unchanged, so the shared
  provider (D6) and settings sync need no new id scheme.
- Revision behavior: already revision-pinned by directory name + registry row. Upstream
  changes never touch an installed copy; re-installing a different revision creates a
  new row/dir (existing duplicate rule is repo+revision+runtime).
- `hf_client.rs::build_file_index` enriches candidates by extension/name; add the
  Supertonic file names to the enrichment list so sizes/SHAs resolve.

### D5. Desktop execution: in-process FFI to `libsherpa-onnx-c-api` (primary), CLI
sidecar (fallback)

**Chosen: dynamic in-process loading of the C API.** Reasons over alternatives:

- *Persistent engine*: reading flows synthesize sentence-after-sentence; a per-call CLI
  (`sherpa-onnx-offline-tts`) reloads the 145 MB model every invocation (~1–3 s per
  chunk — unacceptable for gapless playback). The C API keeps a session loaded.
- *Callback streaming + cancellation*: `GenerateWithConfig`'s callback returning 0
  aborts synthesis promptly — exactly what stop/skip needs.
- *No new packaging concept*: the shared libs are already inside the tarballs the build
  downloads today (macOS jni: `lib/libsherpa-onnx-c-api.dylib`; Linux shared:
  `lib/libsherpa-onnx-c-api.so`; Windows MD: `bin/sherpa-onnx-c-api.dll` — currently
  **deleted** by `copyOnnxRuntimeLibs` filtering; provisioning stops deleting it).
- *Symmetry with Android*: both platforms embed sherpa in-process (JNI vs C API) behind
  the same family/contract semantics.
- Rejected: `sherpa-rs`/`ort` crates (own version coupling, source builds, lag upstream);
  `onnxruntime-web` (explicitly ruled out); Python (ruled out).

**Mechanics** (new module `src-tauri/src/tts/`):

- `sherpa_ffi.rs` — `#[repr(C)]` struct definitions for the pinned sherpa version
  (config + generation config + generated audio) and `libloading`-based symbol
  resolution: `SherpaOnnxCreateOfflineTts`, `SherpaOnnxDestroyOfflineTts`,
  `SherpaOnnxOfflineTtsSampleRate`, `SherpaOnnxOfflineTtsNumSpeakers`,
  `SherpaOnnxOfflineTtsGenerateWithConfig`,
  `SherpaOnnxDestroyOfflineTtsGeneratedAudio`, `SherpaOnnxGetVersionStr`. No build-time
  link: the library is located next to the app (same discovery rules as the sidecars:
  `@executable_path`, `@executable_path/../Resources/bin`, `$ORIGIN`, DLL dirs), and a
  runtime guard requires `SherpaOnnxGetVersionStr()` major.minor to match the provisioned
  marker before any model load (the exe/ORT ABI-mismatch guard pattern, applied to FFI).
- `engine.rs` — `SherpaTtsSession`: load(model_dir, contract) → validates files,
  builds `SherpaOnnxOfflineTtsSupertonicModelConfig` (absolute paths), creates the
  engine on a dedicated synthesis thread (commands funnel through a channel; onnxruntime
  sessions are never touched from the UI thread), exposes
  `synthesize(text, sid, speed, cancel) -> Wav` and `unload()`. The generation callback
  checks an `AtomicBool` cancel flag each chunk (return 0 → prompt abort) and discards
  incremental samples (v1 buffers the completed utterance; see D8). `num_threads = 2`
  (matches Android's thermal cap), `provider = "cpu"`.
- `commands.rs` — Tauri commands: `sherpa_tts_status`, `sherpa_tts_synthesize`
  (model_id, text, sid, speed → base64 WAV + sample_rate + duration), 
  `sherpa_tts_cancel`, `sherpa_tts_unload`. Mirrors `pocket_tts.rs` shape so the
  frontend adapter is familiar.
- WAV encoding: 16-bit PCM mono at the engine's reported sample rate (44100 for
  Supertonic) via the existing `hound`-style header writing used by transcription
  chunking (`transcription/engine.rs` already writes WAV windows).

**Fallback (explicit decision path):** if the spike (tasks.md T1) fails on any platform —
most plausibly Windows DLL isolation — fall back to provisioning
`bin/sherpa-onnx-offline-tts-<triple>` from the same tarballs and invoking it per
sentence **batch** (current + prefetched sentences in one process run, one WAV,
sentence boundaries approximated by chunking the input before the call). This keeps the
feature shippable at the cost of higher per-chunk latency; the provider surface,
detection, and installation are unaffected because the engine sits behind the same
`SherpaTtsSession` trait boundary. The spike decides; the rest of the plan is identical.

### D6. Android execution: extend the existing plugin; consume HF installs in place

- `TtsModelKind` gains `SUPERTONIC("supertonic")` (`TtsModelRegistry.kt`).
- `SherpaTtsEngine.load` gains the Supertonic branch: resolve the seven files under the
  model dir (flat layout, same `findFile` helpers), fill
  `OfflineTtsSupertonicModelConfig`, leave `dataDir` empty (Supertonic needs none).
  `numSpeakers()`/`sampleRate()` work unchanged.
- **Shared storage contract — no duplicated weights.** The plugin already receives a
  `modelDir: File`. New: when the requested model id starts with `hf:`, the Rust shim
  resolves it through the HF registry (`resolve_installed_path`-style helper returning
  `{ install_dir, run_contract }`) and passes **that directory** plus the contract to
  Kotlin via the existing `load` path. The HF-installed copy under
  `<app_data>/models/tts/…` is the only copy on the device. The plugin's own
  `TtsAssetManager` continues to own only the pinned Kitten/Kokoro tarballs.
- `AndroidTtsPlugin.speak` accepts `modelId = "hf:sherpa-onnx-tts:<repo>[@<rev]>"`;
  unknown/uninstalled HF ids fail gracefully into the existing `SystemTtsFallback`
  path (consistent with current failure behavior).
- Sentence queue, prefetch, AudioTrack streaming, audio focus, pause/stop, media
  session, and `sentence-position` events are **already implemented generically** over
  the engine — Supertonic rides them for free.
- Existing Kitten/Kokoro paths are untouched; the plugin's pinned catalogs remain the
  default quick-start models.

### D7. One provider: `supertonic` (shared across platforms)

- `TTSProviderId`/`TTS_PROVIDER_IDS` gain `"supertonic"`; `TTS_PROVIDER_KIND = "local"`;
  `auth: { mode: "none" }`; `capabilities: { supportsSpeed: true, supportsWordTimings:
  false, audioFormats: ["wav"], … }`.
- `listModels()` = installed HF models where `runtime === "sherpa-onnx-tts"` and
  contract family `supertonic`, mapped to `TTSModelInfo` (id = the shared HF model id,
  name from repo, description with size/precision). Not installed → the model is listed
  with a "download required" state pointing at the HF manager rather than silently
  failing.
- `listVoices()` = contract/metadata voice roster (from `numSpeakers()` reported at
  install/inspect time and stored in artifact metadata; default `0`-based ids, names
  "Voice N"). v1 ships the packaged style set only.
- `synthesize()`: desktop → `sherpa_tts_synthesize` (returns WAV data URL, same shape
  Pocket returns); Android → delegate to the existing native-event path. The adapter
  branches on `isNativeMobile()` internally — **one** provider id, one settings entry,
  one voice picker. `useTTS` routes `provider === "supertonic"` on mobile through
  `useNativeAndroidTTS` exactly as it does for `"android"` (the hook is already
  model-id agnostic; it passes `config.modelId` through to `pluginSpeak`).
- Settings: `providers.supertonic = defaultProviderSettings({ modelId: "",
  voiceId: "0" })` — `modelId` holds the HF model id. Selection persists in the
  existing tts settings (and syncs only if the current settings-sync scope includes tts
  settings — unchanged behavior). Installation state is always device-local; a synced
  selection for a model missing on this device renders "Download required", never an
  error or a silent cloud fallback.

### D8. Playback, latency, and timing semantics

- **Chunking/prefetch**: unchanged. `ReaderTTSControls` already buffers ahead
  (`EVICT_BEHIND_COUNT`, look-ahead generation) for generated-audio providers; the
  desktop engine's per-sentence latency (persistent session ⇒ synthesis only) fits the
  existing pipeline. First-chunk latency: synthesize the first sentence before playback
  starts (already the pipeline's behavior); no whole-document pre-generation.
- **Android**: the plugin already prefetches sentence N+1 while N plays and streams
  callback PCM to `AudioTrack`. Supertonic inherits this verbatim.
- **Rate**: sherpa `speed` is a direct rate factor (1.0 = normal); map the reader rate
  straight through on both platforms (clamped to sherpa's sane range, e.g. 0.5–2.0).
- **Highlighting/progress**: sentence-level only. Supertonic/sherpa expose no word
  timings; the reader's existing proportional fallback (documented behavior for engines
  without alignments) applies. No fabricated timestamps.
- **Format**: raw PCM internally (callback/`GeneratedAudio`), wrapped to a WAV
  container only at the desktop IPC boundary (base64 data URL, same as Pocket). No
  MP3/Opus encode/decode hops.
- **Cancellation**: desktop — cancel flag → callback returns 0 → generation aborts,
  partial audio discarded; Android — existing stop path aborts via the same callback
  convention (`SherpaTtsEngine.synthesize` already propagates sink-false → 0).

### D9. Resource management

- One engine session per selected model; `unload()` on: provider/model switch, document
  change with provider switch, app quit, and (Android) the plugin's existing
  memory-pressure/lifecycle hooks. Reload is explicit on next use — no per-sentence
  re-init.
- Desktop synthesis runs on one dedicated worker thread; the engine handle is never
  shared across threads without the channel; `DestroyOfflineTts` releases all ONNX
  sessions; a drop guard guarantees destruction even on error paths.
- Memory regression guard: repeated synthesize/unload cycles asserted in a Rust test
  with a mocked engine; the gated real-model test asserts RSS growth stays bounded
  across 50+ short syntheses.
- Android: `numThreads = 2` (upstream thermal guidance, matches Kitten/Kokoro);
  existing foreground/background handling and audio-focus behavior unchanged.
- No orphaned `.part` files (existing downloader behavior) and no orphaned native
  sessions (drop guards + explicit unload commands).

### D10. Security, offline, and model versioning

- **Security model unchanged** (`models/hf/security.md`): repos are data; the seven
  files are fed to sherpa as inert ONNX/JSON/binary inputs; no repo code execution; no
  `trust_remote_code`; hash-pinned downloads; path-traversal-safe relative resolution
  (`sanitize_install_rel` + containment asserts already cover every contract field —
  each new file path goes through the same check); live re-inspection at install time.
- **Offline**: synthesis never touches the network. The desktop engine and Android
  plugin receive local paths only. No cloud fallback is introduced; failures surface in
  the existing error/last-error surfaces and respect the user's provider choice.
- **Versioning**: installs are revision-pinned (dir + row). Upstream repo changes never
  mutate an installed copy. A future schema change to the Supertonic export would simply
  fail detection for new revisions (old installed revisions keep working); a deliberate
  re-install is the update path. The sherpa **runtime** version is guarded by the
  existing provisioning marker + new FFI version check.

### D11. Packaging per platform (desktop FFI path)

| Platform | Libs shipped | Loading | Notes |
|---|---|---|---|
| Linux x86-64 | `libsherpa-onnx-c-api.so`, `libonnxruntime.so` (+ deps already shipped) | `$ORIGIN` rpath + existing `LD_LIBRARY_PATH` fallback in `set_sidecar_env!` pattern applied to the app process env at load time | AppImage/AppDir already carries the sidecar libs; same location reused |
| macOS arm64 / x86_64 | `libsherpa-onnx-c-api.dylib`, `libonnxruntime*.dylib` | `@executable_path` / `@executable_path/../Resources/bin` rpaths (build.rs already re-signs these libs with `codesign --force --sign -`) | Notarization: dylibs are signed ad-hoc today for sidecar use; hardened-runtime builds must sign with the app's team — reuse the existing whisper-lib signing step, extended to the c-api lib |
| Windows x86-64 | `sherpa-onnx-c-api.dll`, `onnxruntime.dll`, `onnxruntime_providers_shared.dll` | `AddDllDirectory`/`LOAD_WITH_ALTERED_SEARCH_PATH` equivalent via `libloading` with an absolute path; **never** rely on bare `PATH` (System32 `onnxruntime.dll` shadowing is a documented past incident) | `copyOnnxRuntimeLibs` stops deleting `sherpa-onnx-c-api.dll`; the NSIS resource-map lesson (only ship what's needed, keep the explicit resources map) is respected |
| Size impact | ~+8–12 MB installed (c-api lib; onnxruntime already shipped) | — | Bundle-budget check updated if the gate covers installers |

Android: no packaging change (AAR already bundles the JNI lib); optional AAR bump.

### D12. Migration and backward compatibility

1. **Serialized contracts**: `#[serde(default)]` on every new field; legacy
   `{"type":"sherpa-tts", …}` rows deserialize; family inferred on read (D2). Existing
   installed VITS/Kokoro models keep their rows, dirs, ids, and engine behavior.
2. **`registry_list` disk verification** is file-list driven (`artifact_files`) —
   unchanged by the contract reshape.
3. **TS mirror**: optional fields only; no breaking frontend type changes.
4. **Android DTOs**: `kind: "kitten" | "kokoro" | "supertonic"` — additive; old
   frontends never see `supertonic` unless a Supertonic model exists.
5. **Sidecar upgrade**: `SHERPA_ONNX_VERSION` bump re-provisions via the existing
   marker; STT flags are unchanged across v1.12.24 → v1.13.6 (verified flag names), but
   the STT regression suite re-runs (Parakeet/SenseVoice/Zipformer/Paraformer detection
   tests are pure-Rust and unaffected; a manual smoke transcription is in the
   acceptance matrix).
6. **Rollback safety**: the FFI engine is additive; if unavailable (`status.available
   === false`), the provider lists no models and the UI explains the runtime is missing
   — installed models remain installed and unharmed.

## 3. Risks and mitigations

| Risk | Mitigation |
|---|---|
| C-API struct ABI drift across sherpa versions | Pin + version-marker + runtime `SherpaOnnxGetVersionStr()` major.minor check before any load; structs defined for the pinned version only |
| Windows DLL search-path conflicts (onnxruntime shadowing) | Absolute-path `libloading` + explicit `AddDllDirectory`; spike task T1 verifies before commitment; CLI fallback if unsound |
| Supertonic synthesis speed on low-end Android | INT8 + 2 threads + sentence chunking; suitability labels honestly; no accelerators claimed |
| `numSpeakers()` semantics for `voice.bin` | Spike T2 verifies the canonical repo's roster; metadata carries the count; UI renders whatever the engine reports |
| 44.1 kHz output vs 24 kHz expectations elsewhere | Sample rate always read from the engine (`SherpaOnnxOfflineTtsSampleRate`) and carried in the WAV header / playback path — never assumed |
| Desktop bundle size / notarization regressions | Only the c-api lib is added (~8–12 MB); signing step extended; acceptance matrix includes signed-build smoke on macOS |
| sherpa upgrade breaks STT | Flag names unchanged (verified); STT regression tests + manual smoke in acceptance matrix |

## 4. Unresolved questions requiring the spikes (T1/T2/T3)

- T1: exact `libloading` behavior per OS with the shipped libs (incl. Windows DLL dir
  isolation and macOS hardened-runtime signing) — decides FFI vs CLI fallback.
- T2: canonical repo `numSpeakers()` value, `speed` range behavior, and whether
  `max_num_sentences`/`silence_scale` need Supertonic-specific tuning for long
  paragraphs.
- T3 (small): confirm JitPack `1.13.5+` AAR availability before the optional Android
  bump; stay on 1.13.4 if not.
