## Why

A technically correct site that looks like every other generated SaaS landing page will fail Plethora. The homepage must make “read-it-later vs remember-it” visceral using Friendly Chirp, Knowledge Peck, paper-and-device tactility, and a single artifact’s journey — not gradient orbs, fake chat, or interchangeable feature cards.

## What Changes

- Define website visual language (tokens, type, paper/ink palette, device framing) that reuses mascot hexes from `src/__tests__/brandInventory.test.ts` without painting the whole page violet.
- Implement homepage sections in the specified narrative order with real-product imagery slots.
- Specify Knowledge Peck choreography (guided, rare) and `prefers-reduced-motion` equivalents.
- Ban listed generic-AI patterns with a review checklist.
- Provide static fallbacks when JS/motion fail.
- **Non-goals:** demo state machine internals (D); screenshot capture (C); pricing legal facts (E).

## Capabilities

### New Capabilities

- `useplethora-homepage-experience`: visual system, homepage IA, mascot/Peck rules, motion language, device collage, anti-generic criteria.

### Modified Capabilities

- none

## Impact

- `website/src/styles/**`, `website/src/pages/index.astro`, `website/src/components/home/**`, `website/src/assets/brand/` copies.
- Does not own `website/src/components/demo/**`.
- Does not change app themes (`src/themes/catalog.ts`).

## Dependencies

- Hard: A (package, layout, tokens import point).
- Soft: C assets; until then labeled `placeholder` frames (launch blockers, not fake UI).
- D fills `HomeDemoSlot`.

## Ownership

**May modify:** homepage components/styles, brand CSS tokens for the site, mascot composition on marketing pages except trust/legal.

**Must not modify:** demo internals, commercial MD pages, Vercel/env, app runtime, C’s screenshot binaries (may reference).
