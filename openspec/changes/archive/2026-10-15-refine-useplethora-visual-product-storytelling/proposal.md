## Why

The useplethora.com homepage has sound editorial foundations (paper/ink, serif display type, real product captures) but its rendered experience still reads as a styled documentation page, not a finished commercial product site. Measured against the actual app it advertises, the page is flat and under-scaled: the hero device composition renders at ~25% of viewport width on 1728px screens (~444px desktop frame, ~173px phone with ~330px of unused space beside it), the phone is a plain black rounded border rather than a physical device, first-time visitors on dark-mode OSes land on a dark site that erases the editorial paper-and-ink identity (`system` is the default theme today), Reading Desk buries its sophisticated scene machinery behind large dead whitespace before any product UI is visible, most story sections are typography-only wireframes (`HomeConnect` renders two bordered notes and the word “linked”), implementation-state sentences leak into marketing copy (“Downloads are not published yet. This opens the downloads page.”), and user-facing copy repeatedly frames the product around an “essay,” narrowing a general reading tool to one content genre.

This change closes that gap visually without inventing product capabilities: every added visual derives from the real showcase capture set (8 scenes × desktop/mobile) or verifiable app behavior, and the existing anti-generic rules remain ship blockers.

## What Changes

- **Hero recomposition (P0):** treat the desktop+phone pair as one designed composition — larger media (desktop ≈ 35–40rem equivalent, text/media ratio ≈ 0.8/1.2), controlled grid escape toward the right viewport edge at ≥1280px, real depth via restrained perspective transforms (subtle `rotateY`, minimal `rotateX/Z`, phone in front with 15–20% overlap), and a distinct foreground shadow model.
- **Premium generic device frame (P0):** replace `.phone-bezel`'s plain black padding with a layered metallic rim / dark rim / inset screen treatment plus contact shadow; no Apple mimicry, notches, or branding.
- **Theme defaults (P0):** marketing site defaults to **Light** on first visit (no stored preference); explicit Light/Auto/Dark choices keep working; migration rule specified; dark mode becomes a first-class theme with more distinct surface values so bright product screenshots anchor the page.
- **CTA hierarchy (P0):** remove development-state disclaimers from under primary CTAs; launch-aware states (“Get Plethora — coming soon” behavior) driven by launch flags.
- **Control language:** ~6–8px control radius (not cards/buttons-everywhere), stronger hover/pressed states, violet reserved as primary-action emphasis (hero CTA).
- **Header/navigation (P2):** simplified product-style nav with a distinct Get-Plethora action, compact theme control (replacing the wide `Light | Auto | Dark` group), and a subtly sticky header after the hero; no floating capsule, no glassmorphism.
- **Reading Desk recomposition (P1):** drastically reduce intro dead space, show the sticky product stage simultaneously with the heading/chapters on desktop, add a numbered chapter rail with a violet active indicator (driven by the existing IntersectionObserver state machine), improve scene continuity so the 8 real scenes read as one document’s journey — using **document**, never essay.
- **Section storytelling (P1):** real product UI throughout — Capture gets a product-proof presentation (READ ANYTHING / REMEMBER IT editorial band converging into the real library screenshot); Read shows the actual reader scenes; Understand shows the real selected-passage interaction; Remember becomes a finite passage→Peck→card→review→schedule sequence reusing `remember.preview`/`review.question`/`review.answer`/`review.scheduled`; Connect replaces the wireframe note-pair with the real `connections.context` scene; Trust becomes positive claim-safe copy (“Your knowledge is yours.” direction) with a deeper data link.
- **Visual rhythm & asymmetry:** vary section scale/composition deliberately (full-width product moments vs narrow editorial columns vs oversized serif statements) with controlled asymmetry; preserve accessibility and responsiveness.
- **Terminology migration:** all production-facing **essay → document** and user-facing **surface(s) → device(s)** with an audited checklist; internal technical `surface` concepts unchanged.
- **Screenshot pipeline audit:** reuse the v2 capture manifest/pipeline; raise phone-frame source resolution if needed via the existing capture infra rather than hand-editing images; keep AVIF/WebP/PNG variants and budgets.

**Not changing:** demo state machine internals, capture fixture seeding, pricing/legal facts, app features beyond marketing presentation, framework, WebGL, scroll hijacking.

## Capabilities

### New Capabilities

- `useplethora-marketing-theme-chrome`: First-run light default theme, preference storage/migration semantics, dark-mode surface hierarchy, header/nav hierarchy with compact theme control and stuck state, and refined button/control language.
- `useplethora-hero-product-presentation`: The hero device composition — scale, overlap, depth, grid escape, generic premium phone framing, responsive/mobile fallbacks, and launch-aware CTA hierarchy.
- `useplethora-homepage-narrative-sections`: Reading Desk composition (rail, simultaneity, spacing), Capture/Read/Understand/Remember/Connect/Trust/proof-band storytelling with real UI, motion language, rhythm/asymmetry, and responsive/a11y/performance requirements for narrative sections.
- `useplethora-marketing-copy-discipline`: Terminology rules (document/device), elimination of development-state copy, and claim-safety gating for all production-facing website copy.

### Modified Capabilities

- none (no capabilities exist yet under `openspec/specs/` for the website; this change extends behavior defined by unarchived changes `design-useplethora-homepage-experience` and `revamp-useplethora-interactive-showcase`, whose demo internals it depends on but does not modify)

## Impact

- **Website styles:** `website/src/styles/tokens.css`, `brand.css`, `global.css` (theme tokens, control radius, header chrome, hero collage CSS).
- **Homepage components:** `website/src/components/home/**` (Hero, DeviceCollage, Ctas, DemoSlot fallback, Problem, Capture, Read, Understand, Remember, Connect, Trust, Platforms, PricingTeaser, Close, KnowledgePeck).
- **Chrome:** `website/src/components/chrome/SiteHeader.astro`, `ThemeToggle.astro`, `SiteFooter.astro`; `website/src/layouts/BaseLayout.astro` theme bootstrap script.
- **Demo (presentation only):** `website/src/components/demo/DemoIsland.css` and chapter/label copy strings in `DemoIsland.tsx`; `showcase.ts` untouched structurally; catalog narration strings in `showcase-scenes-v2.json` gain terminology edits (non-hash-guarded fields), with matching unit-test updates.
- **Config/copy:** `website/src/config/copy.ts`, `routes.ts` nav flags, `claims.json` allowedSurfaces extensions (shipping claims only), launch-aware CTA rendering in `launch.ts` consumers; terminology sweep across pages/content surfaced in the audit checklist.
- **Assets:** possibly additional mobile-width showcase variants produced through `scripts/marketing/**` capture tooling (reusing change-C infrastructure); manifest/budget updates under `website/scripts/`.
- **Tests:** Playwright e2e (visual snapshots, keyboard, reduced-motion, overflow), unit tests asserting showcase copy, dist/asset gates.
- Does NOT modify: `machine.ts` state logic, capture fixture seeds, app runtime code, pricing/legal config values, Vercel/env wiring.
