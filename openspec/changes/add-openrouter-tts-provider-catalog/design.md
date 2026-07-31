## Context

TTS today is four providers behind a string union:

```ts
export type TTSProvider = "fal" | "groq" | "pocket" | "system";
```

That union is branched on in at least four places — `api/tts.ts` (`generateSpeech` has a Pocket block, a Groq block, and a Fal fallthrough), `utils/ttsSettings.ts` (`normalizeVoiceProfiles`, `defaultVoiceIdForProvider`, `validateTTSConfiguration`), `hooks/useTTS.ts`, and `components/settings/TTSSettings.tsx` (1291 lines with `tts.provider === "fal"` / `=== "groq"` conditional blocks). Settings are flat and provider-entangled: one shared `apiKey`, plus `modelId`, `cloneModelId`, `groqModelId`, `groqResponseFormat`, `pocketSpeed` side by side. Voices are 33 hand-listed string constants flattened into one `voiceProfiles` array tagged by provider.

Adding OpenRouter under that structure means a fifth branch in every switch, and OpenRouter alone contributes 19 models whose voice lists are not knowable at build time. So the structural work is not optional overhead — it is the cheapest way to land the feature.

### What OpenRouter actually offers (verified against the live API, 2026-07-31)

This was checked rather than assumed, because "OpenRouter is chat-completions only" was the plausible prior:

- `GET /api/v1/models?output_modalities=speech` returns **19 models** with `modality: "text->speech"`. Vendors: Fish Audio (4), MiniMax (2), Deepgram Aura-2, Google Gemini 3.1 Flash TTS, xAI Grok, Microsoft MAI-Voice-2 (2), Qwen (2), hexgrad Kokoro, Canopy Orpheus, Sesame CSM, Zyphra Zonos (2), Mistral Voxtral.
- Each catalog entry carries a **`supported_voices` array** — Deepgram Aura-2 lists 90, Kokoro 54, Gemini TTS 30, Voxtral 30, Orpheus 7, Grok 5, MAI-Voice-2 4. Fish Audio and MiniMax report `null`; MiniMax's own description states it accepts arbitrary vendor voice ids.
- Entries also carry `supported_parameters` (which is where per-model speed/format support comes from), `context_length` (0, 4096, 32768 — the basis for chunk sizing), and `pricing.prompt`.
- `POST /api/v1/audio/speech` takes `{model, input, voice, response_format, speed, provider}` and returns **raw audio bytes** with `Content-Type: audio/mpeg` or `audio/pcm` plus an `X-Generation-Id` header. Not JSON.

Price range across the catalog is `0.00000062` to `0.0001` per input token — a 160× spread — which is why cost surfacing is a requirement and not a nicety.

Note the OpenAI-shaped `openai/gpt-audio` and `openai/gpt-audio-mini` are **not** in the speech list; they are `text+audio->text+audio` chat models. They are not usable via `/audio/speech` and are out of scope.

## Goals / Non-Goals

**Goals:**

- OpenRouter TTS working off the key the user already configured for AI features, with zero re-entry.
- Model and voice discovery at runtime, so the catalog grows without app releases.
- A selection UI that stays usable at 200+ voices.
- One adapter contract, so the next provider is a file rather than five edits.
- Existing Fal / Groq / Pocket / System users survive the upgrade with settings and cloned voices intact.

**Non-Goals:**

- Voice cloning beyond today's Fal support. ElevenLabs and Fish Audio cloning are follow-ups.
- Streaming playback during synthesis. Current behavior — synthesize, then play — is preserved.
- A direct Deepgram adapter; Aura-2 comes through OpenRouter.
- Reworking `ttsCache`'s eviction, size accounting, or IndexedDB schema. Only the key function changes.
- Moving API keys into the OS keychain. `llmProvidersStore` already persists keys to localStorage with a standing TODO; this change inherits that posture rather than fixing it.

## Decisions

### 1. Adapter registry over an extended string union

A `TTSProviderAdapter` record per provider, keyed in a registry map:

```ts
interface TTSProviderAdapter {
  id: TTSProviderId;
  label: string;
  kind: "cloud" | "local";
  auth: { mode: "none" | "apiKey" | "borrowed"; borrowFrom?: BorrowSource; docsUrl?: string };
  capabilities: {
    supportsSpeed: boolean;
    supportsInstructions: boolean;
    supportsCloning: boolean;
    supportsCustomVoiceIds: boolean;
    audioFormats: readonly string[];
    maxInputChars: number;
  };
  listModels(ctx): Promise<TTSModelInfo[]>;
  listVoices(ctx, modelId: string): Promise<TTSVoiceInfo[]>;
  synthesize(ctx, req): Promise<TTSAudioResult>;
}
```

