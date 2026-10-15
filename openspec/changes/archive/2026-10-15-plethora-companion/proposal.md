# Plethora 1.0 — Proposal C: Optional Animated Plethora Companion

## Why

Plethora's mascot ("Friendly Chirp", the P-shaped bird in `assets/brand/plethora-icon-master.svg`) exists only as static iconography. An optional, tasteful desktop-pet-style companion adds warmth and lightweight contextual guidance without becoming Clippy: it must be off by default, nearly free at runtime, suppressed when it would annoy, static under e-ink/reduced-motion, and fully useful without cloud AI.

## What Changes

- New **companion runtime** (`src/lib/companion/`): a deterministic state machine (`idle, hop, walk, fly, land, perch, sleep, look, think, celebrate, curious, talk` — MVP implements a subset) driven by a structured event pipeline `event → eligibility → cooldown → probability → response (animation + speech)`, with per-event cooldowns, a session speech budget, no-repeat memory, and suppression while typing/during review decisions/in focus modes.
- New **event bridge**: consumes the existing typed feedback bus (`src/lib/feedback/`) plus zustand subscriptions (document opened, highlight created, RSS liked/disliked, review graded) — no new global event system.
- New **overlay host** mounted viewport-globally in `src/main.tsx` beside `<Toast/>`: a lazily-loaded SVG bird rendered with CSS transforms; never covers essential controls, respects viewport bounds, safe areas, and registers with `overlayStack` for Android back. Z-index below Toast (50).
- New **settings**: `interface.companion` group (Enabled [default OFF, also forced off on fresh native-mobile installs], speech frequency, contextual comments, encouragement, master disable). Appearance panel row following the `pwaAssistantButtonEnabled` default-off precedent.
- **Local-first speech**: rule/template system with `companion.*` i18n keys in all six locales. AI augmentation is designed-for but NOT wired in MVP (no cloud dependency, no data egress).
- **Gating**: hidden entirely when e-ink mode is active; reduced-motion (`prefers-reduced-motion` or presentation `reducedMotion`) eliminates locomotion (static perch + optional bubbles); honors `interface.animationsEnabled`; decorative animation `aria-hidden`, bubbles readable but not auto-announced repeatedly.
- **Performance**: no continuous rAF loop (rAF only during active transitions), CSS-transform-only animation, pauses when hidden; bundle kept out of the entry chunk via dynamic import; a bench + baseline if any hot path is touched.

## Capabilities

### New Capabilities
- `companion-runtime`: state machine, event eligibility/cooldown/budget policy, and suppression rules for the ambient companion.
- `companion-presentation`: overlay rendering, movement bounds, accessibility/e-ink/reduced-motion behavior, and user settings controlling the companion.

### Modified Capabilities
- None.

## Impact

- New code only: `src/lib/companion/*`, one host component mounted in `main.tsx`, settings additions (`settingsStore` interface category + Appearance row), `companion.*` i18n keys ×6 locales. No database, sync, or Rust changes in MVP.
- Entry bundle must stay within budget (lazy mount). E-ink CSS profile untouched (companion simply not rendered).

Cross-references: part of Plethora 1.0; independent of A/B/D, scheduled after them so the RC audit (E) can verify it.
