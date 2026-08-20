## 0. Dependency gates

Requires #1–#4 and existing Flashcard Studio/extract contracts. Freeze `LanguageMiningPayload` before #11/#13/#14 add richer fields; all source collectors must use it rather than create local card payloads.

## 1. Payload and collectors

- [ ] 1.1 Define mining payload, field availability/provider provenance, source/media references, anchor confidence, and missing/error types.
- [ ] 1.2 Implement collectors for EPUB/PDF/HTML/Markdown/article, Queue, transcript/audio, video, YouTube, and text/TTS fallback.
- [ ] 1.3 Add bounded context expansion and cache reuse for translation/analysis/alignment.

## 2. UI/draft routing

- [ ] 2.1 Add shared Mine sentence action to selection/sentence/video/transcript surfaces with mobile/e-ink placement.
- [ ] 2.2 Route payload into existing Flashcard Studio draft/editor and source-provenance metadata.
- [ ] 2.3 Add optional frame/audio reference loading and explicit missing/needs-review presentation.

## 3. Verification

- [ ] 3.1 Test each source type, selected word/phrase/current sentence, anchor failures, provider failures, native-audio preference, and offline.
- [ ] 3.2 Test no fake content, no auto-card, Queue/position/source invariants, accessibility, and draft cancel/accept paths.