`generateSpeech()` becomes: resolve settings → look up adapter → check cache → `adapter.synthesize()` → cache. The UI renders from `capabilities` rather than from `provider === "..."` tests.

*Alternative rejected:* keep the union and add cases. It is fewer lines today, but the branch count is already 4 sites × 4 providers, and this change takes it to 4 × 8 with two of the new providers needing async catalog state. The conditional sprawl in `TTSSettings.tsx` is the specific thing that makes the current file 1291 lines.

*Alternative rejected:* a Rust-side provider abstraction. TTS is entirely frontend today (`fetch` from the webview, which already works for OpenRouter LLM calls in `api/llm/index.ts`); moving it to Tauri commands would break the web build and buy nothing here.

### 2. Per-provider settings objects, schema v3

```ts
interface TTSSettings {
  schemaVersion: 3;
  enabled: boolean;
  provider: TTSProviderId;
  providers: Record<TTSProviderId, TTSProviderSettings>;  // key, model, voice, format, speed, instructions
  voiceProfiles: TTSVoiceProfile[];   // unchanged shape, now also holds custom voice ids
  presets: TTSPreset[];               // unchanged
  favorites: string[];
  recents: string[];
}
```

The migration is mechanical and reads the v2 field names directly: `apiKey`/`modelId`/`cloneModelId`/`requestMode`/`proxyUrl` → `providers.fal`; `groqModelId`/`groqResponseFormat` → `providers.groq`; `pocketSpeed`/`pocketAvailable` → `providers.pocket`. `voiceProfiles` carries over untouched, which is what preserves cloned Fal voices and their `speakerEmbeddingUrl` — the only TTS state a user cannot recreate by clicking.

*Alternative rejected:* keep flat fields and prefix them (`openrouterModelId`, `elevenlabsModelId`, …). That is 8 providers × ~5 fields of top-level sprawl, and switching providers would still clobber shared fields like `apiKey`.

### 3. Catalog fetching: TTL cache + bundled snapshot

Catalog state lives in `src/api/tts/catalog.ts` with three tiers: in-memory for the session, `localStorage` with a TTL (24h) across sessions, and a **build-time snapshot** committed to the repo as the offline/first-run floor. `Cache-Control` is not relied on — the webview's HTTP cache behaves differently across WKWebView, WebView2, and WebKitGTK.

The snapshot matters more here than in a typical catalog feature: without it, a user offline on first run sees an empty voice picker and concludes TTS is broken. Refresh is also explicit (a button) because a 24h TTL is wrong for someone who just added credits or is watching for a new model.

*Alternative rejected:* fetch on every settings open. Three round-trips (OpenRouter models, ElevenLabs voices, ElevenLabs models) on every visit to a settings tab, for data that changes weekly.

### 4. Credential borrowing, with a precedent

Groq TTS already falls back to `settings.audioTranscription.groq.apiKey`. This generalizes that into the adapter's `auth.borrowFrom`, with resolution order: TTS-specific key → borrowed key → unconfigured. OpenRouter borrows from `llmProvidersStore` (first enabled `provider === 'openrouter'` entry, else first overall).

The UI must **name the source** ("using the key from your *OpenRouter* provider entry"), masked. Silent borrowing is the failure mode to avoid: a user who deletes an LLM provider entry and then finds TTS broken, with no indication the two were linked.

### 5. Cache key gains model and format — and a real digest

Current:

```ts
makeCacheKey(provider, voice, speed, text)  // `${provider}:${voice}:${speed}:${hash32(text)}`
```

Two defects surface the moment a provider has many models. First, **the model is absent**: under `openrouter`, `qwen-audio-3.0-tts-flash` and `qwen-audio-3.0-tts-plus` are distinct models, and Kokoro's `am_puck` collides by name with Gemini's `Puck` — same provider, same voice string, different audio, same key. The user gets the wrong voice from cache, silently. Second, the text digest is a 32-bit multiply-shift hash; across a 500 MB store the birthday bound makes collisions a matter of when, and a text collision serves audio for entirely different words.

New key: `provider:model:voice:speed:format:digest(text)`, with the digest widened to a 128-bit-class hash (FNV-1a 128 or `crypto.subtle` SHA-256 truncated — the latter is async, so the former is the default unless synthesis is already on an async path, which it is).

Old entries simply stop matching. They are not migrated — the audio is cheap to regenerate and the old keys carry no model information to migrate *with*. Normal LRU eviction reclaims them.

### 6. Voice browser: one component, capability-driven

