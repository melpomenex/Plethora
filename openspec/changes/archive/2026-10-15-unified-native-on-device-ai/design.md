# Design: Unified Native On-Device AI (Windows-first)

## Architecture map (existing)

```text
feature → runTask / runAiAction → resolveTaskRoute / resolveAiPath
              ↓
    getRoutingProviders(): [on-device family…] → CloudProvider
              ↓
    OnDeviceProvider (Android Nano) | AppleFoundationProvider | AppleCoreAiProvider
              ↓
    Tauri plugins (Kotlin / Swift) | commands/llm.rs (cloud)
```

**Decision:** Extend this spine. No second router. Windows adds two `AIProvider` implementations registered in the same registry.

```text
                         Plethora features
                                │
                    runTask / runAiAction
                                │
              ┌─────────────────┴─────────────────┐
              │     getRoutingProviders()         │
              └─────────────────┬─────────────────┘
                                │
     ┌──────────┬───────────┬───┴───┬──────────┬──────────┐
     │ Android  │ Apple FM  │ Win   │ Foundry │ Cloud/    │
     │ Nano     │ / Core AI │ System│ Local   │ Ollama    │
     └──────────┴───────────┴───────┴─────────┴──────────┘
```

## Provider precedence

Derived from existing `preferOnDevice` + `allowCloudFallback` (no third boolean):

| preferOnDevice | allowCloudFallback | Behavior |
|---|---|---|
| true | false | Try on-device family in registry order; **on-device failure does not cloud-retry** |
| true | true | On-device first; paid cloud retry with disclosure + consent |
| false | * | **Use configured provider only** — native AI not auto-selected |

**Explicit pin:** `settings.ai.preferredOnDeviceProviderId` reorders within the on-device family only.

**Default on-device order (Windows desktop):**

1. `ondevice-windows-system` (Phi Silica / Windows AI APIs when ready)
2. `ondevice-foundry-local` (Foundry Local when runtime + model ready)
3. Android Nano / Apple FM / Apple Core AI (platform-gated, inactive on Windows)
4. `CloudProvider`

**Local-only policy:** When `allowCloudFallback === false` and on-device fails, `runTask` MUST NOT invoke cloud. Diagnostics record `fallbackBlocked: true`.

**Pinned provider:** When a task pins `kind: "cloud"` or user disabled `preferOnDevice`, native providers are skipped entirely.

## Windows three-tier model

### Tier 1 — Windows AI APIs (`plethora-windows-intelligence`)

| API | Namespace | Maturity | Store | HW/OS | Plethora use |
|---|---|---|---|---|---|
| `LanguageModel` / Phi Silica | `Microsoft.Windows.AI.Text` | Stable + **LAF** | ✅ with LAF token | Win11 24H2+; NPU Copilot+ or GPU (experimental GPU path **not** in production build) | generate, summarize, classify, structured (text+validate) |
| `TextSummarizer` / `TextRewriter` | same | Stable | ✅ | Same as LM | optional fast paths |
| `TextRecognizer` (OCR) | `Microsoft.Windows.AI.Imaging` | Stable | ✅ | Copilot+ NPU only | import OCR routing |
| `ImageDescriptionGenerator` | Imaging | Stable | ✅ | Copilot+ NPU | image registry |
| Structured JSON | `Microsoft.Windows.AI.Text.Experimental` | Experimental | ❌ | — | **feature flag only** |
| Embeddings via LM | Text | Stable | ✅ | Same as LM | optional; index stays cross-platform |

**MSIX requirement:** Windows AI APIs require package identity + `systemAIModels` manifest capability. Plethora ships **NSIS** today → runtime probe returns `package_identity_missing`; Tier 1 inactive without crash.

**LAF:** Stable Phi Silica may require `LimitedAccessFeatures.TryUnlockFeature`. Token from env `PLETHORA_WINDOWS_AI_LAF_TOKEN` at runtime — **never committed**. Missing token → `limited_access_denied` readiness, not fake ready.

**Readiness states** (mapped to `FeatureState` + `AIErrorCategory`):

```text
ready | downloadable | downloading | unsupported_os | unsupported_hardware
package_identity_missing | limited_access_denied | disabled_by_user
model_deployment_failed | busy | unavailable | platform_unsupported
```

Authoritative source: `LanguageModel.GetReadyState()` / `AIFeatureReadyState` — never infer from GPU presence alone.

### Tier 2 — Foundry Local (`FoundryLocalProvider`)

| Field | Value |
|---|---|
| Interface | OpenAI-compatible `POST /v1/chat/completions` |
| Discovery | `GET /openai/status` or configured base URL |
| OS | Win10+ (product); Win11 recommended |
| Store | No experimental SDK restriction |
| LAF | None |
| Model download | User-initiated via settings; show name + size; no silent GB downloads |

