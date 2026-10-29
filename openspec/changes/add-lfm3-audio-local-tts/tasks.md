## 1. Scope and runtime foundation

- [x] 1.1 Narrow this change to an optional provider in existing TTS flows; retain the source audit and preserve the superseded broader plan under `evidence/initial-scope/`. Verify no audio-owner/storage redesign or device-specific product gate remains required.
- [x] 1.2 Pin runtime, complete model pair and licenses/notices using the existing research and verified artifact lock. Verify exact sizes/hashes and immutable source references.
- [x] 1.3 Confirm real native 24 kHz speech on available GPU hardware using the isolated probe, with both voices, English locale mapping, warm reuse and cancellation. Record effective offload/backend; use this as a smoke, not a hardware qualification program.

## 2. Portable native runtime

- [x] 2.1 Add a minimal persistent llama.cpp/libmtmd host with bounded control messages, verified LFM3 pipeline, fresh utterance state and valid bounded WAV output. Support portable CPU and available Metal/CUDA through normal build/backend selection; no named-device gate.
- [x] 2.2 Add Rust status/synthesize/cancel/unload commands using canonical HF model/output paths and a single serialized host. Verify warm reuse, concurrent reader prefetch, cancellation/kill/reap and safe teardown without a second playback owner.
- [x] 2.3 Extend existing sidecar build/provision/package paths for the portable host and backend dependencies. Verify effective backend reporting and actionable missing-runtime states; end users need no compiler/toolkit.

## 3. Existing HF model manager

- [x] 3.1 Add mirrored LFM3 runtime/run-contract DTOs and exact complete-pair detection with immutable revision, file hashes, total download size and containment validation. Verify existing contracts/IDs retain compatibility.
- [x] 3.2 Reuse model installation/progress/cancel/hash verification and expose LFM3 availability/removal through the current manager. Verify incomplete/wrong pairs fail, active weights cannot be deleted, and no GPU-model allowlist is introduced.

## 4. Provider and product integration

- [x] 4.1 Register `lfm3` in provider unions/defaults/registry/catalog, with female/male voices, documented locale mapping and truthful WAV/timing/speed/cloning capabilities. Verify old selections remain unchanged and no cloud/System fallback occurs.
- [x] 4.2 Route synthesis through existing speech/cache APIs, adding only required language/cancellation/identity fields. Verify locale/model/voice cache separation and independent cancellation of shared consumers without introducing native cache persistence.
- [x] 4.3 Integrate model download/status, voice/language and preview in existing Settings controls, with stable Settings search targets/catalog/coverage and migration tests. Keep ordinary controls free of hardware qualification details.
- [x] 4.4 Verify existing reader controls and Audio Edition provider dispatch use the adapter and bounded WAV results. Preserve current anchors, focus and playback/storage ownership; no global playback rollout or edition-job redesign.

## 5. Focused checks and documentation

- [x] 5.1 Add deterministic native protocol/lifecycle and HF compatibility tests plus the opt-in actual-model smoke. Verify input/output bounds, invalid models, cancellation and warm reuse without routine weight downloads.
- [x] 5.2 Run provider/settings/cache/search and affected reader/edition regression suites, retaining existing provider/platform behavior.
- [x] 5.3 Run applicable type/lint/build checks, `npm run test:scripts` and `npm run bench:check`; document genuine pre-existing failures and do not weaken baselines without measured justification.
- [x] 5.4 Document optional installation, supported packaged runtime targets, automatic acceleration/CPU behavior, cancellation and model licensing. Keep untested targets honest and track commercial-clearance scope as a release prerequisite, not a hardware benchmark gate.
