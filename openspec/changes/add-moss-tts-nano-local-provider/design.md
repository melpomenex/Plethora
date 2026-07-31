## Context

### The gap

`TTSSettings.tsx:658` is the whole problem in one line:

```ts
const showPocketOption = isTauri() && !isNativeMobile();
```

Pocket TTS is a Tauri shell sidecar (`src-tauri/src/pocket_tts.rs` →
`shell.sidecar("pocket-tts")`). Tauri v2 cannot spawn child processes on Android
or iOS, so the option is hidden there and mobile users see a "requires desktop"
notice. The codebase has met this wall before: `Cargo.toml` documents replacing
ffmpeg "so audiobook cover extraction works on Android where no ffmpeg sidecar
exists".

Anything that needs a separate binary is therefore disqualified on mobile. That
eliminates Piper, Pocket, whisper-style sidecars, and every "just ship a CLI"
approach. What remains is code that runs *inside* the app: Rust compiled into the
binary, native mobile code, or JavaScript/WASM in the webview.

### The spike: in-webview ONNX inference was measured and rejected (2026-07-31)

This change originally proposed running MOSS-TTS-Nano through `onnxruntime-web`
in the webview. A real (not simulated) feasibility spike ran the full 717 MB of
downloaded weights on an Apple M4 and a physically connected Pixel 9 Pro XL:

**RTF, single-threaded (no `SharedArrayBuffer`):**

| Device | avgFrameMs | prefillMs | codecMs | RTF |
|---|---|---|---|---|
| Apple M4 (30 frames) | 80.4 | 1926 | 973 | **2.216** |
| Pixel 9 Pro XL (30 frames) | 62.4–66.6 | 1235–1623 | 610–660 | **1.549–1.786** |

**RTF with COOP/COEP (4 threads):**

| Device | avgFrameMs | prefillMs | codecMs | RTF |
|---|---|---|---|---|
| Apple M4 (30 frames) | 68.8 | 595 | 366 | **1.261** |
| Pixel 9 Pro XL (30 frames) | 67.3 | 842 | 313 | **1.327** |

Neither device reached RTF < 1.0 under any configuration — the model generates
audio **slower than it plays**. Worse, the sustained run **crashed at ~123 s**
(threads=4 on the 10-core M4) with `OrtRun(): ERROR_CODE 6, std::bad_alloc`
inside the codec `decode_full` call: WASM linear-memory exhaustion from repeated
allocation across many `session.run()` calls.

The conclusion is that in-webview ONNX inference is **not viable for TTS** on
mobile (and is marginal even on a fast desktop). The same ONNX graphs execute
2–4× faster natively, and native memory is reclaimable by the OS — exactly the
two failure modes the spike hit. The pivot below keeps the spike's lesson (native
inference, not WASM) and discards only its subject (MOSS via the webview).

### What the pivot keeps vs. replaces

| Aspect | Original (rejected) | Pivoted approach |
|---|---|---|
| Inference location | webview WASM (`onnxruntime-web`) | **native Android JNI** (`sherpa-onnx`) |
| Runtime | JS Web Worker | **background Kotlin thread** |
| Audio path | PCM blob → webview `<audio>` | **callback PCM → `AudioTrack` directly** |
| Tokenization | TS SentencePiece (the documented gap) | **handled inside sherpa-onnx** |
| Memory | WASM linear mem, unreclaimable, crashed | **native, OS-reclaimable** |
| Models | MOSS-TTS-Nano (~717 MB) | **KittenTTS (~80–170 MB) + Kokoro (~335 MB)** |
| Fallback | webview SpeechSynthesis | **Android `TextToSpeech` (native)** |

The asset-download pattern (Decision 2 below) and the adapter-contract
integration are unchanged from the original design; only the inference substrate
and model choice change.

### What Incrementum already has

- A working **mobile-plugin pattern** in `src-tauri/plugins/folder-import/` —
  Rust `init_mobile` + `register_android_plugin`, Kotlin `@TauriPlugin` +
  `@Command` + `Invoke`, ACL capability files, and wiring through
  `settings.gradle.kts` / `tauri.build.gradle.kts`. This change copies that
  scaffold rather than inventing a new one.
- `isNativeMobile()` and `isNativePhone()` in `src/lib/tauri.ts`.
- A TTS provider registry (`src/api/tts/registry.ts`) and adapter contract
  (`src/api/tts/types.ts`) from `add-openrouter-tts-provider-catalog`.
- Android is a scripted build target (`npm run tauri:android:build`); the test
  device is a Pixel 9 Pro XL.

## Goals / Non-Goals

**Goals:**

