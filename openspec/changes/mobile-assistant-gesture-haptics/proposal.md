## Why

Mobile readers need an Assistant they can reach deliberately without leaving their PDF, EPUB, article, video, or library. Plethora already has conversational AI, native haptic delivery, and protected Back navigation; a locally owned gesture can connect them into one responsive, tactile mobile interaction.

## What Changes

- Add an understated, accessible Assistant pill above bottom navigation: tap opens; an upward drag starting on the pill reveals a finger-tracked sheet; release below threshold cancels without navigation.
- Provide closed, partial, and expanded sheet states, handle-only resizing/dismissal, explicit close, existing overlay Back dismissal, safe-area/keyboard adaptation, reduced motion, and fullscreen suppression/reveal rules.
- Emit one Assistant-owned threshold cue per qualifying drag through the existing semantic feedback policy and native drivers. Opening after that cue is silent; tap activation and deliberate sheet detent changes have separate, bounded policies.
- Host the existing `AssistantPanel` globally in mobile layout, using its `fillContainer` mode and an explicit stable conversation key. Retain conversation, draft, and scope across dismissal/reopening and view changes; default a new general conversation to Chat. Preserve selection-based `AskSheet` sessions and docked answer cards.
- Publish active-view context from existing reader/Queue/RSS resolvers, taking a source snapshot per submitted turn and preserving privacy, scope, transcript provenance, and source-change boundaries.
- Share a composer dictation adapter between the global sheet and selection Ask. Extend existing Android and Apple speech plugins for short, explicitly requested, cancellable native dictation; keep keyboard dictation available as ordinary text entry and browser recognition as a disclosed, capability-gated web fallback.
- Add deterministic gesture/feedback/session/speech coverage and mandatory physical Android/iPhone acceptance, including existing navigation regressions and performance under reader load.

- Product clarification (2026-10-16): the global sheet also provides a searchable Commands mode alongside Chat, backed by the existing unified command registry, matcher and executor. Keyboard palette behavior stays available; natural-language command execution is outside this addition.

## Capabilities

### New Capabilities

- `mobile-assistant-sheet`: Global mobile hosting, local pill/handle gesture recognition, detents, viewport adaptation, overlay ownership, accessibility, and navigation coexistence.
- `mobile-assistant-conversation`: Stable global session, per-turn active context, multi-turn scope continuity, privacy provenance, and isolation from selection Ask.
- `assistant-gesture-haptics`: Assistant event ownership, single latched threshold cue, tap/detent semantics, bounded delivery, and physical acceptance.

### Modified Capabilities

- `mobile-ask-sheet`: Add shared capability-aware dictation and explicit isolation from the global conversation while preserving selection composer and answer-card requirements.
- `android-speech-intelligence`: Add short live dictation through the existing plugin, separate from its durable ML Kit file/lecture transcription contract.
- `apple-speech-transcription`: Add purpose-scoped ephemeral composer dictation using the existing live bridge with finalization, cancellation, permission, and local-processing guarantees.

## Impact

Frontend touchpoints: `MobileLayoutWrapper`, `MobileNavigation` geometry, `AssistantPanel`, `AskSheet`, the mobile `PwaAssistantButton` entry, `DocumentViewerWrapper`, `QueueScrollPage`, RSS context publishing, shared speech adapter, and `feedback/events.ts` / `policy.ts`. Reuse `useVisualViewport`, `overlayStack`, `runAssistantTurn`, context resolvers, scope selector, response/citation rendering, provider selection, and existing conversation persistence. Add small local gesture/viewport helpers; no new animation or speech dependency is planned.

Native touchpoints: extend `plethora-android-speech` and `plethora-apple-intelligence` commands/contracts, scoped permissions, and permission/lifecycle handling. Reuse `plethora-haptics` unchanged unless physical evidence identifies a separately scoped driver defect. No Back coordinator, settings migration, database schema, cloud speech provider, or desktop behavior change is proposed.

Overlapping changes: consume the implemented, not-yet-archived `unify-assistant-conversation-and-video-context`; reconcile `native-mobile-haptics`, `fix-mobile-edge-swipe-back`, and `fix-native-mobile-back-navigation`, whose physical acceptance remains outstanding. Older PDF context and scroll Assistant toggle proposals overlap hosting/context and must not introduce another mobile trigger or source pipeline. See design and validation for the complete reconciliation ledger.

Non-goals: edge or global screen gestures, Home interception, Back rewrites, automatic recording, long-press-to-dictate in v1, new AI orchestration, wholesale conversation-store extraction, desktop redesign, lecture recording changes, and unrelated refactoring. This change package is planning only; release acceptance is distinct from proposal readiness.
