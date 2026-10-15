# Change: Add Chatterbox Local TTS to the Create Audio Edition Quality Menu

## Why

A local Chatterbox Turbo service (`http://localhost:8000/v1`, model `chatterbox-turbo`, 7 cloned LibriVox voices) is running and verified on this machine, and Plethora already ships a generic `openai-compatible` TTS adapter whose default base URL points at exactly that service (`src/utils/ttsSettings.ts:249`). Yet Chatterbox is **unreachable from the Create Audio Edition dialog** (`src/components/audio/CreateAudioEditionDialog.tsx`): the quality tiles only offer Fast→Pocket, Natural→OpenRouter, Best→ElevenLabs, and the Advanced provider dropdown (lines 899–904) does not list `openai-compatible` at all — even though the adapter is registered (`src/api/tts/registry.ts:23`) and supports model/voice enumeration plus synthesis. Users who want free, local, GPU-quality narration with zero-shot voice cloning and paralinguistic tags (`[laugh]`, `[chuckle]`, …) must hand-wire settings that the UI hides.

This change adds a first-class **Expressive / Chatterbox Local** quality tile (and Advanced-dropdown entry) so audio editions can be created with Chatterbox like any other provider.

## Current State (Code-Grounded Audit)

**Quality → provider wiring (all in `CreateAudioEditionDialog.tsx`)**
- `QualityPreset` is `"fast" | "natural" | "best" | "custom"` (`src/types/audioEdition.ts:9`).
- `handleQualityChange` (lines 248–265) and the preset-sync `useEffect` (lines 303–317) hard-map `fast→pocket`, `natural→openrouter`, `best→elevenlabs` (with fixed model/voice each). No Chatterbox branch exists.
- The tile grid is `sm:grid-cols-3` (line 729) — a fourth tile needs a layout change.
- The Advanced Provider select (lines 899–904) offers `pocket / openrouter / elevenlabs / openai / system`. `openai-compatible` is missing there too (although `handleProviderChange` already handles `groq`/`fal` branches that are likewise unlisted — lines 285–291 — so unlisted-but-handled providers are an established pattern).
- Voice fallback rosters (lines 373–397) have no `openai-compatible` branch; dynamic voices from `adapter.listVoices` merge automatically (lines 399–404), so enumeration works once the provider is selectable.

**Adapter readiness (`src/api/tts/providers/openai-compatible.ts`)**
- `listModels` → `{baseUrl}/models`, `listVoices` → `{baseUrl}/audio/voices` (expects `{voices: [{id, name}]}` non-empty, lines 95–106), `synthesize` → `{baseUrl}/audio/speech` with `{model, input, voice, response_format, speed}` (lines 133–141). Default voice fallback is `"chatterbox-default"` (line 124).
- Default base URL `http://localhost:8000/v1` already matches the local service.

**Local service capabilities (verified live against `localhost:8000`)**
- `GET /v1/models` → `chatterbox-turbo`; `GET /v1/audio/voices` → 7 voices; `POST /v1/audio/speech` and `/synthesize` → 24 kHz WAV, healthy.
- Constraints the UI must respect: **output is always WAV** (`response_format` is ignored server-side, so the adapter's `mp3` default mismatches); only `temperature` affects output — Turbo ignores `exaggeration`/`cfg_weight` and has **no speed parameter**; there is **no `POST /audio/voices`** (voice registration is GET-only, unlike Plethora's mock daemon); inference is slow on long texts (~2–4× realtime) and concurrent long requests have coincided with full-machine freezes on an 8 GB card, so requests must be chunked and serialized.

## What Changes

- **New quality tile**: `Expressive` → `Chatterbox Local`. Copy: "Free, local GPU narration · zero-shot voice cloning". Tile grid goes 3 → 4 columns on `sm:` breakpoints (stacked single-column on mobile unchanged).
- **`QualityPreset` gains `"expressive"`** (`src/types/audioEdition.ts:9`); both `handleQualityChange` and the sync `useEffect` map it to provider `openai-compatible`, model `chatterbox-turbo`, voice = first enumerated voice (fallback `"default"`). Default `quality` state stays `"natural"` — no behavior change for existing users.
- **Advanced dropdown**: add `openai-compatible` ("Chatterbox (Local)") option plus its `handleProviderChange` branch (model `chatterbox-turbo`, voice `default`), and an `openai-compatible` fallback roster branch (dynamic enumeration covers it once reachable, but the fallback avoids an empty dropdown when the service is down).
- **WAV format on the Chatterbox path**: when provider is `openai-compatible` with a localhost base URL, request `response_format: "wav"` (in the dialog's audition + generation calls) so the requested format matches what the server returns.
- **Pre-flight + guardrails**: before generation/audition with this provider, check `GET /health`; if unreachable, show an inline error with the exact recovery command (`systemctl --user start chatterbox-tts`) instead of hanging. Cap section payloads at ~1000 chars per request (split client-side; the generation store is already per-section) and keep queue depth at 1 — no concurrent syntheses.
- **Speed slider**: disabled with an explanatory note on the Chatterbox path (Turbo has no speed parameter; sending one is silently ignored).

## Non-Goals

- Voice cloning from this dialog (`POST /audio/voices` does not exist on the local service; cloning stays in Voice Studio / follow-up server work).
- Word timings / read-along anchoring for Chatterbox output (unsupported by the server; `supportsWordTimings: false` already).
- Changing the built-in mock Chatterbox daemon, the `plethora` cloud adapter, or default quality/provider for existing users.
- i18n string extraction (dialog copy is currently hardcoded English throughout; follow the file's existing convention).

## Capabilities

### New Capabilities
- `audio-edition-chatterbox-preset`: Expressive/Chatterbox quality tile, preset→provider/model/voice mapping, WAV-format requests, health pre-flight with recovery guidance, per-request chunk cap, serialized generation, and disabled speed control on the Chatterbox path.

### Modified Capabilities
- `audio-edition-generation` (existing): extended with a fourth provider path; no changes to Pocket/OpenRouter/ElevenLabs behavior.

## Impact

- **Frontend**: `src/components/audio/CreateAudioEditionDialog.tsx` (tile, mappings, dropdown, format, pre-flight, chunk cap, slider gating); `src/types/audioEdition.ts` (preset union + any preset-keyed helpers); `src/components/audio/__tests__/CreateAudioEditionDialog.test.tsx` (new selection/mapping/format tests).
- **Docs/help**: if dialog copy changes user-visible behavior claims, regenerate `src/features/help/generated/*` per repo protocol.
- **No backend/Rust changes.** No migration changes. The local `chatterbox-tts` systemd service is an external precondition, documented in the pre-flight error text.

## Definition of Done

1. The quality menu shows four tiles; selecting Expressive sets provider `openai-compatible`, model `chatterbox-turbo`, and a valid voice, with Advanced in sync.
2. With the local service running, Voice Selection lists the enumerated Chatterbox voices and Audition plays a preview of the first paragraph.
3. Generation requests send `response_format: "wav"` and payloads ≤ ~1000 chars each, one at a time; a full chapter completes as sequential section audios.
4. With the service stopped, Audition/Generate shows the recovery command instead of hanging or buffering forever.
5. Speed slider is disabled (with reason text) on the Chatterbox path and unaffected elsewhere.
6. Existing Fast/Natural/Best behavior, defaults, and all current dialog tests are unchanged and green; new tests cover tile selection, provider mapping, WAV format, chunk splitting, and the down-service error path.
