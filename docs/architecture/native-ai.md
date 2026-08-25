# Native On-Device AI Architecture

Plethora routes AI tasks through a single spine — `runTask` / `runAiAction` → `resolveTaskRoute` → `getRoutingProviders()` — without a second router. Native backends are ordinary `AIProvider` implementations registered beside cloud and Ollama providers.

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

User-facing copy uses neutral **System On-Device AI** labels on Windows (not Microsoft product jargon in primary UI strings).

---

## Provider precedence

Behavior is derived from existing settings — no third boolean:

| `preferOnDevice` | `allowCloudFallback` | Behavior |
|---|---|---|
| `true` | `false` | Try on-device family in registry order; **on-device failure does not cloud-retry** |
| `true` | `true` | On-device first; paid cloud retry with disclosure + consent |
| `false` | * | **Use configured provider only** — native AI is not auto-selected |

**Pin within on-device family:** `settings.ai.preferredOnDeviceProviderId` reorders only among on-device backends (`ondevice-gemini-nano`, `ondevice-apple-foundation`, `ondevice-apple-coreai`, `ondevice-windows-system`, `ondevice-foundry-local`).

**Default on-device order (Windows desktop):**

1. `ondevice-windows-system` — Windows AI APIs (Phi Silica / LanguageModel) when ready
2. `ondevice-foundry-local` — Foundry Local when runtime + model are healthy
3. Platform-gated Android Nano / Apple Foundation / Apple Core AI (inactive on Windows)
4. `CloudProvider`

When `allowCloudFallback === false` and every on-device path fails, `runTask` **must not** invoke cloud. Diagnostics record `fallbackBlocked: true`.

When a task pins `kind: "cloud"` or the user sets `preferOnDevice: false`, native providers are skipped entirely.

---

## Windows three-tier model

### Tier 1 — System On-Device AI (`plethora-windows-intelligence`)

Rust Tauri plugin exposing typed commands:

- `windows_capabilities` — snapshot with per-feature readiness
- `windows_lm_generate` / `windows_lm_generate_stream` / `windows_lm_cancel` / `windows_lm_warmup`
- `windows_ocr_status`
- `windows_ocr_recognize`
- `windows_lm_diagnostics` — extended hardware validation snapshot

TypeScript entry: `getWindowsIntelligenceSnapshot()` in `src/lib/ai/windows/capabilities.ts`.

| Feature | API area | Plethora use |
|---|---|---|
| LanguageModel / Phi Silica | `Microsoft.Windows.AI.Text` | generate, summarize, classify, structured text tasks |
| TextSummarizer / TextRewriter | same | optional fast paths |
| TextRecognizer (OCR) | `Microsoft.Windows.AI.Imaging` | `ocr_image_bytes` / import pipeline via `WindowsSystem` provider |
| ImageDescriptionGenerator | Imaging | image registry |
| Embeddings via LM | Text | optional; library index stays cross-platform |

**MSIX / package identity:** Windows AI APIs require package identity and `systemAIModels` manifest capability. Plethora ships **NSIS** today. NSIS installs bundle a **sparse identity package** (`PlethoraIdentity.msix`) that registers at startup via `AddPackageByUriAsync` with `ExternalLocationUri` pointing at the install directory. The main binary embeds matching MSIX identity metadata in `windows/app.manifest`. If registration fails, the probe returns `package_identity_missing`; Tier 1 stays inactive without crashing. Foundry Local is the practical on-device path until identity + LAF + hardware are satisfied.

**Full MSIX distribution:** `scripts/build-windows-msix-package.ps1` packages a release staging directory into `windows/msix/out/Plethora.msix` for Store or sideload distribution (dev-signed; production requires a store certificate). This is a second bundle target alongside NSIS in release workflows.

**Phi Silica WinRT bridge:** `plethora-windows-intelligence/cpp/PhiSilicaBridge.cpp` calls `LanguageModel::GenerateResponseAsync` when compiled with `PLETHORA_PHI_SILICA_CPP` (requires Microsoft Windows App SDK at build time). Without the SDK, `phiBridgeAvailable` is false and generation returns `winrt_bindings_pending`.

**Hardware validation:** Settings → On-device AI → **Diagnostics** invokes `windows_lm_diagnostics` (package identity, bridge availability, ready state, LAF token presence, sparse MSIX search paths). On physical Copilot+ hardware, also run `scripts/smoke-windows-ai-diagnostics.ps1`.

