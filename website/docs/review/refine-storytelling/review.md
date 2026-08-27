# Review: refine-useplethora-visual-product-storytelling

Rollout evidence for the homepage visual storytelling change. Screenshots in
`matrix/` (light+dark × 390×844, 768×1024, 1024×768, 1440×900, 1728×1117 —
top-of-page and full-page) and RM/forced-colors captures alongside this file.
Interim batch captures live in `tmp-batch2/`.

## Batch-by-batch record

| Batch | Commit focus | Evidence |
| --- | --- | --- |
| 1 Theme foundation | First-visit Light default, dark elevation ladder, hairline framing | `theme.spec.ts` (5), unit `theme.test.ts` (18) |
| 2 Hero composition | hero-stage, device framing, grid escape, mobile mat | `tmp-batch2/hero-*.png`, overflow probes 0px |
| 3 CTA hierarchy | Violet primary moments, chips, no dev-state prose | `tmp-batch2/cta-1440-light.png` |
| 4 Chrome | Control radius, compact theme control, nav, stuck header | `chrome-1024-light.png`, `header.spec.ts` (3) |
| 5 Reading Desk | Rail grid, simultaneity, numbered chapters, captions | `tmp-batch2/desk-*.png`, `reading-desk.spec.ts` (4) |
| 6 Section storytelling | Real UI in every beat, Remember climax band | `tmp-batch2/section-*.png`, `frag-tuned2.png` |
| 7 Terminology | document/device copy, dist gate | gate fixtures (9), `essay-free` dist line |
| 8 Asset quality | Hero caps, 480-ready encode | budget negative test |
| 9 Validation | This document + full gate chain | below |

## Accessibility / input verification (task 9.3)

Automated (CI-runnable):

- axe WCAG 2.2 AA: all six audited pages pass (`a11y.spec.ts`).
- Keyboard: skip-link → mark → 5 nav links → theme control (visible
  `:focus-visible`, explicit-write semantics) → header CTA (`header.spec.ts`);
  hotspot arrow/Enter/Escape behavior unchanged (`demo-keyboard.spec.ts`).
- Remember band keyboard flow verified manually-in-spec: Tab reaches the
  Show-answer control during the question beat, Enter advances to the answer
  beat (`beatAfterEnter=answer`), Replay is a labeled button with focus ring.
- Reduced motion (emulated `prefers-reduced-motion: reduce`, the harness
  equivalent of the OS toggle):
  - hero transforms compute to `none` (`heroDeskTransform=none`,
    `rm-hero-1440-light.png`);
  - Remember band renders the static six-panel filmstrip
    (`filmstripVisibleBeats=6`, `rm-remember-filmstrip.png`);
  - capture fragments render settled (`fragmentAnimation=none`).
- Forced colors (emulated): stuck header falls back to a solid background
  (`forcedColorsHeaderBg=rgb(255,255,255)`, `forced-colors-stuck-header.png`).

OS-level reduce-motion was exercised through Chromium's emulation layer; no
physical macOS/Windows machine was driven in this environment.

## Performance (task 9.4)

- `showcase-performance.spec.ts` passes: short viewports request no island JS
  and no scene imagery until the demo CTA is used.
- Spot check at 1440×900: LCP element = hero desktop image (`IMG.`), LCP
  212 ms on local preview; CLS = 0 (aspect-ratio boxes on all stage children,
  enforced by `device-frames.spec.ts`).
- Hero transfer: desktop AVIF 27.7 KB + mobile AVIF 12.1 KB ≈ 40 KB, against
  the new 400 KB above-the-fold cap and the 140 KB per-image cap
  (`scripts/showcase-budgets.json`, enforced in `check-showcase-assets.mjs`).
- No new runtime JS beyond the existing islands: hero/sections are
  Astro-rendered HTML/CSS; the Remember beats engine is a small inline module
  inside the existing homepage bundle budget (`check:dist` DemoIsland gzip
  16.6 KB / 24 KB cap; homepage initial JS 0).

