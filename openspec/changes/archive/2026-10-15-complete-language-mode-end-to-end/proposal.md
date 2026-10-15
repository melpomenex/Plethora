## Why

Language Mode ships substantial backend and UI code, but production wiring still blocks the normal user journey. Selecting an active profile and toggling Language Mode does not resolve a host without an explicit per-source association; the suggestion banner that creates associations is unmounted; capabilities default to optimistic `available: true`; translation, reading assist, writing, and shadowing providers are empty or platform-limited in production; and Queue Scroll bypasses the language host entirely.

## What Changes

- Mount profile association UX in reader hosts: suggestion banner, explicit association prompt, and host refresh after confirmation.
- Introduce truthful runtime capability resolution derived from actual providers, platform support, and AI configuration.
- Wire production translation (ML Kit + configured AI), writing feedback (AI task layer), reading assist (AI gloss when configured), and shadowing/pronunciation manifests (Groq when configured).
- Extend `DocumentViewerWrapper` for embedded Queue Scroll usage and pass production provider bindings into `LanguageLearningHostProvider`.
- Add golden-path integration tests and manual Spanish fixtures.
- Change host controller defaults from optimistic to pessimistic; production passes explicit capability maps.

## Capabilities

### New Capabilities

- `language-mode-activation`: Profile creation, active profile semantics, per-source association, suggestion flow, disable/switch behavior, and persistence.
- `language-mode-capabilities`: Truthful capability resolution across platforms and providers.
- `language-mode-production-wiring`: Production provider injection for translation, tutor, writing, reading assist, STT, and practice overlays.

### Modified Capabilities

- `language-reader-host-integration`: Require mounted association UX and production capability wiring before host actions become available.

## Impact

- `src/components/viewer/DocumentViewerWrapper.tsx`, `src/pages/QueueScrollPage.tsx`
- `src/lib/languageHost/*`, `src/contexts/LanguageLearningHostContext.tsx`
- `src/lib/languageTranslation/*`, `src/lib/languageWriting/*`, `src/lib/languageReadingAssist/*`
- Language overlays under `src/components/language/`
- Vitest integration coverage and manual fixtures under `src/test/fixtures/language-mode/`
