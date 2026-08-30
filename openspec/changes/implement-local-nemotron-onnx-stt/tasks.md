## 1. Spike: pin the runtime facts

- [x] 1.1 Identify the exact sherpa-onnx stable release containing PR #3671 (≥1.13.x): confirm the online binary + Nemotron transducer flags in that tag, note the release asset names per desktop triple
- [x] 1.2 Smoke-run the online binary from that tarball against `sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11` on a test wav; record the exact per-segment output line format to a fixture file (`src-tauri/src/transcription/__fixtures__/sherpa-online-nemotron-output.txt`) that the parser tests will use
- [x] 1.3 Record the pinned constants from the HF repo (`csukuangfj2/…`): per-file SHA-256s + sizes for encoder/decoder/joiner int8 + tokens.txt

## 2. Sidecar provisioning + packaging (shippable standalone)

- [x] 2.1 In `scripts/download-sidecars.js`: bump `SHERPA_VERSION` to the release from 1.1; copy the tarball's online binary to `bin/sherpa-online-<triple>` alongside the existing offline copy, with the same lib/rpath/codesign/DLL handling; marker version forces re-provision
- [x] 2.2 `src-tauri/tauri.conf.json` externalBin += `bin/sherpa-online`; platform resource globs/DLL map updated if the online binary needs extra runtime libs
- [x] 2.3 `src-tauri/build.rs`: add `sherpa-online` to placeholder seeding and to the macOS rpath/codesign name filter; `engine.rs` `dir_contains_sidecars`/`model_manager.rs` `sidecar_for_model` prefixes updated
- [x] 2.4 `.gitignore` += `src-tauri/bin/sherpa-online-*`; extend `verify-deb-bundle.sh`, `verify-macos-bundles.sh` (incl. codesign verify), and `verify-transcription-sidecars.mjs` (smoke `sherpa-online --help`) to cover the new binary
- [x] 2.5 Fresh-clone build check: `npm run build` provisions both sherpa binaries; `cargo check`/`cargo test` pass with placeholders on a clean tree

## 3. Model artifact switch (Rust)

- [x] 3.1 Replace the pinned constants in `manager.rs`: repo `csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11`, the 4-file set with SHA-256s/sizes from 1.3; catalog entry size/labels updated
- [x] 3.2 Change `RunContract::NemotronAsr` to `{ encoder, decoder, joiner, tokens }` (update `paths_contained`, serde shape, and all constructors); `resolve_pinned_nemotron_install_target` builds the 4-file spec; keep the logical key and `HfRuntime::NemotronAsr` unchanged
- [x] 3.3 `stt_route_for_model`: the Nemotron route carries the three model paths + tokens (extend `SttEngineRoute::Nemotron` fields accordingly); unit tests for route resolution + containment with the new contract
- [x] 3.4 Hash-pinning: confirm `ensure_sherpa_hash_pinned` covers the new runtime's 4 files (all must carry pinned SHA-256s) and add a test asserting a hash-less spec refuses to install

## 4. Engine dispatch + inference

- [x] 4.1 `engine.rs`: add `SherpaFamily::NemotronTransducer` with encoder/decoder/joiner; parameterize `run_sherpa_sidecar` with the binary (offline vs `sherpa-online`); argv identical to the Zipformer split branch + optional `--language` hint when not "auto"
- [x] 4.2 Implement the online-binary output parser against the 1.2 fixture (tolerant of unknown lines); unit tests: multi-segment parse, timestamps in ms, malformed lines skipped
- [x] 4.3 Route `SttEngineRoute::Nemotron` through the new family in `transcribe_route`, reusing the existing 30 s chunking + synthetic progress; retire `nemotron.rs::transcribe_file`'s runtime-unavailable stub (move/adjust its path tests to the new contract)
- [x] 4.4 `transcribe_local_nemotron` and the job/auto-queue paths verify sidecar usability before dispatch (`check_sidecar_usable("sherpa-online")`) with the actionable missing-sidecar error
- [x] 4.5 Rust tests: route → family dispatch for the ONNX contract; missing-sidecar gating; end-to-end unit test of the parser+chunk assembly with the fixture

## 5. Migration + frontend

- [x] 5.1 Legacy GGUF handling: registry rows/dirs from the old pin surface as a removable "legacy artifact" entry in the HF manager (reuse uninstall); never auto-deleted; profiles show not-installed until the ONNX set lands
- [x] 5.2 Model manager + transcription settings show the new artifact metadata (size ≈ sum of 4 files, file list) via existing catalog plumbing; download UX unchanged
- [x] 5.3 Update user-facing copy where the GGUF/Q4_K_M size (495 MB) is referenced (settings hints, docs) to the ONNX set size
- [ ] 5.4 Frontend tests: catalog/profile shape with the new file set; legacy-entry cleanup action. (Catalog/profile shape is backend-driven and pinned by the Rust route/profile tests; legacy-row listing + filtering is pinned in manager.rs tests; frontend suites re-run green — a component-level cleanup test still to add if wanted)

## 6. Verification

- [x] 6.1 `cd src-tauri && cargo test` green (new route/contract/parser/provisioning tests included)
- [x] 6.2 Frontend suite + `npm run test:scripts` green; `npx tsc --noEmit` clean. (Affected suites: 82/82 green; tsc clean; scripts 201/203 with the same 2 pre-existing macOS-only failures as main; the 4 full-suite failures in QueueScroll/privacy/OCR reproduce identically on clean main and are unrelated)
- [x] 6.3 `npm run bench:check` — no regression expected. Gate is environment-red: clean main failed 24 budgets vs branch 16 in back-to-back runs, with the differing names (DOM/canvas/tabs benchmarks) flipping between runs — no benchmarked path is touched, no baseline update per the AGENTS.md protocol
- [ ] 6.4 (needs the running app) Manual smoke: install the ONNX set from the UI, transcribe a podcast fully offline, check legacy GGUF cleanup affordance. Pre-verified outside the app: sherpa-online v1.13.6 runs the pinned model with the engine's exact argv (correct transcript, RTF 0.2 @ 4 threads), provisioning script provisions both binaries end-to-end
