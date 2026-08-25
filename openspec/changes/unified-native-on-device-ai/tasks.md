# Tasks: Unified Native On-Device AI

## 1. Rust plugin — plethora-windows-intelligence

- [x] 1.1 Create plugin crate (`Cargo.toml`, `build.rs`, permissions scaffold)
- [x] 1.2 Implement `FeatureState`, `WindowsIntelligenceSnapshot`, error types
- [x] 1.3 Non-Windows stubs (`platform_unsupported`)
- [x] 1.4 Windows: package identity probe + OS version gate
- [x] 1.5 Windows: WinRT language model bridge (generate, stream, cancel, warmup, ensure_ready) — structure + IPC text field; WinRT bindings pending
- [x] 1.6 Windows: LAF unlock from env token (optional)
- [x] 1.7 Windows: OCR readiness probe
- [x] 1.8 Register plugin in `src-tauri/Cargo.toml` and `lib.rs`

## 2. TypeScript bridges

- [x] 2.1 `src/lib/ai/windows/capabilities.ts` — snapshot + cache
- [x] 2.2 `src/lib/ai/windows/languageModel.ts` — invoke wrappers
- [x] 2.3 `src/lib/ai/foundryLocal/client.ts` — HTTP status + chat
- [x] 2.4 `src/lib/ai/foundryLocal/types.ts`

## 3. AIProvider implementations

- [x] 3.1 `windowsSystemProvider.ts`
- [x] 3.2 `foundryLocalProvider.ts`
- [x] 3.3 Extend `providers/index.ts` routing order
- [x] 3.4 Extend `provider.ts` `resolveAiPath` for Windows desktop
- [x] 3.5 Extend `settingsStore` types + defaults + feature flags

## 4. Settings & UX

- [x] 4.1 Extend `OnDeviceAiPanel.tsx` for Windows + Foundry status
- [x] 4.2 Foundry Local settings section (enable, base URL, model)
- [x] 4.3 i18n keys for System On-Device AI copy

## 5. Feature integration

- [x] 5.1 Smart tagging tier 2 — via runTask routing
- [x] 5.2 Passage actions — via runAiAction / resolveAiPath
- [ ] 5.3 Route `AIWorkflowsPage` title/summarize through task layer (legacy path remains; optional follow-up)

## 6. Tests

- [x] 6.1 `windowsSystemProvider.test.ts` — capabilities mapping
- [x] 6.2 `foundryLocalProvider.test.ts` — routing + errors
- [x] 6.3 `nativeAiRouting.test.ts` — precedence, local-only, preferOnDevice false
- [x] 6.4 Tier-2 on-device fallback in `runTask.ts`

## 7. CI & docs

- [x] 7.1 Windows compile job in GitHub Actions (`ci-regression.yml`)
- [x] 7.2 `docs/architecture/native-ai.md`
- [x] 7.3 User guide section for System On-Device AI (`smart-tagging.md`)

## 8. OpenSpec

- [x] 8.1 Mark tasks complete in this file as work lands

## Remaining (genuine limitations)

- WinRT `LanguageModel` inference not wired — returns `winrt_bindings_pending` until Microsoft WinRT projections are integrated; NSIS builds report `package_identity_missing` for Tier 1.
- Phi Silica hardware integration tests require Copilot+ / MSIX + LAF on physical Windows hardware (not run in CI).
- Legacy `commands/ai.rs` desktop summarize/title still cloud-only (task-layer migration deferred).