A modal with a fixed search/filter header and a virtualized grouped list. Groups in order: Favorites → Recents → all voices, grouped by language where derivable. Language and gender are parsed from voice identifiers where the vendor encodes them — `aura-2-thalia-en`, `af_bella` (a=American, f=female), `en_paul_happy`, `en-US-Harper:MAI-Voice-2` — and left blank where they are not (`Zephyr`, `tara`, `conversational_a`). Parsing is best-effort and per-vendor; a wrong guess must degrade to "no tag", never to a wrong filter result.

Virtualization is required, not optional: Deepgram Aura-2's 90 voices alone exceed what a plain map renders comfortably inside a modal, and the "all providers" favorites view can span several models.

Previews synthesize a fixed short phrase and route through the same cache as normal playback, so auditioning the same voice twice costs one request. Preview cost is disclosed once per session for billed providers — an unlabeled play button over a 90-voice grid is a way to spend real money by accident.

### 7. Chunking becomes model-aware

`chunkTextForTTS(text, maxChunkSize)` already exists and splits on sentence boundaries. The change is where `maxChunkSize` comes from: the model's `context_length` when the catalog reports a non-zero value, else the adapter's `maxInputChars` default. Fish Audio and MiniMax report `context_length: 0`; Kokoro 4096; Gemini TTS 32768. Existing behavior for a single over-long sentence — split at the nearest word boundary — is retained.

## Risks / Trade-offs

- **OpenRouter's TTS surface is young; request/response shape may drift** → The adapter isolates it to one file. The catalog query and the synthesis call are the only two contact points, and both are covered by tests using recorded fixtures.
- **Catalog snapshot goes stale in the repo** → It is a floor, never authoritative: any successful fetch supersedes it, and the UI labels snapshot data as offline. Refresh the snapshot at release time, not per-commit.
- **Cache key change invalidates every existing cached clip** → One-time regeneration cost, no data loss, no user action. Acceptable; the alternative is knowingly serving wrong-voice audio.
- **Borrowed keys create an invisible coupling between AI settings and TTS** → Mitigated by naming the source in the UI and by validation that fails with a message pointing at the LLM provider settings, not a bare "no API key".
- **Eight providers × 6 locales is a large i18n surface** → Provider labels and vendor names are proper nouns and stay untranslated; only the surrounding UI strings are localized. Voice names come from the API and are never translated.
- **200+ voice cards with preview buttons invites accidental spend** → Cost disclosure before first preview, preview caching, and one-preview-at-a-time playback.
- **`TTSSettings.tsx` is 1291 lines and this change touches most of it** → Extract the browser and per-provider config panels into their own components rather than growing the file; the provider-conditional blocks being removed are roughly what the new components replace.
- **Two providers accept arbitrary voice ids, so validation cannot be exhaustive** → Fail fast client-side only on *missing* voice; let the vendor reject unknown ids and surface its message verbatim.

## Migration Plan

1. Land the adapter contract and registry with the four existing providers moved onto it, no behavior change. Existing tests (`src/api/__tests__/tts.test.ts`, `src/utils/__tests__/ttsSettings.test.ts`) must pass unmodified except for import paths.
2. Land the v2 → v3 settings migration with tests covering each v2 field's destination, cloned-voice preservation, idempotency, and malformed input.
3. Land the cache key change. Old entries orphan and evict.
4. Land the OpenRouter adapter plus catalog module with the bundled snapshot.
5. Land ElevenLabs, OpenAI, and OpenAI-compatible adapters.
6. Land the voice and model browsers, then remove the superseded dropdowns.
7. Localize.

**Rollback:** steps 4–7 are additive — reverting them leaves schema v3 in place with the original four providers working, since v3 is a superset of v2's information. Rolling back past step 2 requires a v3 → v2 downgrade path, so treat step 2 as the commit point.

## Open Questions

- Catalog TTL: 24h is proposed. Shorter costs requests; longer risks a user not seeing a model they just read about. Revisit if OpenRouter's speech catalog turns out to change more often than weekly.
- Whether favorites and recents belong in `settings.tts` (synced with settings) or in local-only storage. Proposed: `settings.tts`, since a user's preferred voice is worth carrying across devices — but it does mean favorites can reference a provider the other device has no key for, which the "unavailable favorite" scenario already covers.
- Whether the bundled snapshot should include ElevenLabs' public voice list. It is account-scoped, so probably not — but it means the ElevenLabs picker is empty without network, unlike OpenRouter's.
- Preview sample phrase: a fixed English sentence reads poorly for a Japanese or Spanish voice. Options are a per-language phrase table keyed off the parsed language tag, or letting the user set their own. Not blocking; default to a fixed phrase and revisit.
