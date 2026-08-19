# Change: AI Billing Safety — Paid Embedding and TTS Operation Guards

Covers numbered requirement **#14 (guard against accidental OpenRouter embedding/TTS charges)**.

## Why

Plethora supports OpenRouter/provider-driven AI features, and investigation found several places where **an API key silently authorizes billable work with no opt-in**:

1. **Embeddings default to a billable cloud provider.** `src/config/defaultSettings.ts:278–289` defaults `embedding.provider: "openai"` with `text-embedding-3-small`; cloud keys are borrowed from the LLM providers store (`src/components/assistant/ragConfig.ts:33–48`). The whole-library index CTA in `src/components/settings/AiIndexPanel.tsx:174–177` enables indexing and immediately enqueues the library; the only "gate" is a battery heuristic (`require_charging` in `src-tauri/src/commands/ai_learning.rs`), **not a billing/consent gate**. A query-side `embed_text` on every retrieval is also billable for cloud providers.
2. **TTS defaults to a billable provider.** `src/utils/ttsSettings.ts:341–359` defaults `provider: "fal"`; OpenRouter TTS silently borrows the OpenRouter LLM key (`src/api/tts/providers/openrouter.ts:36–40`, `auth.ts`). Read-aloud pre-buffers 60 s ahead (up to 3 concurrent generations), audio editions (`audioEditionGenerationStore.startJob`) can bill OpenRouter/ElevenLabs/OpenAI, and voice previews have a one-time confirm but generation does not.
3. **Silent local→paid fallback.** `src/lib/ai/provider.ts` `runAiAction` retries on the configured cloud provider when on-device fails (line 116), gated only by `allowCloudFallback` which **defaults to true** (`settingsStore.ts:1018`) — informational toast only, no confirmation.
4. **No global cost/consent infrastructure.** `billingStore.ts` is subscription/entitlements, not API spend. No spend cap exists. Confirmation patterns to reuse: `useModal().confirm` (`AiIndexPanel.tsx:183–187`, `VoiceBrowser.tsx:111–131`); `window.confirm` is suppressed in the desktop WebView and must not be used.

## What Changes

Establish a coherent policy: **API keys authorize, they do not consent.** Define explicit enablement for paid embeddings and paid TTS/voice; visible indication when a configured option uses an external paid API; no silent free/local→paid fallback; confirmation before unusually large one-time jobs; estimated workload/cost where reasonably calculable (never promise exact dollar estimates when pricing is unavailable/dynamic); and configurable spending/usage safeguards where existing infrastructure supports them. The critical acceptance criterion: **Plethora must not silently trigger potentially expensive OpenRouter embedding or voice workloads simply because a provider API key exists.**

### 1. Paid-operation consent model (see spec)
Add persisted consent settings (in `settingsStore`, the established persistence):
- `embedding.paidEmbeddingsEnabled` (default false) — explicit enablement for paid/cloud embeddings.
- `tts.paidTtsEnabled` (default false) — explicit enablement for paid/cloud TTS/voice generation.
These gate every billable call path; the first time a paid operation is attempted while disabled, surface the appropriate opt-in UX (settings row + one-time confirmation), never silently perform the work.

### 2. Visible paid-provider indication (see spec)
Show a clear "paid/external API" indicator wherever a billable provider/model is configured or selected (embedding settings, TTS settings/voice picker, audio-edition dialog, indexing panel), so a user sees when a configured option uses an external paid API.

### 3. No silent free→paid fallback (see spec)
`runAiAction`'s cloud fallback and the embedding/OCR free→cloud fallbacks SHALL NOT run silently: they require the relevant paid-consent flag (or a confirmation) before invoking a billable provider. `allowCloudFallback` default SHALL be reconsidered (default off or requiring consent) — changing it must be deliberate.

### 4. Large one-time job confirmation + estimates (see spec)
Bulk library indexing, whole-library semantic-graph embedding, and audio-edition generation SHALL show a pre-flight confirmation including a workload estimate (number of chunks/items × model) and an estimated cost when calculable from known pricing (reuse `audioEditionEstimation.ts` patterns, `PROVIDER_PRICING_DEFAULTS`); when pricing is unknown/dynamic, say so instead of fabricating a number.

### 5. Enforcement location (see spec)
Enforce the consent gate both in the frontend (avoid sending requests) and defensively in Rust where cheap (reject cloud-embedding/cloud-TTS commands when the explicit consent flag is absent), matching the existing `ai_learning` command surface.

## Impact

### Affected Specs
- `paid-ai-operation-guards` (new, #14)

### Affected Code Areas
- `src/stores/settingsStore.ts` (consent flags + defaults + migration), `src/config/defaultSettings.ts`, `src/types/settings.ts`, `src/utils/settingsValidation.ts`
- `src/components/settings/EmbeddingSettings.tsx`, `AiIndexPanel.tsx`, `src/components/assistant/ragConfig.ts` (embedding path)
- `src/utils/ttsSettings.ts`, `src/api/tts.ts` (`generateSpeech`), `src/api/tts/providers/openrouter.ts`, `src/api/tts/auth.ts`, `src/components/settings/TTSSettings.tsx`, `VoiceBrowser.tsx`, `src/components/audio/CreateAudioEditionDialog.tsx`, `src/stores/audioEditionGenerationStore.ts` (TTS path)
- `src/lib/ai/provider.ts` (`runAiAction`/`allowCloudFallback`), `src/utils/aiExtractUtils.ts`, `src/utils/documentAutoExtract.ts` (fallback path)
- `src/components/common/Modal.tsx`/`ConfirmDialog.tsx` (confirmation reuse)
- `src-tauri/src/commands/ai_learning.rs`, `src-tauri/src/ai/embeddings.rs`, `src-tauri/src/commands/ai.rs` (defensive gates)

### Non-goals
- No per-request dollar billing integration with providers (no API to do this reliably).
- No change to free/local paths (system TTS, pocket, android, local whisper, on-device AI).
- No removal of existing features; only gating + disclosure.