- A local, private, zero-cost TTS voice that works on Android — the first one.
- Responsive playback: inference off the main thread, streaming audio, no ANR.
- Sentence chunking with prefetching and sentence-level highlighting.
- Honest fallback: System TTS when no model is installed or inference fails.
- No increase in APK size (models are downloaded, never bundled).
- No regression to desktop Pocket TTS.

**Non-Goals:**

- iOS. The plugin pattern carries over, but iOS is unverified here.
- Replacing Pocket TTS. It remains the desktop local option, untouched.
- Pocket-on-Android. sherpa-onnx supports it, but it is an experimental
  follow-up, not a blocker.
- Cloud providers, credentials, Python, PyTorch, or a second audio-control UI.
- MOSS-TTS-Nano. The WASM path is superseded by native inference; the spike is
  retained for reference only.

## Decisions

### 1. Native inference via a Kotlin Tauri plugin, not the webview

The spike measured the webview path and it failed (RTF 1.26–2.22, crash at 123 s).
The pivoted approach runs inference **natively** through a Tauri mobile plugin in
Kotlin, consuming sherpa-onnx as an AAR. This was chosen because:

- **It removes the failure mode the spike found.** Native ONNX Runtime executes
  the same graphs 2–4× faster than WASM, and native memory is reclaimable by the
  OS rather than locked in a WASM linear memory that exhausts and crashes.
- **sherpa-onnx already solves the parts the spike left open.** It packages
  arm64/armeabi-v7a/x86/x86_64 native libs, exposes streaming TTS callbacks, and
  — critically — **embeds its own tokenization** (the SentencePiece gap the
  original design devoted a whole task group to). We do not re-implement
  tokenization in TypeScript.
- **The plugin pattern already exists in this repo.** `incrementum-folder-import`
  is a working example of Rust `register_android_plugin` + Kotlin `@Command`
  handlers + ACL capability files. This change follows that scaffold exactly.
- **PCM never crosses Tauri IPC.** On Android, Tauri's IPC is JSON-only; shipping
  PCM through it would hang or OOM. The plugin streams callback PCM straight into
  `AudioTrack` and emits only small JSON events to the webview.

### 2. sherpa-onnx as the shared runtime; KittenTTS default, Kokoro optional

`com.github.k2-fsa:sherpa-onnx:1.13.4` (Apache-2.0, via JitPack) is the runtime.
It exposes a small, stable Kotlin API:

```kotlin
val tts = OfflineTts(assetManager = null, config = OfflineTtsConfig(...))
val audio = tts.generateWithCallback(text, sid, speed) { samples: FloatArray ->
    // samples are float PCM in [-1, 1]; feed straight to AudioTrack
    audioTrack.write(samples, 0, samples.size, AudioTrack.WRITE_BLOCKING)
    return@generateWithCallback if (shouldContinue) 1 else 0
}
val sampleRate = tts.sampleRate()   // 24000 for Kokoro/Kitten
```

Model selection, all served through sherpa-onnx's model-config types:

- **KittenTTS Micro → `kitten-nano` fp16 (default).** KittenTTS (KittenML,
  Apache-2.0) is a small English TTS model. The `kitten-nano-en-v0_1-fp16`
  package is ~78–166 MB and is offered as the first download. Exposed via
  `OfflineTtsKittenModelConfig`.
- **Kokoro-82M (optional, higher quality).** `csukuangfj/kokoro-en-v0_19`
  (`model.onnx` ~330 MB + `voices.bin` ~5.5 MB, 24000 Hz, ~11 voices) is the
  larger, higher-fidelity option users can install on demand. Exposed via
  `OfflineTtsKokoroModelConfig`.

> Note: the user-facing name "KittenTTS Micro" maps to sherpa-onnx's
> `kitten-nano` (the smallest variant). There is no upstream package literally
> named "Micro"; the spec uses "Micro" in the UI and `kitten-nano` in the asset
> manifest.

### 3. The plugin owns the entire native pipeline

The Kotlin plugin is responsible for, in order of the speak path:

1. **Sentence chunking** of the input text (the plugin receives already-split
   sentences from the adapter, but also guards against oversize input).
2. **Prefetching** the next chunk while the current one plays.
3. **Inference on a dedicated background thread** via sherpa-onnx.
4. **Streaming callback PCM directly into `AudioTrack`** (`MODE_STREAM`,
   `ENCODING_PCM_FLOAT`, `USAGE_ASSISTANT`/`CONTENT_TYPE_SPEECH`).
5. **Audio-focus handling** — request focus before playing, pause on
   transitory loss, stop on permanent loss, duck if another app takes focus.
