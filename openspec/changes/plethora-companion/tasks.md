## 1. Runtime core

- [x] 1.1 `src/lib/companion/types.ts` + `engine.ts` state machine with injected clock; unit tests
- [x] 1.2 `policy.ts` (eligibility, cooldowns, budget, no-repeat, suppression); unit tests
- [x] 1.3 `lines.ts` template bank + deterministic selection; `companionStore` host state
- [x] 1.4 Event bridge: zustand subscriptions + call-site notify (document open, highlight, extract, review grade, rss like/dislike, streak)

## 2. Presentation

- [x] 2.1 `CompanionBird` SVG + CSS state animations (breathe/hop/blink/celebrate), reduced-motion static variants
- [x] 2.2 `CompanionHost` overlay: lazy mount in `main.tsx`, z-45, viewport clamp, safe areas, exclusion checks, overlayStack registration for bubbles
- [x] 2.3 Speech bubble component: `role=status`, Escape dismiss, auto-expiry

## 3. Settings + i18n

- [x] 3.1 `interface.companion` settings (default off, mobile default-off merge) + Appearance `SettingsRow` with preview
- [x] 3.2 `companion.*` keys in all six locales (completeness test green)

## 4. Validation

- [x] 4.1 Component/engine/policy tests; `npm run test:run` new suites
- [x] 4.2 `npm run build:check` (entry budget, lazy load verified); manual e-ink/reduced-motion gating check

## 5. Interactivity pass

- [x] 5.1 Perch discovery (data-companion-perch opt-in + toolbar/panel edges + floor) with dialog/opt-out exclusion; pure math (edge spots, snap radius, arc, duration) unit-tested
- [x] 5.2 Drag & drop: pointer capture, carried state, snap-to-perch, open-space fall with flapping then flight to nearest perch
- [x] 5.3 Flight: rAF-scoped parabolic arc with banking tilt, landing settle; reduced-motion instant reposition
- [x] 5.4 Ambient wandering between perches (bounded probability, never while dragged/in flight/suppressed)
- [x] 5.5 Position persistence in localStorage with viewport-clamped restore
