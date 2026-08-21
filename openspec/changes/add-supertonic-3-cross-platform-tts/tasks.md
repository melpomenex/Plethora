# Implementation Tasks

## 1. Spikes (time-boxed, decide before dependent work)

- [x] 1.1 **T1 — Desktop FFI feasibility** (Linux first, then macOS, Windows): load the
      pinned `libsherpa-onnx-c-api` via `libloading` from a scratch binary; define the
      `#[repr(C)]` structs for `SherpaOnnxOfflineTtsConfig` /
      `SherpaOnnxOfflineTtsSupertonicModelConfig` / `SherpaOnnxGenerationConfig`;
      create an engine against a downloaded canonical model; synthesize one sentence;
      verify version guard (`SherpaOnnxGetVersionStr`), callback abort (return 0), and
      destroy. Windows must prove DLL isolation from System32 `onnxruntime.dll`
      (absolute-path load / `AddDllDirectory`). macOS must prove ad-hoc signed dylib
      loads under hardened runtime.
      - **Success:** synthesis works on all three OSes with bounded latency.
      - **Failure/decision path:** any platform unsound → switch that platform (or all)
        to the CLI fallback: provision `bin/sherpa-onnx-offline-tts-<triple>` in
        `download-sidecars.js`, invoke per sentence-batch behind the same engine trait.
        Record the decision in this change before Task 4 starts.
      - **RESULT (Linux x86-64, sherpa v1.13.6 + canonical repo @ cca5a0e):** PASS.
        `libloading` load OK; version string OK; engine load 0.5 s; sample_rate=44100;
        full-sentence synthesis 0.67 s for 4.4 s audio (RTF ≈ 0.15, 2 threads,
        Ryzen 9 5900X); audio non-silent (peak 0.44); destroy OK. **Callback caveat:**
        the Supertonic impl invokes the progress callback once per `generate` call
        (after completion) even for multi-sentence input, so callback-abort gives NO
        mid-call cancellation — cancel granularity is per generate call (between
        sentence chunks). Struct layouts verified against the v1.13.6 `c-api.h`
        (Vits/Matcha/Kokoro/Kitten/Zipvoice/Pocket/Supertonic field orders captured).
        **Decision: FFI is the primary path.** macOS/Windows legs of this spike could
        not run in the Linux dev environment — they are folded into the §12 acceptance
        matrix (12.10); the CLI fallback (5.4) stays documented as the contingency if
        either platform proves unsound there.
- [x] 1.2 **T2 — Model behavior probe**: using the sidecar CLI or T1 harness, record
      `numSpeakers()` for the canonical repo, acceptable `speed` range, sensible
      `max_num_sentences`/`silence_scale` for long paragraphs, and RTF on a mid-range
      x86-64 CPU and one Android arm64 device. Feed results into defaults + suitability
      copy.
      - **RESULT (x86-64 leg):** `numSpeakers()=10` (NOT 1 as design guessed — voice
        roster must come from the engine, never hardcoded); `speed` is a direct rate
        factor, verified 0.5 (27 s audio) / 1.0 (13.5 s) / 2.0 (6.7 s) on the same
        paragraph; RTF ≈ 0.13–0.26 at speed 0.5–2.0 with num_threads=2; `silence_scale`
        passed via GenerationConfig is overridden by the impl default (0.2) — do not
        rely on it; `num_steps=5` default (flow matching). Android arm64 leg deferred
        to the §12 device matrix.
- [x] 1.3 **T3 — Android AAR check**: confirm JitPack publishes `1.13.5+`; if yes,
      plan the optional bump (diacritics fix); else stay on 1.13.4.
      - **RESULT:** JitPack build status `ok` for 1.13.5 and 1.13.6. **Coordinate
        change:** since 1.13.5 the project is multi-module on JitPack — the AAR is at
        `com.github.k2-fsa.sherpa-onnx:sherpa-onnx:<v>` (verified HTTP 200), not the
        flat `com.github.k2-fsa:sherpa-onnx:<v>` used by 1.13.4. A bump must update
        both group and artifact id. Bump planned for task 6.5.

## 2. Shared sherpa TTS family + run-contract model (Rust)

- [x] 2.1 Add `SherpaTtsFamily` (`vits|kokoro|kitten|supertonic`, kebab-case serde) in
      `src-tauri/src/models/hf/adapters.rs`.
- [x] 2.2 Reshape `RunContract::SherpaTts` per design D2 (`family: Option<…>` +
      family-specific optional file fields, all `#[serde(default)]`); add
      `effective_tts_family()` legacy inference and a `validate()` (family ↔ required
      files).
- [x] 2.3 Extend contract path-containment checks to every new file field
      (`sanitize_install_rel` coverage in `manager.rs`).
- [x] 2.4 Update the TypeScript mirror in `src/api/hfModels.ts` (optional fields only).

## 3. Supertonic HF artifact detection

- [x] 3.1 Add the Supertonic file names to `hf_client.rs::build_file_index` enrichment
      so sizes/SHA-256 resolve for all seven assets.