`kind: "local-model"` on `AIProvider`. Distinct from keyless Ollama in `CloudProvider`.

### Tier 3 — Windows ML

**Extension path only** — no placeholder wrapper in this change. Document in `docs/architecture/native-ai.md` for custom ONNX when a Plethora workload needs it.

## IPC / native boundary

**Pattern:** Mirror `plethora-apple-intelligence` — Rust plugin, thin shim, typed commands.

```text
windows_capabilities
windows_lm_generate / windows_lm_generate_stream / windows_lm_cancel / windows_lm_warmup
windows_lm_ensure_ready
windows_ocr_status
```

**Windows implementation:** Rust `windows` crate WinRT bindings in `src/winrt/` module, `#[cfg(target_os = "windows")]`. Non-Windows: `platform_unsupported` snapshot.

**No .NET sidecar** — avoids second runtime; WinRT from Rust matches Tauri packaging.

**Security:** Commands accept bounded prompts (max bytes), typed JSON payloads, no arbitrary shell/model execution IPC.

## TypeScript contracts

| Module | Role |
|---|---|
| `src/lib/ai/windows/capabilities.ts` | TTL cache, `getWindowsIntelligenceSnapshot()` |
| `src/lib/ai/windows/languageModel.ts` | generate, stream, cancel, warmup |
| `src/lib/ai/foundryLocal/client.ts` | HTTP client, status, model list |
| `src/lib/ai/providers/windowsSystemProvider.ts` | `WINDOWS_SYSTEM_PROVIDER_ID` |
| `src/lib/ai/providers/foundryLocalProvider.ts` | `FOUNDRY_LOCAL_PROVIDER_ID` |

Extend `preferredOnDeviceProviderId` union with `ondevice-windows-system` | `ondevice-foundry-local`.

## Structured output strategy

1. If backend supports native structured (Android/Apple) → use schema compiler path.
2. Windows stable Phi Silica → strict-JSON preamble + `validate*` + one repair retry (existing `generateWithFallbacks`).
3. Experimental WinRT structured → only when `features.windowsAiExperimental === true` and dev build.
4. Never trust parse-only JSON; enforce size/count bounds per schema.

## Resource management

- Single shared `LanguageModel` instance per process (Rust `OnceLock` + mutex).
- Lazy init on first generation; `warmUp` optional from settings.
- Concurrent init: `try_lock` → `Busy` error, no duplicate model load.
- Cancel via `windows_lm_cancel(request_id)`; dispose context per request.
- App shutdown: drop model handle in plugin teardown.

## UX

**User-facing:** “System On-Device AI” — Available / Unavailable / Additional model required / Downloading.

**Diagnostics panel:** Backend, model name (Phi Silica / Foundry alias), execution on-device, network not required when true.

**Privacy chip:** Existing `onDeviceRunLabel()` — only when actual path is on-device; changes if cloud fallback occurred.

## Privacy & logging

- No document bodies in `log::` / `console` for AI paths.
- Native errors sanitized to `AIError` before UI.
- Local-only tasks never call cloud health checks first.

## Adversarial review findings (incorporated)

| Finding | Resolution |
|---|---|
| NSIS cannot use Phi Silica | Runtime `package_identity_missing`; Foundry Local is practical Tier 2 |
| Experimental APIs block Store | Production build excludes experimental WinRT; flag-gated only |
| LAF token in repo | Env var only; graceful degrade |
| Duplicate provider registry edits | Single owner: `providers/index.ts` |
| Cloud hijack when user picked OpenRouter | `preferOnDevice: false` skips native |
| Smart Tagging depends on AI | Tier 1 baseline unchanged |
| Cross-platform vector corruption | No Windows-only embedding store; optional embed bridge only |
| Concurrent Phi init race | Mutex + Busy |
| 500-page summarize silent truncate | Existing chunk/reduce in `runChunkedGeneration` / task timeouts |
| Foundry absent exception loop | Typed `RuntimeUnavailable`, no retry storm |

## CI

- GitHub Actions: `windows-latest` job — `cargo check` (plugin + main), `npm run check` (or project TS gate).
- Hardware integration tests marked `#[ignore]` / vitest `skip` with `requires-windows-ai-hardware` tag.

## Rollout

1. Ship plugin + providers behind no flag (detection-gated).
2. Enable Smart Tagging + passage routing automatically when ready.
3. Foundry Local opt-in via settings toggle `foundryLocal.enabled`.

## Acceptance criteria

See proposal + spec scenarios. Implementation complete when tests pass and Windows compiles in CI.
