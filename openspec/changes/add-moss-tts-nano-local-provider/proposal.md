# Add on-device TTS for Android via sherpa-onnx (KittenTTS / Kokoro-82M)

> **Pivot note (2026-07-31).** This change originally proposed running MOSS-TTS-Nano
> through `onnxruntime-web` in the webview. The feasibility spike (group 1, now
> closed) measured real-time factors of **1.26–2.22** across an Apple M4 and a
> Pixel 9 Pro XL — i.e. the model generates audio **slower than it plays** on every
> device tested — and crashed at ~123 s of sustained synthesis with WASM
> `bad_alloc`. The full spike report is preserved in `design.md` §8. Rather than
> ship a local voice that stutters and crashes, the approach pivots to **native
> inference through a Kotlin Tauri plugin**, which sidesteps the WASM penalty the
> spike measured. The directory name (`add-moss-tts-nano-local-provider`) is
> retained for continuity; the shipped models are KittenTTS and Kokoro-82M, not
> MOSS.

## Why

Incrementum's only local TTS is Pocket TTS, and it is **explicitly unavailable on
mobile**:

```ts
const showPocketOption = isTauri() && !isNativeMobile();   // TTSSettings.tsx:658
```

Pocket TTS runs through a Tauri shell sidecar (`shell.sidecar("pocket-tts")`),
and Tauri v2 cannot spawn sidecar processes on Android or iOS. Mobile users get a
"requires desktop" notice and are left with the OS voice or a paid cloud
provider.

The spike proved that **in-webview ONNX inference cannot keep up with playback**
on mobile (and is marginal even on a fast desktop). The fix is to run inference
**natively** on Android, where the same ONNX graphs execute 2–4× faster than
WASM, model weights stay in native memory the OS can reclaim, and PCM can stream
straight into `AudioTrack` without ever crossing the Tauri IPC boundary.