- [x] 3.2 Implement Supertonic detection in `SherpaOnnxTtsAdapter::detect_artifact`
      (checked before VITS/Kokoro): complete 7-file set, consistent precision suffix,
      INT8 preferred; kind `"supertonic"`, confidence exact; memory estimate ×1.15;
      metadata carries precision + voice-roster placeholder.
- [x] 3.3 Keep upstream `Supertone/supertonic-3` layout rejected (no detection match);
      keep the unsupported-runtime error text accurate.

## 4. Install/registry compatibility

- [ ] 4.1 Verify (tests only where needed) multi-file install through the existing
      pipeline: hash-pinning gate covers all seven files; atomic dir cleanup on failure;
      uninstall removes the full set; disk preflight uses total size.
- [ ] 4.2 Add lazy family inference on registry read (`registry_list` /
      `resolve_installed_path`) without DB writes; optionally write back migrated
      contracts on next install of the same row.
- [ ] 4.3 Confirm model IDs and install dirs unchanged
      (`hf:sherpa-onnx-tts:<repo>[@rev]`, `models/tts/<safe_dir_name>`); document in
      `models/hf/security.md` that Supertonic files are inert data inputs.

## 5. Desktop native sherpa TTS runtime

- [ ] 5.1 Create `src-tauri/src/tts/` module: `sherpa_ffi.rs` (pinned-version C API
      surface, dynamic loading, version guard), `engine.rs` (`SherpaTtsSession`:
      load/unload/synthesize/cancel on a dedicated worker thread), `wav.rs` (16-bit PCM
      mono WAV encode at engine-reported sample rate), `commands.rs`
      (`sherpa_tts_status`, `sherpa_tts_synthesize`, `sherpa_tts_cancel`,
      `sherpa_tts_unload`); register commands in `lib.rs`.
- [ ] 5.2 Route synthesis input from the installed contract: resolve model id →
      install dir + `RunContract::SherpaTts{family: Supertonic}` → absolute config
      paths; reject invalid contracts before load.
- [ ] 5.3 Implement cancellation (atomic flag → callback 0), unload drop-guard, and
      single-flight semantics (one active synthesis; new request supersedes).
- [ ] 5.4 If T1 chose the CLI fallback: implement the sidecar invocation variant behind
      the same session trait instead of 5.1's FFI internals (frontend unchanged).

## 6. Android Supertonic integration

- [ ] 6.1 Kotlin: add `TtsModelKind.SUPERTONIC("supertonic")`; extend
      `SherpaTtsEngine.load` with the Supertonic branch filling
      `OfflineTtsSupertonicModelConfig` from the seven files under the model dir.
- [ ] 6.2 Shared storage bridge: Rust shim resolves `hf:`-prefixed model ids via the HF
      registry to `{install_dir, run_contract}` and passes them to the plugin's existing
      load path; no weight duplication into `TtsAssetManager` storage.
- [ ] 6.3 `AndroidTtsPlugin.speak` accepts HF model ids; uninstalled/unknown ids fail
      gracefully into the existing System-TTS fallback with a user-visible reason.
- [ ] 6.4 Update Rust shim DTOs (`NativeTtsModel.kind` serial `"supertonic"`); keep
      Kitten/Kokoro paths byte-for-byte behaviorally identical.
- [ ] 6.5 Optional (per T3): bump AAR to 1.13.5+; regression-test Kitten/Kokoro.

## 7. Shared provider/model routing (frontend)

- [ ] 7.1 Add `"supertonic"` to `TTSProviderId`/`TTS_PROVIDER_IDS`/registry; create
      `src/api/tts/providers/supertonic.ts`: desktop → `sherpa_tts_synthesize` (WAV
      data URL result shape like Pocket); mobile → delegate to the native event path.
- [ ] 7.2 `useTTS`: route `provider === "supertonic"` on mobile through
      `useNativeAndroidTTS` (model id passthrough) exactly as `"android"` is routed;
      keep hook-order safety notes intact.
- [ ] 7.3 Settings: add `providers.supertonic` defaults (`modelId: ""`, `voiceId:
      "0"`); selection persists by shared HF model id; missing local install renders a
      "download required" state linking to the HF manager; no silent provider fallback.
- [ ] 7.4 Voice roster: derive from installed-model metadata/engine-reported speaker
      count; default style "0"; speed maps reader rate → sherpa speed (clamped).

## 8. Settings & HF manager UX

- [ ] 8.1 `HuggingFaceModelManager` (mode="tts"): show family/precision badges, asset
      list, size, memory estimate, license, revision, per-device suitability; gate
      runnable claims on detected runtime availability (desktop FFI status / Android
      plugin support).
- [ ] 8.2 Replace `tts_runtime_note` STT-only caveat in `suitability.rs` with
      runtime-aware messaging; CPU-first classification for Supertonic (never
      GPU-gated).
- [ ] 8.3 TTSSettings copy update: local models are now runnable; keep the security
      note; ensure unsupported repos still show the existing blocked message.
- [ ] 8.4 i18n: add/translate new strings (en + de/es/fr/ja/zh locales used by TTS
      settings).

