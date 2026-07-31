## 1. Adapter contract and registry

- [x] 1.1 Create `src/api/tts/types.ts` with `TTSProviderId`, `TTSProviderAdapter`, `TTSModelInfo`, `TTSVoiceInfo`, `TTSAdapterContext`, `TTSSynthesizeRequest`, and `TTSAudioResult`
- [x] 1.2 Create `src/api/tts/registry.ts` exporting the adapter map, `getAdapter(id)`, and `listAdapters()`; unknown ids resolve to the `system` adapter with a surfaced notice
- [x] 1.3 Move `fal` into `src/api/tts/providers/fal.ts`, preserving `invokeFalModel`, cloning, and `speaker_file_url` handling
- [x] 1.4 Move `groq` into `src/api/tts/providers/groq.ts`, preserving the `audioTranscription.groq.apiKey` fallback as `auth.borrowFrom`
- [x] 1.5 Move `pocket` into `src/api/tts/providers/pocket.ts` (`kind: "local"`, no auth, retains sidecar availability check)
- [x] 1.6 Move `system` into `src/api/tts/providers/system.ts` backed by `useSystemVoices`/Web Speech
- [x] 1.7 Rewrite `generateSpeech()` in `src/api/tts.ts` as resolve → cache check → `adapter.synthesize()` → cache write, with no provider conditionals
- [x] 1.8 Verify `src/api/__tests__/tts.test.ts` passes with import-path changes only — no assertion changes

## 2. Settings schema v3 and migration

- [x] 2.1 Define `TTSProviderSettings` and the v3 `TTSSettings` shape in `src/utils/ttsSettings.ts`; raise `TTS_SETTINGS_SCHEMA_VERSION` to 3
- [x] 2.2 Implement the v2 → v3 migration: `apiKey`/`modelId`/`cloneModelId`/`requestMode`/`proxyUrl` → `providers.fal`, `groqModelId`/`groqResponseFormat` → `providers.groq`, `pocketSpeed`/`pocketAvailable` → `providers.pocket`
- [x] 2.3 Preserve `voiceProfiles` verbatim through migration, including cloned Fal profiles with `speakerEmbeddingUrl`, and preserve `provider`, `defaultVoiceId`, `defaultPresetId`, `presets`, and `enabled`
- [x] 2.4 Rewrite `sanitizeTTSSettings` to validate per-provider objects and return valid defaults for malformed input without throwing
- [x] 2.5 Replace `validateTTSConfiguration`'s provider conditionals with adapter `auth`-driven validation
- [x] 2.6 Add `favorites: string[]` and `recents: string[]` to settings with capped length on write
- [x] 2.7 Tests in `src/utils/__tests__/ttsSettings.test.ts`: each v2 field's destination, cloned-voice preservation, idempotency on v3 input, and malformed/absent input

## 3. Credential borrowing

- [x] 3.1 Implement `resolveProviderKey(adapter, settings)` with order: TTS-specific key → borrowed key → unconfigured
- [x] 3.2 Implement the `llmProvidersStore` borrow source: first enabled `provider === 'openrouter'` entry, else first entry overall
- [x] 3.3 Return the borrow source's identity alongside the key so the UI can name it
- [x] 3.4 Make validation failure for a borrowable provider name the provider and point at LLM provider settings
- [x] 3.5 Tests: borrow when TTS key empty, override when present, multiple candidates, no candidates

## 4. Cache keying

- [x] 4.1 Add a 128-bit-class digest helper (FNV-1a 128) in `src/utils/ttsCache.ts`
- [x] 4.2 Change `makeCacheKey` to `(provider, model, voice, speed, format, text)` and update all call sites
- [x] 4.3 Tests: same voice under two models produces distinct keys; `mp3` vs `wav` produce distinct keys; identical inputs hit cache; old-format entries do not match and do not error

## 5. OpenRouter catalog

- [x] 5.1 Create `src/api/tts/catalog.ts` with in-memory → localStorage (24h TTL) → bundled snapshot tiers
- [x] 5.2 Implement the `GET /api/v1/models?output_modalities=speech` fetch, retaining `id`, `name`, `description`, `supported_voices`, `supported_parameters`, `context_length`, and `pricing`
- [x] 5.3 Commit the bundled snapshot at `src/api/tts/openrouter-speech-models.snapshot.json` and add a script to regenerate it
- [x] 5.4 Implement `refreshCatalog()` that bypasses TTL and retains the prior cache on failure
- [x] 5.5 Derive per-model cost tiers from `pricing.prompt` normalized per million tokens; omit when pricing is unusable
- [x] 5.6 Tests: cached read issues no request, refresh bypasses TTL, failed refresh keeps prior cache, no-cache-no-network falls back to snapshot

## 6. OpenRouter adapter

