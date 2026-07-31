# Add OpenRouter TTS + multi-provider voice catalog

## Why

Incrementum's TTS is limited to four hardcoded providers (`fal`, `groq`, `pocket`, `system`) with 33 hand-listed voices and no way to pick a model. Users already configure an OpenRouter key for AI summaries and flashcards, and OpenRouter now ships a first-class TTS endpoint (`POST /api/v1/audio/speech`) fronting **19 speech models from ~12 vendors** — Fish Audio, MiniMax, Deepgram Aura-2 (90 voices), Google Gemini TTS (30 voices), xAI Grok, Microsoft MAI-Voice-2, Qwen, Kokoro (54 voices), Orpheus, Sesame, Zonos, and Mistral Voxtral. Reusing the key the user already has turns one integration into a dozen voice vendors and hundreds of voices, at prices from $0.62 to $100 per million input tokens.

The current UI cannot express that: provider is a `<select>`, model is a free-text input, and voice is a flat dropdown over a `TTSProvider` union baked into four separate `if/else` chains. Adding voices under today's structure would produce an unusable 200-item dropdown.

## What Changes

- **New `openrouter` TTS provider** that reuses the OpenRouter key already stored in `llmProvidersStore`, with an optional TTS-specific key override.
- **Live model + voice discovery** from `GET /api/v1/models?output_modalities=speech`, which returns each model's `supported_voices`, pricing, and `supported_parameters` — cached with TTL, manual refresh, and a bundled offline snapshot so the picker is never empty.
- **Provider adapter registry** replacing the `TTSProvider` string-union branching in `api/tts.ts`, `ttsSettings.ts`, `useTTS.ts`, and `TTSSettings.tsx`. Each adapter declares its auth mode, capabilities (speed, instructions, cloning, formats), model list, voice list, and `synthesize()`.
- **Three additional direct providers** on that registry: **ElevenLabs** (the major vendor absent from OpenRouter; live voice library via `GET /v1/voices`), **OpenAI** (`/v1/audio/speech`, incl. the `instructions` tone control), and a **generic OpenAI-compatible endpoint** (base URL + key + model + voice) that reaches self-hosted and long-tail services without new adapter code. Total: 8 providers, up from 4.
- **Voice & model browser UX** replacing both dropdowns: searchable, filterable (vendor / language / gender / price tier / capability), grouped cards with **click-to-audition previews**, favorites, recents, and per-model cost and voice-count badges. Sized for 200+ voices, not 33.
- **Custom voice IDs** for models whose `supported_voices` is `null` (Fish Audio, MiniMax accept arbitrary vendor-side voice ids), saved as reusable named profiles.
- **Per-model input chunking**: `chunkTextForTTS` gains its limit from the selected model's context window instead of a fixed constant.
- **BREAKING (persisted settings)**: `TTSSettings` moves from flat provider fields (`apiKey`, `modelId`, `groqModelId`, `groqResponseFormat`, `pocketSpeed`) to per-provider config objects; schema version 2 → 3 with a migration that preserves existing keys, model ids, and cloned voice profiles.
- **Cache-correctness fix**: `makeCacheKey(provider, voice, speed, text)` omits the model, so two models sharing a voice name under one provider collide and serve each other's audio. The key gains model and response format, and the 32-bit string hash is replaced with a digest appropriate to a 500 MB store.

## Capabilities

### New Capabilities

- `tts-provider-catalog`: Provider adapter contract, the registry of 8 providers, per-provider settings schema + migration, credential borrowing from existing provider stores, and model-aware cache keying.
- `tts-openrouter-provider`: OpenRouter-specific behavior — key reuse, live speech-model catalog with voices and pricing, `POST /audio/speech` request/response handling, custom voice ids, and cost surfacing.
- `tts-voice-browser`: The selection experience — searchable/filterable voice and model browser, audition previews, favorites and recents, and the per-provider capability affordances the browser must reflect.

### Modified Capabilities

None. `openspec/specs/` contains no TTS capability today; the existing TTS specs live in the unarchived changes `add-fal-ai-tts-voice-cloning`, `add-pocket-tts-integration`, and `improve-pocket-tts`, so they are not part of the deployed baseline this change modifies.

## Impact

**Code**
- `src/utils/ttsSettings.ts` — schema v3, per-provider config, migration; hardcoded voice constants move behind adapters
- `src/api/tts.ts` — provider `if/else` chains replaced by registry dispatch
- `src/api/tts/providers/*` (new) — `openrouter`, `elevenlabs`, `openai`, `openai-compatible`, plus `fal`/`groq`/`pocket`/`system` moved onto the contract
- `src/api/tts/catalog.ts` (new) — catalog fetch, TTL cache, offline snapshot
- `src/components/settings/TTSSettings.tsx` (1291 lines) — provider-conditional blocks replaced by capability-driven rendering
- `src/components/settings/VoiceBrowser.tsx` (new) — the picker
- `src/utils/ttsCache.ts` — cache key signature change (invalidates existing cached audio)
- `src/hooks/useTTS.ts`, `src/components/common/ReaderTTSControls.tsx` — provider-agnostic call sites
- `src/utils/ttsTextExtraction.ts` — per-model chunk sizing
- `src/lib/i18n/locales/*.ts` — strings for 4 new providers and the browser, across 6 locales

**External APIs**
- OpenRouter `GET /api/v1/models?output_modalities=speech`, `POST /api/v1/audio/speech`
- ElevenLabs `GET /v1/voices`, `GET /v1/models`, `POST /v1/text-to-speech/{voice_id}` (`xi-api-key` header)
- OpenAI `POST /v1/audio/speech`

**Data**
- Existing TTS audio cache entries are invalidated by the key change (regenerated on next play; no user action needed)
- Persisted `settings.tts` migrated in place on first load after upgrade

**Not in scope**
- Voice cloning beyond today's Fal support (ElevenLabs and Fish Audio cloning are follow-ups)
- Streaming/chunked audio playback while synthesis is in flight
- A direct Deepgram adapter — Aura-2 is reachable through OpenRouter
