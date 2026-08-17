# Design — Plethora Companion

## Context

No character UI exists. The app has: viewport-global singleton hosts (`<Toast/>`, `<Modal/>` in `src/main.tsx`), a typed feedback event bus (`src/lib/feedback/` with policy-gated cooldowns), zustand stores exposing domain actions, `PresentationContext` (`reducedMotion`, `isEinkMode`), settings categories with a default-off precedent (`ai.pwaAssistantButtonEnabled`), i18n completeness enforcement across six locales, and a canonical bird master SVG (`assets/brand/plethora-icon-master.svg`, "Friendly Chirp", purple `#8B5CF6/#7C3AED/#5B21B6`).

## Goals / Non-Goals

**Goals:** optional, charming, cheap ambient companion; deterministic state machine; event-driven contextual speech with hard anti-spam policy; local-first (no cloud dependency); accessible; static/hidden under e-ink and reduced motion; default OFF.

**Non-Goals (MVP):** AI-generated speech (architecture leaves a hook); flying across the whole UI; interactivity beyond hover/peek reactions; mobile-first locomotion (renders, but conservative); sound.

## Decisions

1. **Module layout** `src/lib/companion/`:
   - `types.ts` — `CompanionEvent`, `CompanionStateId`, `CompanionSettings`, `SpeechCandidate`
   - `engine.ts` — pure reducer-style state machine: `(state, event, ctx) → { state?, speech?, expiresAt }`; no timers inside; clock injected for tests
   - `policy.ts` — eligibility + cooldowns + per-session speech budget + recent-lines memory + suppression rules (typing focus, review decision window, focus mode, modal open)
   - `lines.ts` — local template bank per event class (i18n keys `companion.*`), selection by deterministic weighted-random with no-repeat
   - `host.ts` — a zustand store (`companionStore`) holding runtime state, speech bubble, position; bridge from domain events
2. **Mount**: `CompanionHost` component lazily imported and rendered in `main.tsx` beside `<Toast/>`; returns `null` when disabled/e-ink/hidden. Registers dismissal via `overlayStack` only while a speech bubble is open. Z-index 45 (below Toast 50).
3. **Event bridge** (no new bus): subscribe to `emitFeedback` via a new `companion.*` feedback-event consumer wired through the existing orchestrator's listener path where available, plus direct zustand subscriptions (`documentStore` open, `annotationsStore` highlight add, rss feedback action, `reviewStore` grade). Domain code gains only tiny `companionStore.notify(event)` calls at existing action sites (≤6 call sites).
4. **Rendering**: one inline SVG bird (body/wing/eye/tail groups) derived from the Friendly Chirp silhouette and palette; CSS keyframe animations for states (breathe, hop, walk-bob, flap, blink); CSS transforms only; `requestAnimationFrame` never loops — transitions are CSS-driven with `animationend` → engine callback. Position tracked in a ref, clamped to viewport minus safe-area insets and chrome exclusion zones (bottom nav on mobile, review controls region via a `data-companion-exclude` query checked on move).
5. **Movement policy**: stationary perch point (bottom-right desktop above safe area; bottom-left above nav on mobile) with occasional short hops along the floor; never overlays focused inputs, selected text (`getSelection` non-empty check on move), open modals (`document.querySelector('[role=dialog]')`), or review rating controls.
6. **Settings**: `interface.companion = { enabled: false, speechFrequency: 'normal' | 'quiet' | 'chatty', contextualComments: true, encouragement: true }`; forced default-off on fresh native-mobile installs mirroring the animations-enabled pattern; Appearance panel `SettingsRow` + small preview.
7. **Accessibility**: root `aria-hidden="true"` decorative; speech bubble `role="status"` `aria-live="polite"` but only announced when it appears (mount/unmount), never per frame; keyboard users can dismiss bubble with Escape; reduced-motion = static perch + occasional blink only.
8. **E-ink**: `isEinkMode` → companion not rendered at all (animation would ghost), matching `.theme-backdrop` precedent.
9. **Performance**: no subscriptions to high-frequency stores (scroll/position); events throttled at bridge; component memoized; dynamic import keeps ~0 KB in entry chunk.

## Risks / Trade-offs

- [Annoyance] → hard policy: max N speeches/session by frequency setting, ≥90s cooldown unsolicited, suppression rules, no-repeat last 5 lines, master toggle + instant hide.
- [Overlap risk] → conservative exclusion checks before each move; if blocked, stay put.
- [Bundle/perf regression] → lazy mount + no rAF loop; `npm run bench:check` + `build:check` gates.

## Migration Plan

Settings default off; no persisted-state migration (new keys merge via rehydrate defaults).

## Open Questions

None for MVP. AI-enhanced lines deferred: `SpeechCandidate.source` field reserves `local | ai`.