**Limited Access Feature (LAF):** Stable Phi Silica requires `LimitedAccessFeatures.TryUnlockFeature` with feature id `com.microsoft.windows.ai.languagemodel` (override via `PLETHORA_WINDOWS_AI_LAF_FEATURE_ID`). Set `PLETHORA_WINDOWS_AI_LAF_TOKEN` and `PLETHORA_WINDOWS_AI_LAF_ATTESTATION` from Microsoft's LAF email — never commit. Missing token → `limited_access_denied`.

**Readiness states** (mapped to `FeatureState`):

```text
available | downloadable | downloading | unavailable
package_identity_missing | limited_access_denied | unsupported_os | unsupported_hardware
disabled_by_user | model_deployment_failed | busy | platform_unsupported
```

Authoritative source: `LanguageModel.GetReadyState()` — never infer readiness from GPU/NPU presence alone.

Non-Windows builds compile stub implementations; `windows_capabilities` returns `platform_unsupported`.

### Tier 2 — Foundry Local (`FoundryLocalProvider`)

| Field | Value |
|---|---|
| Provider id | `ondevice-foundry-local` |
| Kind | `local-model` |
| Interface | OpenAI-compatible `POST /v1/chat/completions` |
| Discovery | `GET {baseUrl}/openai/status` |
| Settings | `foundryLocal.enabled`, `foundryLocal.baseUrl`, `foundryLocal.modelAlias` |
| Opt-in | **Off by default** — user enables in Settings → On-device AI |

Distinct from keyless Ollama in `CloudProvider`. Model downloads are user-initiated in Foundry Local; Plethora never starts multi-gigabyte downloads silently.

When `foundryLocal.enabled` is false, `FoundryLocalProvider` is omitted from the registry.

### Tier 3 — Windows ML

Extension path only — custom ONNX workloads when a Plethora feature needs them. No placeholder wrapper in the baseline stack; document here for future work.

---

## Other platforms (existing)

| Platform | Provider | Capability probe |
|---|---|---|
| Android | Gemini Nano / LiteRT | `isOnDeviceAiAvailable()` |
| Apple | Foundation Models, Core AI | `getAppleIntelligenceSnapshot()` |

Settings UI: `OnDeviceAiPanel.tsx` — platform sections gated by runtime detection.

---

## Structured output

1. Native structured backends (Android / Apple) → schema compiler path when supported.
2. Windows Phi Silica → strict-JSON preamble + `validate*` + one repair retry (`generateWithFallbacks`).
3. Experimental WinRT structured APIs → only when `features.windowsAiExperimental` and dev build.
4. Never trust parse-only JSON; enforce size/count bounds per schema.

Smart Tagging tier 2 validates LLM JSON; malformed output falls back to tier 1 baseline without persisting invalid tags.

---

## Privacy and logging

- No document bodies in logs for AI paths.
- Native errors sanitized to `AIError` before UI.
- Local-only tasks never call cloud health checks first.
- Privacy chip (`onDeviceRunLabel()`) shows on-device processing only when the actual execution path stayed on-device; it clears if cloud fallback occurred.

**Settings surface (Windows):**

- **System On-Device AI** — readiness from `getWindowsIntelligenceSnapshot()`
- **Foundry Local** — enable toggle, base URL, model alias, connection test
- **Prefer on-device AI** / **Allow cloud fallback** — shared with Android and Apple

---

## IPC boundary

Mirror `plethora-apple-intelligence`:

```text
Frontend (TypeScript)
    invokeWindows("windows_capabilities")
        ↓
Rust plugin (plethora-windows-intelligence)
    WinRT bindings (windows crate), #[cfg(target_os = "windows")]
        ↓
Windows AI APIs / stubs on other OSes
```

Foundry Local bypasses Tauri — pure HTTP from the webview to `127.0.0.1`.

Commands accept bounded prompts, typed JSON payloads, no arbitrary shell execution over IPC.

---

## Known gaps (honest close-out)

| Area | Status |
|------|--------|
| Phi Silica on Copilot+ hardware | Bridge + LAF wired; needs physical device + Microsoft token |
| WinRT token streaming | Full response emitted as one chunk + `complete` event |
| OCR / imaging inference | `TextRecognizer::RecognizeTextFromImageAsync` wired through `WindowsSystemOCRProvider` |
| Store MSIX | Dev-signed artifact on release; no Store pipeline |
| Aion Instruct | Microsoft plans Phi Silica replacement; monitor platform docs |

Legacy Rust `summarize_content` / `generate_title` remain as **cloud-only** `cloudExecutor` fallbacks for tasks that pin `kind: "cloud"`.

---

## Related docs

- Smart Tagging tier 1/2 fallback: `docs/user-guide/smart-tagging.md`
- Apple on-device AI (handbook): `docs/USER_HANDBOOK.md` § Apple Foundation Models
- OpenSpec change: `openspec/changes/unified-native-on-device-ai/`
