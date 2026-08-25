## 1. OpenSpec and architecture

- [x] 1.1 Create corrective OpenSpec `complete-macos-apple-foundation-models`
- [x] 1.2 Document macOS C ABI + iOS parity architecture in design.md

## 2. Native macOS bridge

- [x] 2.1 Add `macos/` Swift package with C ABI exports and weak FoundationModels link
- [x] 2.2 Add `shared/FmBridgeCore.swift` shared by iOS and macOS
- [x] 2.3 Implement real availability, generate, stream, cancel, count, warmup
- [x] 2.4 Implement `@Generable` wire types for smartTagging, libraryAnswer, generatedFlashcards
- [x] 2.5 Add `src/macos_bridge.rs` Rust FFI wrapper with event emission
- [x] 3.1 Update `build.rs` to compile macOS Swift static library
- [x] 3.2 Route `#[cfg(target_os = "macos")]` commands to macOS bridge
- [x] 3.3 Keep Linux/Windows/iOS paths unchanged except iOS FM fixes
- [x] 4.1 Refactor `FoundationModelsBridge.swift` to use shared core
- [x] 4.2 Fix availability, instructions, content extraction, streaming, cancellation
- [x] 5.1 Add `appleFmGenerateStream` with event listeners
- [x] 5.2 Pass structured/schemaName to native bridge
- [x] 5.3 Update capabilities (streaming, structured) from live availability
- [x] 6.1 Improve macOS Apple Intelligence status labels in OnDeviceAiPanel
- [x] 7.1 Vitest: routing, availability matrix, cancellation, privacy
- [x] 7.3 Run typecheck, vitest, cargo check (macOS), plugin tests
- [x] 8.1 Pass 1 adversarial review
- [x] 8.2 Fix BLOCKER/HIGH findings from pass 1
- [x] 8.3 Pass 2 re-review