## 9. Playback integration

- [ ] 9.1 Verify `ReaderTTSControls` chunk buffering/prefetch works with the supertonic
      adapter's WAV results (first-chunk-before-playback, look-ahead generation,
      eviction) — adjust only if gaps appear.
- [ ] 9.2 Sentence highlighting via existing chunk events (desktop) and
      `sentence-position` events (Android); proportional word-timing fallback only; no
      fabricated timestamps.
- [ ] 9.3 Position persistence, media-session controls, headphone-disconnect pause,
      background behavior: confirm inherited behavior on both platforms; fix routing
      gaps only.

## 10. Packaging/build changes

- [ ] 10.1 `scripts/download-sidecars.js`: bump `SHERPA_ONNX_VERSION` to v1.13.6 (or
      ≥1.13.5); re-verify asset names for the new tag; stop deleting
      `sherpa-onnx-c-api.dll` on Windows; keep the version-marker provisioning guard.
- [ ] 10.2 Bundle/sign shared libs: Linux rpath/`$ORIGIN`, macOS rpaths + codesign
      (extend build.rs signing to the c-api lib; verify notarized builds), Windows
      explicit resources map + DLL search-path isolation at load time.
- [ ] 10.3 Update installer size budgets/docs; run bundle-budget check; CI matrix stays
      green for all desktop targets.

## 11. Automated tests

- [ ] 11.1 Rust detection tests: valid layout → supertonic artifact (family, assets,
      size, contract); each of the seven files individually missing → rejected;
      mixed-precision → rejected; arbitrary multi-ONNX repo → not misclassified;
      upstream fp32 layout → rejected; existing Kokoro/VITS/Whisper/STT tests stay
      green.
- [ ] 11.2 Serialization tests: old `{"type":"sherpa-tts",…}` JSON rows deserialize;
      family inference (voices→Kokoro, else VITS); new Supertonic rows round-trip;
      model-id parsing/revision behavior unchanged; containment validation rejects
      traversal in every new field.
- [ ] 11.3 Installer tests (existing `TestServerBuilder`): all assets download with
      progress; SHA mismatch fails closed; cancel mid-download cleans up; duplicate
      install prevented; uninstall removes everything; disk preflight uses combined
      size.
- [ ] 11.4 Desktop engine tests: mocked-FFI unit tests (config construction, cancel
      flag, unload guard, single-flight); gated real-model integration test
      (`PLETHORA_SHERPA_TTS_MODEL_DIR` env or fixture download) asserting non-empty
      PCM, reported sample rate 44100, cancellation, and bounded RSS across 50+
      syntheses — skipped by default in CI.
- [ ] 11.5 Android tests: JVM tests for kind/config construction and HF-id resolution;
      instrumentation test plan (physical device) for load → synthesize → playback →
      stop → switch; Kitten/Kokoro regression assertions.
- [ ] 11.6 Frontend vitest: manager shows supported Supertonic artifact + blocked
      unsupported repo; installed model appears in provider list; selection persists;
      download-required state when not installed locally; remove model updates state;
      no duplicate provider entries; settings normalization for the new provider.
- [ ] 11.7 Run affected suites: `cargo test` (hf + tts modules), `npm run test:run`
      (tts/settings), `npm run test:scripts` unaffected.

## 12. Cross-platform manual verification (acceptance matrix)

For each of: **Android arm64 physical device**, **Linux x86-64**, **macOS Apple
Silicon**, **Windows x86-64**:

- [ ] 12.1 Fresh install/build → open TTS settings → open Hugging Face manager
- [ ] 12.2 Paste `csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11` → Inspect →
      recognized as Supertonic 3 / sherpa-onnx TTS with correct metadata
- [ ] 12.3 Install (progress, cancel-and-retry once) → installed state persists across
      app restart
- [ ] 12.4 Select as active TTS → read a short sentence → read several paragraphs →
      extended continuous reading (≥15 min desktop / ≥5 min mobile)
- [ ] 12.5 Adjust speed; stop/resume; switch model away and back
- [ ] 12.6 Offline verification (network disabled): synthesis still works
- [ ] 12.7 Remove model → files reclaimed (verify on disk)
- [ ] 12.8 Negative test: paste `Supertone/supertonic-3` and one known-invalid repo →
      installation remains blocked with the unsupported-runtime explanation
- [ ] 12.9 Regression: Parakeet/SenseVoice STT transcription smoke (upgraded sidecar),
      Kitten/Kokoro Android playback, Pocket TTS desktop, cloud TTS untouched
- [ ] 12.10 macOS: repeat 12.x on a signed/notarized build; Windows: verify no
      onnxruntime DLL conflicts on a clean machine

## 13. Documentation

- [ ] 13.1 Update `models/hf/security.md` (Supertonic asset handling, hash pinning).
- [ ] 13.2 User-facing help text: local TTS options, supported platforms, offline
      behavior (help index data used by TTS docs).
- [ ] 13.3 CHANGELOG entry; note sherpa-onnx upgrade and Android AAR (if bumped).