6. **Interruption handling** — phone calls, notifications, other media.
7. **Lifecycle** — request/release audio focus, stop/release `AudioTrack` on
   pause/stop/destroy, release sherpa sessions under memory pressure.
8. **Single-engine ownership** — prevent concurrent engines (sherpa and System
   fallback, or two speak calls) from speaking simultaneously.
9. **System-TTS fallback** — when no model is installed, when a model fails to
   load, or when inference errors mid-utterance, route the utterance to Android
   `TextToSpeech` so reading is never silent.

The webview never sees PCM. It receives only small JSON events: download
progress, playback state, errors, utterance completion, and sentence position
(for highlighting).

### 4. Android `TextToSpeech` as the zero-download fallback

A fresh install with no model downloaded must still read aloud. The plugin wraps
Android's platform `TextToSpeech` so that:

- No model installed → utterance is spoken by System TTS.
- A model fails to load (corrupt/missing files) → System TTS, with a notice.
- Inference errors mid-utterance → System TTS finishes the current utterance.
- The user explicitly disables local models → System TTS.

This is **distinct** from the existing webview "System TTS" provider
(`SpeechSynthesis`); it lives entirely on the native side and is the fallback
*under* the native provider, not a separate user-selectable provider. The two
must never speak at once — single-engine ownership (Decision 3) enforces this.

### 5. Models downloaded to app data, verified, never bundled

Following the asset pattern this repo already uses for transcription models, the
plugin downloads model archives to the app's files directory (`<filesDir>/tts/`)
on explicit user action. Each archive is:

- Downloaded with a streaming progress event (bytes/total, current asset).
- Verified by SHA-256 against a pinned manifest; mismatch deletes and reports.
- Stored under a versioned directory (`<filesDir>/tts/<modelId>/<version>/`).
- Removable in one action, returning disk usage to zero.
- Resumable across interruption: verified assets are skipped, partial assets
  restart that asset only.

Models are **never bundled in the APK** — sherpa-onnx ships as a ~49 MB AAR but
carries no model weights. APK size impact is the AAR's native libs (arm64 by
default for the release target).

### 6. The adapter plugs into the existing provider contract

A new `android` adapter (`src/api/tts/providers/android.ts`) implements
`TTSProviderAdapter` with `kind: "local"`, `auth: { mode: "none" }`, and is
registered in the existing registry. It is available **only on Android**
(availability gate on `isNativeMobile()`). On desktop it is hidden, so Pocket's
behavior is untouched.

`listModels` returns the model catalog (KittenTTS installed/not, Kokoro
installed/not) and `listVoices` returns each model's voice roster from
sherpa-onnx's `numSpeakers()` and the voice manifest. `synthesize` does not
return audio — for the native provider, "synthesize" means "queue these
sentences for native playback"; actual playback is event-driven. The React hook
detects the native provider and drives playback via the bridge rather than via
`<audio>`.

### 7. Sentence chunking, prefetching, and highlighting

The adapter splits text at sentence boundaries (reusing the existing chunker) and
hands the plugin a queue of sentences. The plugin:

- Synthesizes the first sentence, starts playback via `AudioTrack`.
- While sentence N plays, synthesizes sentence N+1 on the background thread.
- Emits a `sentence-position` event when each sentence begins, so the React
  controls can highlight the active sentence in the reader.
- Emits `utterance-complete` when the queue drains.

This gives responsive playback (audio starts after the first sentence, not after
the whole passage synthesizes) and sentence-level highlighting for free.

## Migration Plan

1. **Scaffold the plugin** — Cargo crate, Rust mobile shim, Kotlin plugin class,
   ACL capabilities, build wiring (this mirrors `incrementum-folder-import`).
2. **Land the Kotlin engine** — sherpa-onnx integration, `AudioTrack` streaming,
   audio focus, lifecycle, single-engine lock, System-TTS fallback.
3. **Land the asset manager** — download/verify/progress/resume/delete in
   `<filesDir>/tts/`.
4. **Land the adapter + bridge** — `android` provider on the registry, TS bridge
   for invoke + event subscription, model/voice manifests.
5. **Wire the React controls** — settings UI (download/switch/remove), hook
   integration for sentence-chunked streaming + highlighting.
6. **Verify** — Android arm64 build, KittenTTS download+speak, Kokoro
   install/select/use/remove, play/pause/resume/stop/rate/voice, System-TTS
   fallback, no Pocket regression, download recovery.

**Rollback:** the adapter is additive. Unregistering `android` leaves every other
provider untouched; the only residue is downloaded model files under
`<filesDir>/tts/`, which the removal control already handles. Desktop is entirely
unaffected.

