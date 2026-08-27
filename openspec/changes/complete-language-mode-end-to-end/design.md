## Context

Research across reader, video, provider, persistence, test, and adversarial audits confirmed:

1. Host resolution requires `enabled` content associations; active profile alone is insufficient.
2. `LanguageProfileSuggestionBanner` was implemented but never mounted.
3. `LanguageReaderDomBridge` mounts in tab readers inside `DocumentViewerWrapper` but Queue Scroll used bare `DocumentViewer`.
4. Capabilities defaulted to `{ available: true, offline: true }`.
5. Translation registry only registered Android ML Kit; writing/reading-assist registries were empty in production.
6. Shadowing defaulted to `local` route without a local provider.

## Goals / Non-Goals

**Goals**
- Normal user path: Settings → profile → open content → enable Language Mode → associate → study.
- Truthful capability reporting and degraded states.
- Reuse Plethora AI/provider infrastructure; no parallel stacks.
- Preserve opt-in association philosophy and source provenance.

**Non-Goals**
- Phoneme-level pronunciation without a real provider.
- Automatic silent profile association.
- Frame capture for video mining.
- Full native STT on every desktop platform in this change.

## Decisions

### D1 — Explicit association with guided UX
Keep backend `enabled` association requirement. Mount `LanguageProfileSuggestionBanner` when detection evidence exists and `LanguageProfileAssociationPrompt` when host status is `unavailable`. Do not auto-associate on toggle.

### D2 — Production capability resolver
Add `resolveLanguageHostCapabilities()` probed at host mount from real provider registries and `hasCloudProvider()` / `isGroqConfigured()` / Android ML Kit availability. Controller defaults become pessimistic; production always passes overrides.

### D3 — Provider routing
- Translation: ML Kit (Android) + AI task provider (configured cloud/on-device path via `runTask`).
- Writing: AI structured correction task; learner text never overwritten.
- Reading assist: AI gloss provider only when cloud AI configured; registry supports `*` language wildcard.
- Shadowing: inject configured Groq providers; default route prefers cloud when local STT absent.

### D4 — Shared host shell
`DocumentViewerWrapper` remains the single production mount for language host overlays. Queue Scroll uses wrapper in `embedded` mode without assistant chrome.

### D5 — Lifecycle
`disabled → resolving → unavailable|ready → stale|cancelled → disabled` with epoch + source fingerprint guards unchanged.

## Risks / Trade-offs

- Queue Scroll embedded wrapper adds language panel chrome in scroll mode — acceptable for parity; assistant suppressed via `embedded`.
- AI translation sends sentence text off-device when cloud AI configured — gated by existing privacy settings in `runTask`.
- Reading assist AI gloss may be unavailable offline — surfaced via capability detail.

## Migration Plan

No database migration. Existing associations continue to work. Users with toggle-on but no association see association prompt instead of a dead-end message.

## Open Questions

- Apple on-device translation APIs (future dedicated provider).
- Transcript DOM vocabulary bridging separate from `LanguageVideoHost` overlay panel.