- [x] 6.1 Create `src/api/tts/providers/openrouter.ts` with `auth.borrowFrom` pointing at `llmProvidersStore`
- [x] 6.2 Implement `listModels()` and `listVoices(modelId)` from the catalog
- [x] 6.3 Implement `synthesize()` as `POST /api/v1/audio/speech` with `{model, input, voice, response_format}`, treating the response as raw bytes and wrapping in the correct MIME type
- [x] 6.4 Include `speed` only when the model's `supported_parameters` lists it; hide the control otherwise
- [x] 6.5 Send tone instructions through the provider options passthrough, not as a top-level field
- [x] 6.6 Reset to the model's first supported voice when a model switch makes the current voice invalid, and surface the change
- [x] 6.7 Support custom voice ids for models reporting `supported_voices: null`, saved as provider+model-scoped voice profiles
- [x] 6.8 Raise a validation error before the request when a required voice is missing
- [x] 6.9 Map 401/403 → non-recoverable `auth`, 429 → recoverable `rate_limit`, 402 → non-recoverable out-of-credits, invalid model/voice → non-retried with the provider's message and the model id
- [x] 6.10 Raise a recoverable provider error and skip the cache write on a zero-length 200 body
- [x] 6.11 Tests against recorded fixtures for success, each error class, empty body, and model-switch voice reset

## 7. Additional direct providers

- [x] 7.1 Create `src/api/tts/providers/elevenlabs.ts`: `POST /v1/text-to-speech/{voice_id}` with `xi-api-key`, body `{text, model_id, output_format}`, binary response
- [x] 7.2 Implement ElevenLabs `listVoices()` from `GET /v1/voices` and `listModels()` from `GET /v1/models`, cached through the catalog module
- [x] 7.3 Create `src/api/tts/providers/openai.ts`: `POST /v1/audio/speech` with `{model, input, voice, response_format, speed, instructions}`, `supportsInstructions: true`
- [x] 7.4 Create `src/api/tts/providers/openai-compatible.ts` taking base URL, key, model, and voice; normalize trailing slashes in the base URL
- [x] 7.5 Mark `openai-compatible` as unable to enumerate models so the UI falls back to a free-text model id
- [x] 7.6 Register all four new adapters and confirm `listAdapters()` returns eight

## 8. Per-model chunking

- [x] 8.1 Source `maxChunkSize` from the model's `context_length` when non-zero, else the adapter's `maxInputChars`
- [x] 8.2 Thread the resolved limit from `generateSpeech`/`useTTS` into `chunkTextForTTS`
- [x] 8.3 Tests: chunks respect a smaller model limit; `context_length: 0` falls back to the adapter default; an over-long single sentence splits at a word boundary

## 9. Voice and model browsers

- [x] 9.1 Create `src/components/settings/VoiceBrowser.tsx` — modal, fixed search/filter header, virtualized grouped list, current voice marked and scrolled into view
- [x] 9.2 Implement incremental search over voice name, model, and vendor, case-insensitively
- [x] 9.3 Implement provider, vendor, language, and style/gender filters as removable chips with clear-all; combined filters are conjunctive
- [x] 9.4 Implement best-effort per-vendor language/gender parsing (`aura-2-thalia-en`, `af_bella`, `en_paul_happy`, `en-US-Harper:MAI-Voice-2`), degrading to no tag when unrecognized
- [x] 9.5 Implement the empty state naming active criteria with a clear-them action
- [x] 9.6 Implement preview: fixed sample phrase, per-card loading state, routed through the audio cache, one preview at a time, errors shown on the card without closing the modal
- [x] 9.7 Disclose preview cost once per session for billed providers before the first preview
- [x] 9.8 Implement favorites and recents groups pinned above the list, persisted, cross-provider, with unavailable favorites shown as disabled and explained
- [x] 9.9 Create `src/components/settings/ModelBrowser.tsx` with cards showing name, vendor, voice count, price, and capability badges, searchable by name and vendor
- [x] 9.10 Selecting a voice sets it as default for the current provider and model, closes the browser, and updates the settings summary

## 10. Settings UI rework

- [x] 10.1 Replace the provider `<select>` with a selector showing per-provider readiness: configured, needs a key, or unavailable on this platform
- [x] 10.2 Show the borrowed-key source, masked, on providers authenticating with a borrowed key
- [x] 10.3 Focus the credential field and explain requirements when an unconfigured provider is selected, without discarding the selection
- [x] 10.4 Extract per-provider config panels out of `TTSSettings.tsx` and render fields from adapter `capabilities` instead of `provider === "..."` conditionals
- [x] 10.5 Replace the voice `<select>` and free-text model input with the browsers; keep the free-text model field only for adapters that cannot enumerate
- [x] 10.6 Retain saved-but-unsupported values (e.g. instructions on a provider that ignores them) without sending them
- [x] 10.7 Update `src/hooks/useTTS.ts` and `src/components/common/ReaderTTSControls.tsx` to provider-agnostic calls

## 11. Localization

- [x] 11.1 Add strings for the four new providers, the browsers, filters, previews, cost disclosure, and the new error messages to `en`
- [x] 11.2 Mirror into `de`, `es`, `fr`, `ja`, `zh`
- [x] 11.3 Confirm provider labels, vendor names, model ids, and voice names are excluded from translation

## 12. Verification

- [x] 12.1 Run the full frontend test suite and typecheck
- [ ] 12.2 Manually verify OpenRouter end to end: borrowed key, catalog load, model switch, voice preview, playback in the reader
- [ ] 12.3 Manually verify a v2-settings upgrade preserves a cloned Fal voice and a configured Groq provider
- [ ] 12.4 Verify offline behavior: snapshot fallback, offline labeling, and failed-refresh cache retention
- [ ] 12.5 Verify the browser stays responsive on the 90-voice Deepgram Aura-2 list
- [ ] 12.6 Verify existing Fal, Groq, Pocket, and System playback are unchanged
