## Why

Plethora already routes generative AI through a unified `AIProvider` + `runTask` stack with Android Gemini Nano and Apple Foundation Models, but **Windows desktop has no native on-device path** — every lightweight task (smart tagging, summarization, passage actions) falls through to configured cloud providers or fails. Microsoft now ships **Windows AI APIs (Phi Silica)**, **Foundry Local** (OpenAI-compatible local LLMs), and **Windows ML** on Windows 11. Plethora must extend the **existing** provider layer rather than bolt on an isolated Windows subsystem, while preserving explicit user provider choice and local-only guarantees.

## What Changes

- Add **System On-Device AI** as a first-class provider family on Windows desktop alongside existing Nano / Apple FM backends.
- Introduce `plethora-windows-intelligence` Tauri plugin: capability snapshots, Phi Silica `LanguageModel` integration (stable channel), OCR readiness probes, lifecycle/cancellation — with **non-Windows stubs** matching the Apple plugin pattern.
- Add **Foundry Local** adapter (`FoundryLocalProvider`) using the official OpenAI-compatible REST surface as Tier-2 local fallback when Phi Silica is unavailable or the app lacks MSIX package identity.
- Extend `getRoutingProviders()` ordering: Windows System AI → Foundry Local → existing on-device → cloud; **never override** an explicit user-selected cloud/local provider when `preferOnDevice` is false.
- Extend `resolveAiPath()` and `preferredOnDeviceProviderId` for Windows backends.
- Runtime capability detection with typed readiness states (ready, downloadable, unsupported OS/hardware, package identity missing, LAF denied, busy).
- Structured output: stable text generation + JSON validation/repair; **experimental** schema-constrained APIs only behind `features.windowsAiExperimental` (not required for production builds).
- Integrate native routing into **Smart Tagging Tier 2**, passage summarize/simplify, and legacy `commands/ai.rs` title/summarize paths via task layer.
- Settings / diagnostics UI: neutral “System On-Device AI” copy; backend detail view (Phi Silica / Foundry Local / accelerator when known).
- Tests for routing, fallback policy, cancellation, malformed structured output; Windows **compile** CI job.
- Developer + user documentation for availability, privacy, and fallback behavior.

## Capabilities

### New Capabilities

- `windows-native-ai`: Windows AI APIs plugin, Phi Silica integration, capability detection, LAF handling, MSIX/package-identity semantics, OCR readiness.
- `foundry-local-provider`: Foundry Local discovery, model status, OpenAI-compatible inference adapter, user-consented model download policy.
- `native-ai-routing`: Cross-platform on-device provider registry extensions, precedence rules, local-only enforcement.

### Modified Capabilities

- `ai-task-architecture`: Provider registry ordering, `preferredOnDeviceProviderId` union, Windows desktop path in `resolveAiPath`.
- `ai-capability-surface`: Platform capability descriptors for Windows OCR / speech readiness (detection only; no Whisper replacement).

## Impact

- **TypeScript:** `src/lib/ai/providers/`, `provider.ts`, `windows/`, `foundryLocal/`, `settingsStore.ts`, `OnDeviceAiPanel.tsx`, smart tagging + passage tasks.
- **Rust:** new `plugins/plethora-windows-intelligence/`, `src-tauri/src/lib.rs` registration, optional `embeddings_backend` bridge.
- **CI:** `.github/workflows/` Windows compile check.
- **Docs:** `docs/architecture/native-ai.md`, user-guide on-device section.
- **Dependencies:** `windows` crate (WinRT, Windows-only); no experimental Windows App SDK packages in default release builds.
- **Packaging:** NSIS builds continue; Phi Silica requires MSIX package identity — detected at runtime, not assumed. Optional future MSIX target documented in design.

## Non-goals

- Replacing whisper.cpp / sherpa-onnx STT with Windows Speech API in this change.
- Migrating entire semantic index to Windows-only embedding APIs (cross-platform SQLite vectors remain source of truth).
- Windows ML custom ONNX workloads without a concrete Plethora consumer.
- MSIX-only Store distribution migration (documented extension path only).
- Silent multi-gigabyte model downloads.
