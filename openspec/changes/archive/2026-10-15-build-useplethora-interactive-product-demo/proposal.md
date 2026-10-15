## Why

The homepage needs a ~30 second, hands-on path through library → reader → passage → explain → Remember this → card → review → rating → schedule, inside realistic phone chrome. It must be a **front-end state machine** with curated content (from C), not a hosted Plethora, not a live model, and not a second backend.

## What Changes

- Implement `website/src/components/demo/**` island: deterministic stages per shared `DemoStage` contract.
- Phone shells: iOS and Android chrome; initial shell from UA with a visible toggle; shared state.
- Keyboard, touch, focus, SR script, reduced-motion, restart, no dead controls.
- Lazy-load so homepage LCP is not the demo JS.
- Analytics events `demo_*` as no-op emitters until F wires a vendor.
- Static fallback (C screenshots + HTML ol) if the island fails.
- **Non-goals:** real auth, network inference, billing, editing app code, desktop window as the *interactive* shell (desktop/e-ink are B collage).

## Capabilities

### New Capabilities

- `useplethora-interactive-demo`: state machine, shells, a11y, performance isolation.

## Impact

- Only demo components + maybe `/demo` page.
- Consumes C manifest; placeholders allowed with disabled “open this page in the real UI” honesty.

## Dependencies

- A: `HomeDemoSlot`, types, lazy island support.
- C: assets (soft).
- B: slot placement and frame styling via tokens.
- F: event names.

## Ownership

**May modify:** `website/src/components/demo/**`, `website/src/pages/demo.astro` if used, demo CSS.

**Must not modify:** homepage narrative sections (B) except mounting in the slot; commercial pages; Vercel; app Tauri/React.
