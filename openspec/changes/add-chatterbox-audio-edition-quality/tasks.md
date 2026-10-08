## 1. Preset Type & Mapping

- [x] 1.1 Add `"expressive"` to `QualityPreset` in `src/types/audioEdition.ts:9` and audit preset-keyed helpers (preset labels, `qualityPreset` persistence in `src/types/audioEdition.ts:29`) for exhaustiveness, verifying with `npx tsc --noEmit`.
- [x] 1.2 Add the `expressive → openai-compatible / chatterbox-turbo / default-voice` branch to `handleQualityChange` (`CreateAudioEditionDialog.tsx:248-265`) and mirror it in the preset-sync `useEffect` (`:303-317`), keeping `"natural"` as the default state (`:127`).

## 2. Quality Tile UI

- [x] 2.1 Add the fourth tile (Expressive / Chatterbox Local, "Free, local GPU narration · zero-shot voice cloning") beside Fast/Natural/Best (`:729-790`), changing the grid to 4 columns on `sm:` breakpoints while preserving single-column mobile stacking.
- [x] 2.2 Disable the Speed slider with explanatory text when the active provider is the Chatterbox path (`:928-941` range), verifying other providers are unaffected.

## 3. Provider Wiring & Voices

- [x] 3.1 Add `openai-compatible` ("Chatterbox (Local)") to the Advanced Provider select (`:899-904`) and its `handleProviderChange` branch (`:267-292`, model `chatterbox-turbo`, voice `default`), plus an `openai-compatible` fallback roster in the voice `useMemo` (`:373-397`) for the service-down case.
- [x] 3.2 Send `response_format: "wav"` (not the adapter `mp3` default) on audition (`:482`) and generation paths when the Chatterbox provider is active, verifying against the live service that returned audio decodes as WAV.

## 4. Pre-flight, Chunking & Serialization

- [x] 4.1 Before audition/generation on the Chatterbox path, check `GET {baseUrl}/health`; on failure render an inline error with the recovery command (`systemctl --user start chatterbox-tts`) — never an endless spinner — verifying by stopping the service and clicking Audition.
- [x] 4.2 Split section text into ≤ ~1000-char requests and enforce queue depth 1 (no concurrent syntheses) on the Chatterbox path, verifying a multi-section chapter completes as sequential audios with the service's `/health` `vram` field staying within budget.

## 5. Tests & Docs

- [x] 5.1 Extend `src/components/audio/__tests__/CreateAudioEditionDialog.test.tsx`: expressive tile selection sets provider/model/voice; advanced dropdown includes the new entry; WAV format is requested; down-service shows recovery text; existing Fast/Natural/Best cases still pass — verifying with `npm test src/components/audio/__tests__/CreateAudioEditionDialog.test.tsx`.
- [x] 5.2 Run the wider related suites (`npm test src/api/tts`, dialog tests) and `npx tsc --noEmit` for regressions.
- [x] 5.3 If user-visible copy/behavior claims changed, regenerate `src/features/help/generated/*` per repo protocol and note it in the change summary.
- [x] 5.4 Manual acceptance: with the local service running, create an audio edition end-to-end (audition + one chapter) on the Expressive preset; confirm voices enumerate, audio plays, and no concurrent requests leave the service.
