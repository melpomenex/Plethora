# Tasks: Unified Native On-Device AI

## 1. Rust plugin — plethora-windows-intelligence

- [x] 1.1 Create plugin crate (`Cargo.toml`, `build.rs`, permissions scaffold)
- [x] 1.2 Implement `FeatureState`, `WindowsIntelligenceSnapshot`, error types
- [x] 1.3 Non-Windows stubs (`platform_unsupported`)
- [x] 1.4 Windows: package identity probe + OS version gate
- [x] 1.5 Windows: WinRT language model bridge (generate, stream events, cancel, warmup, ensure_ready)
- [x] 1.6 Windows: LAF unlock via `TryUnlockFeature` (token + attestation env vars)
- [x] 1.7 Windows: OCR readiness probe via `TextRecognizer::GetReadyState`
- [x] 1.8 Register plugin in `src-tauri/Cargo.toml` and `lib.rs`

## 2. TypeScript bridges

- [x] 2.1 `src/lib/ai/windows/capabilities.ts` — snapshot + cache + diagnostics
- [x] 2.2 `src/lib/ai/windows/languageModel.ts` — invoke wrappers + stream listeners
- [x] 2.3 `src/lib/ai/foundryLocal/client.ts` — HTTP status + chat + stream
- [x] 2.4 `src/lib/ai/foundryLocal/types.ts`

## 3. AIProvider implementations

- [x] 3.1 `windowsSystemProvider.ts`
- [x] 3.2 `foundryLocalProvider.ts`
- [x] 3.3 Extend `providers/index.ts` routing order
- [x] 3.4 Extend `provider.ts` `resolveAiPath` for Windows desktop
- [x] 3.5 Extend `settingsStore` types + defaults + feature flags

## 4. Settings & UX

- [x] 4.1 Extend `OnDeviceAiPanel.tsx` for Windows + Foundry status + diagnostics
- [x] 4.2 Foundry Local settings section (enable, base URL, model)
- [x] 4.3 i18n keys for System On-Device AI copy

## 5. Feature integration

- [x] 5.1 Smart tagging tier 2 — via runTask routing
- [x] 5.2 Passage actions — via runAiAction / resolveAiPath
- [x] 5.3 AI Workflows page — via `workflowTasks` + `runTask`
- [x] 5.4 Extract inbox, X thread viewer, tag suggestions, conversational review — unified router

## 6. Tests

- [x] 6.1 `windowsSystemProvider.test.ts` — capabilities mapping
- [x] 6.2 `foundryLocalProvider.test.ts` — routing + errors
- [x] 6.3 `nativeAiRouting.test.ts` — precedence, local-only, preferOnDevice false
- [x] 6.4 Tier-2 on-device fallback in `runTask.ts`

## 7. CI & docs

- [x] 7.1 Windows compile job in GitHub Actions (`ci-regression.yml`)
- [x] 7.2 Sparse identity MSIX build on Windows CI/release
- [x] 7.3 Optional full MSIX artifact on release
- [x] 7.4 `verify-windows-bundles.ps1` checks `PlethoraIdentity.msix`
- [x] 7.5 `docs/architecture/native-ai.md`

## 8. OpenSpec

- [x] 8.1 Mark tasks complete in this file as work lands

## Remaining (cannot close in repo alone)

- End-to-end Phi Silica inference on Copilot+ hardware with Microsoft-issued LAF credentials
- Store-signed MSIX / Microsoft Store submission pipeline
- WinRT token-by-token streaming (current path emits full text as one chunk + complete event)
- Windows imaging OCR inference routing in import pipeline (readiness probe only today)
- Aion Instruct migration when Microsoft retires Phi Silica (documented by Microsoft for late 2026)