[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (k2-fsa, Apache-2.0) is the
shared Android inference runtime: a production-grade JNI wrapper over ONNX
Runtime that already packages arm64/armeabi-v7a/x86/x86_64 native libs, exposes
streaming TTS callbacks, and supports both models we want to ship.

## What Changes

- **A native Tauri Android plugin** (`incrementum-android-tts`) written in Kotlin,
  registered through the same mobile-plugin pattern as `incrementum-folder-import`.
  It owns the full native pipeline: sherpa-onnx inference, `AudioTrack` playback,
  audio focus, lifecycle, and model downloads. **No PCM crosses Tauri IPC** — the
  webview only receives small events (progress, state, errors, completion,
  sentence position).
- **`sherpa-onnx` as the shared Android inference runtime**, consumed as a JitPack
  AAR (`com.github.k2-fsa:sherpa-onnx`). Inference runs on a background thread;
  the plugin streams callback PCM directly into `AudioTrack` in `MODE_STREAM`.
- **KittenTTS Micro (`kitten-nano`) as the compact default model.** KittenTTS
  (KittenML, Apache-2.0) is a small English TTS model whose fp16 export is
  ~78–166 MB — small enough to be the recommended first download. sherpa-onnx
  exposes it through `OfflineTtsKittenModelConfig`.
- **Kokoro-82M as an optional higher-quality model.** A larger (~330 MB),
  higher-fidelity multi-voice model exposed through `OfflineTtsKokoroModelConfig`.
  Users install it on demand; it is never the default download.
- **Android `TextToSpeech` as the zero-download fallback.** When no local model is
  installed, when a model fails to load, or when inference errors mid-utterance,
  the plugin falls back to the platform `TextToSpeech` engine so reading is never
  silent. This is distinct from the existing webview "System TTS" provider and
  lives entirely on the native side.
- **Existing desktop Pocket TTS behavior is unchanged.** This change touches
  Android only; Pocket remains the desktop-quality local option and stays gated
  behind `isTauri() && !isNativeMobile()`.
- **Pocket-on-Android may be added as an experimental follow-up**, not a blocker.
  sherpa-onnx exposes an `OfflineTtsPocketModelConfig`, so a future change could
  offer Pocket-quality synthesis on Android through the same native plugin. It is
  explicitly out of scope here.

## Capabilities

### New Capabilities

- `tts-local-onnx-runtime`: Native sherpa-onnx inference on Android — plugin
  lifecycle, background-thread generation, streaming PCM into `AudioTrack`, audio
  focus and interruption handling, pause/resume/stop, and System-TTS fallback
  when no model is installed or inference fails.
- `tts-model-asset-management`: On-demand download, integrity verification,
  storage in app data, progress and resumption, disk accounting, and deletion for
  KittenTTS/Kokoro model assets. Models are never bundled in the APK.
- `tts-android-provider`: The native Android TTS adapter on the existing
  `TTSProviderAdapter` contract — KittenTTS as default, Kokoro as optional,
  sentence chunking with prefetching, sentence-level highlighting, and event
  streaming back to the React controls.

### Modified Capabilities

None in `openspec/specs/`. This change consumes the `TTSProviderAdapter` contract
defined by the pending change `add-openrouter-tts-provider-catalog` and adds no
requirements to it.

## Impact

**Depends on**: `add-openrouter-tts-provider-catalog` — specifically the adapter
registry and per-provider settings. That change should land first; this one adds
an adapter rather than reworking the contract.

**Code**
- `src-tauri/plugins/android-tts/` (new Tauri plugin)
  - `Cargo.toml`, `build.rs`, `src/lib.rs` — Rust registration + mobile shim
  - `android/build.gradle.kts` — pulls in sherpa-onnx AAR
  - `android/src/main/java/com/incrementum/androidtts/` — Kotlin plugin
    (`AndroidTtsPlugin.kt`, `SherpaTtsEngine.kt`, `TtsAssetManager.kt`,
    `TtsModelRegistry.kt`, `SystemTtsFallback.kt`)
  - `permissions/` — ACL capability files
- `src/api/tts/providers/android.ts` (new) — the adapter
- `src/api/tts/android/bridge.ts` (new) — invoke + event subscription to the plugin
- `src/api/tts/android/models.ts` (new) — model/voice manifests
- `src/components/settings/AndroidTtsModelManager.tsx` (new) — download, progress,
  disk usage, removal, model switching
- `src/components/settings/TTSSettings.tsx` — show the Android provider on
  Android; keep Pocket desktop-gated
- `src/hooks/useTTS.ts` — sentence-chunked streaming + highlighting events for the
  native provider
- `src/lib/i18n/locales/*.ts` — new strings

**External**
- sherpa-onnx AAR `com.github.k2-fsa:sherpa-onnx:1.13.4` (Apache-2.0) via JitPack.
- KittenTTS fp16 model (KittenML, Apache-2.0), e.g. `kitten-nano-en-v0_1-fp16`
  (~78–166 MB) — the compact default.
- Kokoro-82M model (Apache-2.0), e.g. `csukuangfj/kokoro-en-v0_19`
  (`model.onnx` ~330 MB + `voices.bin` ~5.5 MB) — the optional higher-quality
  model.

**Storage**
- ~80–170 MB for KittenTTS (the default, opt-in), ~335 MB for Kokoro (optional),
  in app data. Removable, never downloaded without consent, never bundled.

**Not in scope**
- iOS. The native-plugin pattern carries over, but iOS is unverified here and
  stays gated off.
- Replacing or removing Pocket TTS. It stays the desktop local option untouched.
- Pocket-on-Android. sherpa-onnx supports it (`OfflineTtsPocketModelConfig`), but
  it is an experimental follow-up, not a blocker for this change.
- Cloud providers, credentials, Python, PyTorch, or a second audio-control UI.
- MOSS-TTS-Nano. The WASM approach was the spike's subject and is now superseded;
  its findings are retained in `design.md` for reference.