## Risks / Trade-offs

- **APK size grows by the sherpa-onnx native libs** → The AAR is ~49 MB but the
  release build targets arm64 only, so the shipped `.so` is a fraction of that.
  Acceptable for a feature that delivers offline TTS; models themselves are
  never bundled.
- **sherpa-onnx is a large transitive dependency** → Pin to `1.13.4` via
  JitPack; treat a version bump as an explicit change. Native-lib conflicts with
  onnxruntime (already used by transcription) must be checked at build time.
- **KittenTTS sample rate is not documented upstream** → Read it at runtime via
  `OfflineTts.sampleRate()` rather than hardcoding; default the `AudioTrack` to
  the reported rate.
- **Kokoro has fewer packaged voices than upstream advertises** → Use
  `numSpeakers()` at runtime for the voice count, not a hardcoded number.
- **A wrong checksum must not silently brick TTS** → On mismatch, delete the
  file, mark not-ready, and fall back to System TTS until re-downloaded.
- **Audio focus and interruptions are easy to get wrong** → Request focus before
  playing; abandon on stop; pause on transitory loss; stop on permanent loss;
  never let two engines speak at once.
- **The plugin must not ANR** → All inference and download I/O off the main
  thread; `AudioTrack.write(WRITE_BLOCKING)` runs on the playback thread, not the
  UI thread.
- **Background/locked-screen playback** → Use a foreground service where
  supported so audio survives screen lock; release resources on task removal.

## Open Questions

- Whether to expose Kokoro's multi-language package (`kokoro-multi-lang-v1_0`,
  53 voices) in addition to the English v0_19 package (11 voices), or ship one
  and let the manifest decide later.
- Idle-disposal timeout for sherpa sessions: too short and every paragraph pays
  reload cost; too long and a backgrounded app holds native memory. Default to
  releasing on `onStop`/memory pressure and reloading on the next speak.
- Whether the System-TTS fallback should be selectable as a primary native
  provider (distinct from the webview "System TTS") or remain purely a fallback.
  Current decision: fallback only.

## Preserved spike record (for reference)

The original WASM/MOSS spike findings are retained verbatim below. They are no
longer the basis for implementation — the native pivot supersedes them — but they
document why in-webview inference was rejected and are cited by Decision 1.

---

### Spike results (2026-07-31, original WASM approach — SUPERSEDED)

The spike ran real `onnxruntime-web` inference — not a simulation — against the
full downloaded weights (717 MB), on an Apple M4 (10-core, this session's actual
dev machine) and a physically connected Pixel 9 Pro XL over `adb`.

**RTF, single-threaded (no `SharedArrayBuffer`):**

| Device | Frames | Audio | avgFrameMs | prefillMs | codecMs (decode_full) | RTF |
|---|---|---|---|---|---|---|
| Apple M4 | 30 | 2.4s | 80.4 | 1926 | 973 | **2.216** |
| Apple M4 | 84 (natural stop) | 6.72s | 87.5 | 2036 | 4597 | **2.087** |
| Pixel 9 Pro XL | 30 | 2.4s | 62.4–66.6 | 1235–1623 | 610–660 | **1.549–1.786** |

**RTF with COOP/COEP enabled (4 threads):**

| Device | Frames | avgFrameMs | prefillMs | codecMs | RTF |
|---|---|---|---|---|---|
| Apple M4 | 30 | 68.8 | 595 | 366 | **1.261** |
| Pixel 9 Pro XL | 30 | 67.3 | 842 | 313 | **1.327** |

Neither device reached RTF < 1.0 under any configuration. The pattern is
mechanically explicable: prefill and codec decode parallelize well across threads
(~2–3× faster with 4 threads); the per-frame autoregressive decode step does not.
The serial, whole-sequence `codec_decode_full` call after generation pushes total
RTF past 1.0.

The sustained run **crashed at ~123 s** (threads=4 on the M4) with
`OrtRun(): ERROR_CODE 6, std::bad_alloc` inside the codec `decode_full` call —
WASM linear-memory exhaustion from repeated allocation across many
`session.run()` calls of varying output size. Five runs completed cleanly before
the crash.

**Go/no-go on the WASM approach: NO-GO.** The naive integration does not reach
real-time on any tested hardware, including a flagship phone and a fast desktop,
and it crashes under sustained use. The fixable items (streaming `codec_decode_step`,
session-count-based disposal) would narrow but not close the gap on mid-range
Android, and WASM's unreclaimable memory remains a structural problem for a
long-running reading app. **Native inference (the pivoted approach) removes both
failure modes**, which is why this change now specifies sherpa-onnx rather than
`onnxruntime-web`.
