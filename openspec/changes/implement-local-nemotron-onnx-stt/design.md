# Design: implement-local-nemotron-onnx-stt

## Context

Local Nemotron STT today: catalog entry + downloader + routing + UI all exist; inference is a stub (`nemotron.rs` `transcribe_file` → "runtime not available"; accepted P2 debt from the STT platform change). The currently pinned artifact is the handy-computer GGUF (`handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf`, Q4_K_M, 495 MB) whose intended runtime (transcribe.cpp) is not bundled.

Feasibility research established:
- **sherpa-onnx merged official multilingual Nemotron 3.5 streaming support** (k2-fsa/sherpa-onnx PR #3671, merged 2026-06-12, ~1.13.x series) implementing the cache-aware FastConformer RNN-T transducer with language-ID prompt conditioning (`online-transducer-nemo-model.cc`, `prompt_index=101` auto-detect).
- Official pre-exported, hash-pinnable model packages on HF (`csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-{80,160,320,560,1120}ms[-int8]-2026-06-11`).
- CLI contract of the **online** `sherpa-onnx` binary is the generic split transducer: `--encoder=… --decoder=… --joiner=… --tokens=… input.wav` — the *same argv shape* as our existing `SherpaFamily::Zipformer` split branch in `run_sherpa_sidecar`.
- Our provisioning (`scripts/download-sidecars.js`) copies **only `bin/sherpa-onnx-offline`** from the prebuilt tarball (renamed to the `sherpa-onnx` sidecar); the online binary ships in the same tarball but is not provisioned.

Decision (user-selected): build on the sherpa-onnx ONNX path rather than adding a transcribe.cpp GGUF sidecar — it reuses our proven sidecar rails end to end at the cost of switching model artifacts.

## Goals / Non-Goals

**Goals:**
- Batch file transcription (podcasts, audiobooks, job queue, manual) runs fully on-device for the Nemotron logical model.
- Model artifact = official int8 ONNX export, per-file SHA-256-pinned, installed through the existing HF manager multi-file path.
- Second sherpa sidecar (online binary) provisioned, packaged, signed, and verified on all desktop platforms with the same guarantees as the existing ones.
- Truthful availability gating and an honest GGUF migration story.

**Non-Goals:**
- Live-mic streaming sessions via this runtime — the CLI binary consumes a wav file per invocation; incremental PCM feeding needs the sherpa C API (dylibs are already bundled: `libsherpa-onnx-c-api`) — follow-up change. The existing `LocalNemotronStreamingSession` keeps its current behavior (cloud/pseudo-streaming).
- Mobile (Android/iOS) local Nemotron — native STT stays as-is; desktop only.
- New GGUF sidecar (transcribe.cpp/NeMo-Speech.cpp) — documented alternative, not built.
- Fine-tuning, diarization, translation, hotwords (sherpa issue #3572 tracks hotwords upstream).

## Decisions

### D1: Artifact = `csukuangfj2/…-560ms-int8-2026-06-11` (4 files, chunk 560 ms)
Chunk size trades WER vs first-token latency: 1120 ms matches offline quality (R=13 ≈ byte-equal per transcribe.cpp docs), 80–160 ms is for live dictation. For file transcription any chunk yields the same final text quality class; 560 ms is the balanced default that also stays usable if we later wire pseudo-streaming. int8 over fp32: ~4× smaller (~0.6–0.7 GB vs ~2.4 GB), negligible WER delta, and it's what upstream CI validates on CPU. Files: `encoder.int8.onnx`, `decoder.int8.onnx`, `joiner.int8.onnx`, `tokens.txt`, pinned by the SHA-256s published on the HF repo (LFS pointers expose them — satisfies `ensure_sherpa_hash_pinned`'s fail-closed policy with zero new machinery).
*Alternative:* pin 1120 ms for best file WER — rejected as primary because it forecloses streaming reuse; the pinned constants make switching a one-line change.

### D2: Keep `HfRuntime::NemotronAsr` + logical key; change its artifact and contract
The UI identity (`nemotron-3.5-asr-0.6b`), catalog entry, prefer-local routing, and profile plumbing all key off the existing runtime/contract — none of that should churn. What changes: `resolve_pinned_nemotron_install_target` points at the ONNX repo/file set, and the run contract becomes the split-transducer file set. Introduce `RunContract::NemotronAsr` → **{encoder, decoder, joiner, tokens}** (replacing `{model_file: gguf}`), keeping `paths_contained()` containment checks. `stt_route_for_model` maps it to a route carrying the three model paths + tokens dir, and the engine dispatches to a new family. Registry rows for the old GGUF contract simply fail `verify_on_disk`/validation against the new pin — see D5.
*Alternative:* reclassify as `HfRuntime::SherpaOnnxStt` — rejected: loses the distinct catalog identity/label and drags the Nemotron entry through sherpa-agnostic detection paths.

### D3: Second sidecar `sherpa-online`, dispatched per-family
Provision the tarball's `bin/sherpa-onnx` (online) as externalBin `bin/sherpa-online` — a distinct name, because `sherpa-onnx` already *is* the offline binary in our bundle and existing families depend on that. Engine-side: extend `SherpaFamily` with `NemotronTransducer { encoder, decoder, joiner }`; `run_sherpa_sidecar` grows a binary parameter (offline for existing families, online for the new one). argv is identical to the Zipformer split branch; optional `--language` per-stream hint passes the user's language when not "auto" (auto = model's `prompt_index=101` auto-detect).
Output parsing: unlike the offline binary's single stderr JSON line, the online binary emits per-segment timestamped lines as it processes; the exact line format gets pinned by a smoke run in task 1 and a parser + unit tests added against the recorded fixture. Progress: reuse the existing Rust-side 30 s WAV chunking + synthetic per-chunk progress (sherpa path already does exactly this) — the online binary gives us real timestamps per chunk for free.
Cancellation: same as today's sherpa/whisper jobs (DB status + token; the child finishes its current chunk) — no new kill plumbing in this change.

### D4: sherpa-onnx version bump with marker-forced re-provision
Bump `SHERPA_VERSION` to the newest stable release containing PR #3671 (verify exact tag during implementation; ≥ the 1.13.x series). The existing `.sherpa-onnx-provisioned` marker/version check already re-provisions when the version changes — the online-binary copy lands in the same `ensureSherpa` flow (copy both `bin/sherpa-onnx-offline` → `sherpa-onnx` and `bin/sherpa-onnx` → `sherpa-online`, plus the same runtime libs/rpath/codesign steps). Extend `build.rs` placeholder seeding, the `dir_contains_sidecars`/`sidecar_for_model` prefixes, `.gitignore`, and all three verification scripts (`verify-deb-bundle.sh`, `verify-macos-bundles.sh`, `verify-transcription-sidecars.mjs` — smoke-run `sherpa-online --help`).

### D5: GGUF migration = honest supersession, no silent reuse
On update with an old GGUF install: `registry_is_installed` for the new pin returns false (different repo/files), so the entry offers the ONNX download — correct. The stale row must not linger invisibly: surface legacy GGUF installs in the HF manager as a "legacy artifact — free up space" removable entry (reuse the uninstall path; it already removes the install dir and row). Profiles/UI show not-installed until the ONNX set lands. No automatic deletion of user-downloaded data.
*Alternative:* auto-uninstall the GGUF — rejected: deletes ~0.5 GB of user data without consent.

### D6: Availability gating stays sidecar-driven
`is_nemotron_asr_installed`/routing gain a sidecar-usability check (the `check_sidecar_usable`/`is_sidecar_usable` pattern already used for whisper/sherpa: missing/placeholder binary ⇒ model not usable, download button hidden or warning shown). The routing layer then never dispatches to a guaranteed-missing runtime; cloud substitution rules apply unchanged. This retires the stub error path: `transcribe_file`'s "runtime not available" branch disappears, and `nemotron.rs` shrinks to path/backend helpers used by the new dispatch (its doubled-path regression tests move/adjust with the contract change).

## Risks / Trade-offs

- [Online-binary output format is CLI-stable but not contract-stable] Upstream could change line formatting between sherpa versions. → Mitigation: parser tolerant of extra whitespace/unknown lines, format pinned by a recorded fixture test, version marker pins the exact sherpa release.
- [Re-download cost] Users who just pulled the 495 MB GGUF must fetch ~0.6–0.7 GB of ONNX. → Mitigation: explicit release-note/UI wording; D5 makes the stale artifact visible and removable.
- [int8 accuracy] Slightly worse WER than Q8 GGUF/fp32. → Upstream CI validates int8; acceptable for transcription; pin constants make fp32 swap trivial if users complain.
- [Online binary on some distros fails to load onnxruntime] Same class of issue the offline binary already handles via rpath/LD_LIBRARY_PATH + macOS re-sign. → Same provisioning steps apply; verification scripts catch it at build time.
- [Streaming session expectation] Users may expect live dictation to go local too. → Scoped as non-goal with a concrete follow-up path (C API dylibs already bundled).

## Migration Plan

1. Land sidecar provisioning + version bump first (independently shippable; offline binary behavior unchanged).
2. Land artifact switch + engine dispatch + migration UI.
3. Rollback: revert the pin constants and family dispatch; the GGUF path is gone after D2 lands, so full rollback = revert the change (single commit series). Stale ONNX installs after a rollback mirror the GGUF case (superseded entry + cleanup affordance).

## Open Questions

- Exact sherpa-onnx release tag to pin (newest stable containing #3671) — resolve in task 1 by checking the releases page; no design impact.
- Exact online-binary output line format — pinned by smoke-run fixture in task 1; parser written against it.