## Anti-generic attestation (task 9.5)

Banned-pattern sweep against the `design-useplethora-homepage-experience`
ship-blockers, reviewed against `matrix/full-1440x900-{light,dark}.png` and
`tmp-batch2/`:

| Banned pattern | Present? | Where checked |
| --- | --- | --- |
| Glassmorphism / blur panels | No — blur only on the stuck header bar behind an `@supports` guard with solid fallbacks (chrome, not a panel) | header.spec, forced-colors shot |
| Mesh/purple gradient wallpapers | No — violet appears as: compact theme control selection, hero/close primary CTA, rail markers, passage rule, schedule chip | matrix |
| Particle fields / fake node graphs | No — Connect uses the real `connections.context` capture; the wireframe note-pair is gone | `section-connect.png` |
| Fake chat UI | No — Understand shows the real `reader.selected` contextual actions | `section-read.png` (bottom) |
| Mascot outside sanctioned beats | No — Knowledge Peck appears exactly once, as the finite extraction beat inside the Remember band; still elsewhere | `section-remember.png` |
| Autoplaying ambient video / WebGL / scroll hijacking | No — all motion is CSS keyframes or IntersectionObserver class toggles; native scrolling untouched | `reading-desk.spec.ts` |
| Equal-width card grids for chapters/controls | No — chapter rail is typographic with numbered markers; proof lists are two-column editorial text | `tmp-batch2/desk-entry-1440-light.png` |
| Pill-shaped controls site-wide | No — `--radius-control` (7px) on buttons/tabs/inputs only; cards keep 2px | `chrome-1024-light.png` |

## Design deviations and decisions (documented per guardrails)

1. **Stuck header height** (D7 said 4rem → 3.25rem): intentionally not
   implemented. A sticky element reserves its own box, so shrinking it shifts
   all content below — directly violating the ≤1px layout-shift requirement
   that shares the same design paragraph. Geometry is frozen; only
   color/border/shadow animate.
2. **Theme control**: segmented icon-only control chosen over the disclosure
   menu. Measured at 1024px the header holds 5 links + control + CTA with
   ~250px slack; the segmented control reuses the exact `[data-theme-set]`
   semantics under test and avoids focus-trap/Esc machinery. Group height 34px
   ≤ the 44px requirement.
3. **Rail progress movement**: implemented as violet fill of visited track
   segments via `:has(> li:nth-child(n).is-active)` cascades rather than a
   translated marker, so movement is exact without measuring variable chapter
   heights. Active marker + label opacity per design.
4. **Scene continuity**: chapter change replays a 300ms fade/12px drift on a
   keyed composition (fade-in over the persistent frames) instead of a
   two-image crossfade; frames themselves never move, satisfying the
   "one continuous product story" requirement without keeping two scenes
   mounted.
5. **Above-the-fold eager image on mobile**: the hero desktop capture stays
   `loading="eager"` even where CSS hides it (<768px). Astro cannot branch
   `<picture>` sources per-viewport without JS; cost is one ~28KB AVIF, within
   the measured caps. Candidate for a `<source media>` split if budgets tighten.

## Known issues / follow-ups

- `showcase-responsive.spec.ts:83` (asset-failure path) is intermittently
  flaky: the 404-then-reload race occasionally misses its 5s window. Observed
  failing before this change as well; not addressed here.
- 480px mobile capture breakpoint: requested via `scripts/marketing/surfaces.mjs`
  note + encode-side [390, 480] support (inert today). Land it on the next
  sanctioned capture run; the hero phone at DPR 2 currently upscales the 390
  source ~1.64× at its largest render.
- Root `npm run test:scripts`: 2 platform-specific failures (iOS project
  overrides, `collectEnvironment(darwin)`) exist on unmodified main under
  Linux and are unrelated to this change.
- Environment note: this machine's Node 22 build lacks the built-in TypeScript
  stripper, so `npm test` requires a TS loader hook locally; CI/runtime
  environments with standard Node builds are unaffected.
