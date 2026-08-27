## 1. Theme foundation (P0)

- [x] 1.1 Change `BaseLayout.astro` theme bootstrap fallback to light when no `plethora-theme` value is stored (`system` stays a live choice); add inline-script unit/e2e coverage for first-visit dark-OS → light with no FOUC.
- [x] 1.2 Audit all theme write/clear paths so "Auto" stores `'system'` explicitly; pin semantics in a unit test.
- [x] 1.3 Update `ThemeToggle` copy/aria to reflect Light / Auto (system) / Dark ordering unchanged; verify stored-choice rendering paths still pass existing tests.
- [x] 1.4 Rebalance dark tokens per design D2 (`--paper*` steps, card, layered `--shadow-frame`, new elevated-hairline token) in `tokens.css`; keep canonical mascot hexes byte-identical.
- [x] 1.5 Apply hairline framing to product frames in dark mode across hero/desk/section frames.
- [x] 1.6 Verify claims/banned-phrase/dist gates still pass with copy untouched at this point.

## 2. Hero composition (P0)

- [x] 2.1 Rebuild `.device-collage` into `.hero-stage` wrapper with shared perspective; implement desktop frame sizing `clamp(30rem, 38vw, 40rem)` and grid shift toward ~0.85fr/1.15fr in `brand.css`.
- [x] 2.2 Implement controlled grid escape ≥1280px with overflow-bounded right bleed; confirm zero horizontal overflow at 320–1728px test widths.
- [x] 2.3 Tune depth transforms per D3 (desktop rotateY ≈ −14°, rotateX 2°, rotateZ −0.5°; phone mirrored smaller set), overlap 15–20% of desktop width, staggered vertical silhouettes, z-order phone-front.
- [x] 2.4 Build distinct shadow stacks: wide soft ground shadow (desktop) vs tight contact shadow + subtle drop (phone); hero-specific, not global `--shadow-frame`.
- [x] 2.5 Implement generic premium phone frame per D4 (rim gradient, chamfer, inset screen shadow, thickness edge, speaker/camera suppressed <240px) as shared device tokens in `tokens.css`.
- [x] 2.6 Upgrade Reading Desk `__phone-frame` + simulator mobile frame to consume the same device tokens for visual convergence.
- [x] 2.7 Mobile fallback (<768px): headline→lede→CTAs→large mobile device on paper mat; desktop capture removed from mobile hero and reappears in Reading Desk; 768–1279px reduced-angle variant.
- [x] 2.8 Update hero `<picture>` sizes/srcset hints for the new rendered width; keep eager/fetchpriority=high limited to hero sources; re-measure LCP image weight against D11 caps.
- [x] 2.9 Visual QA pass: capture hero at 1440×900, 1728×1117 both themes; check screenshot text legibility under perspective at 100%/200% zoom; tune rotations/sizes within spec bands.

## 3. CTA hierarchy + dev-state copy removal (P0)

- [x] 3.1 Rework `HomeCtas.astro` per D5 state table (enabled: Get Plethora / demo; disabled: coming-soon primary + secondary label swap); delete `.cta-note` disclaimer everywhere.
- [x] 3.2 Give hero/close primary CTAs violet treatment with hover glow-shadow + pressed displacement; ghost secondary gets hover underline/border states.
- [x] 3.3 Rewrite `HomePlatforms.astro` heading/body to visitor-facing launch-state chips derived from `DOWNLOADS.platforms[*].status/message`; remove manifest-speak sentence.
- [x] 3.4 Rewrite `HomePricingTeaser.astro` copy to remove “Checkout is not live” / internal-direction phrasing while staying claim-safe; link through to `/pricing`.
- [x] 3.5 Sweep remaining homepage sections for implementation-state sentences; rewrite or relocate into honest user-facing wording; run banned-phrases + claims gates.

## 4. Controls, header, navigation (P2 chrome)

- [x] 4.1 Introduce `--radius-control` token (~7px) applied to buttons/tabs/inputs only; confirm cards/panels retain editorial radius; add hover/pressed state refinements to control styles.
- [x] 4.2 Replace theme toggle group with compact control (disclosure menu or segmented icons per open-question decision) meeting the ≤44px height, keyboard, visible-selection requirements.
- [x] 4.3 Adjust `routes.ts` nav flags + footer links to achieve product-style nav set (Features · How it works · Demo · Pricing · Docs + distinct Get-Plethora action; Downloads reachable from footer).
- [x] 4.4 Make header sticky-with-stuck-state via sentinel IntersectionObserver per D7 (translucent background guarded by `@supports`, solid under forced-colors/reduced-transparency, ≤200ms transitions, no layout shift).
- [x] 4.5 Keyboard/a11y test pass on new header + theme control (focus order, Esc/arrow handling, aria-expanded/pressed semantics).

## 5. Reading Desk recomposition (P1)

- [x] 5.1 Merge intro into narrative grid: left rail column (kicker/H2/lede/chapters) with sticky stage right; heading+stage simultaneity at ≥1024px×≥700px verified.
- [x] 5.2 Reduce section padding/intro margins and chapter min-heights per D8 numbers; preserve total scroll length for observer thresholds.
- [x] 5.3 Build numbered chapter rail with violet active indicator + progress track movement (CSS-only keyed off existing active-chapter class/state).
- [x] 5.4 Add persistent-frame scene continuity: crossfade/drift scene images and captions on chapter change using existing observer output; write document-based caption copy per D10 table.
- [x] 5.5 Improve ≤64rem presentation: horizontal numbered mini-progress strip, larger inline chapter screenshots `min(88vw, 26rem)`; keep interactive takeover behaviors intact.
- [x] 5.6 Re-run showcase Playwright suites (keyboard hotspots, responsive snapshots, reduced motion, performance spec); update snapshots intentionally and record before/after chapter-activation parity in an automated scroll test.

## 6. Section storytelling (P1)

- [x] 6.1 Capture section → product-proof band per D9: format strip retained + real `library.ready` crop with one-per-view fragment-convergence animation (offscreen pause, reduced-motion static).
- [x] 6.2 Add REMEMBER IT capability list with per-item claim mapping; extend `claims.json` `allowedSurfaces` to homepage only for verified shipping rows (`saved-position`, `local-tts`, `dictionary-peek` candidates) and mark or omit non-qualifying items (image occlusion decision documented in PR).
- [x] 6.3 Read section: real reader scenes (desktop crop + mobile panel) with return-to-position caption; TTS/e-ink mentions claim-gated.
- [x] 6.4 Understand section: passage excerpt + real `reader.selected` contextual-action presentation; no chat UI.
- [x] 6.5 Remember climax: full-width ink-inverted band; finite five-beat sequence (passage → Peck extraction moment → remember.preview → review.question/review.answer reveal interaction → schedule chip over review.scheduled timeline) with Replay control and reduced-motion filmstrip fallback.
- [x] 6.6 Connect section: replace note-pair wireframe with real `connections.context` presentation plus relationship highlight overlay or side captions (decision rule from D9).
- [x] 6.7 Trust section: positive ownership copy (“Your knowledge is yours.” direction) mapped to trust-capable public rows (`local-first-library`, `local-backups-export`, `byo-ai`) with deeper data-handling link; remove disclaimers.
- [x] 6.8 Problem/pricing/platforms rhythm pass: oversized pull-quote scale for Problem; consolidate width/scale variety record documenting each band's treatment.

## 7. Terminology migration + gates

- [x] 7.1 Apply essay→document edits per D10 table (HomeCapture, HomeRead, HomeConnect, HomeRemember, DemoIsland.tsx chapters/labels, showcase-scenes-v2.json narrations/accessibilityDescriptions, asset-manifest.json alts); keep `readers.md` genre listing.
- [x] 7.2 Update unit tests asserting changed strings (`machine.test.ts`, `DemoIsland.test.ts`, any alt consumers); run catalog parse + `npm run check:assets`.
- [x] 7.3 Rename user-facing surface usage (eink claim statement → devices) and sweep rendered pages/content; create whitelist of technical `surface` identifiers in the check config.
- [x] 7.4 Extend dist banned-phrase/check tooling with `essay(s)` production-copy grep (+ whitelist) and surface(s) report mode; add fixture tests for the gate.

## 8. Screenshot/asset quality (P2)

- [ ] 8.1 Audit current captures against D11 quality checklist (dimensions, no debug UI, consistent library/theme, DPI headroom at new render sizes); record findings.
- [ ] 8.2 If phone softness confirmed: request/add 480px mobile breakpoint via existing marketing capture pipeline (scripts/marketing + manifest regeneration), preserving hash/provenance policy; otherwise document skip rationale.
- [ ] 8.3 Update `scripts/showcase-budgets.json` + check-dist caps (hero AVIF ≤140KB @1440w, above-the-fold total cap); verify CI passes.

## 9. Cross-cutting validation + rollout evidence

- [ ] 9.1 Extend device-frames e2e to hero-stage children (aspect-ratio/width-height present; CLS guards) and add overflow regression spec across 320/390/768/1024/1280/1440/1728.
- [ ] 9.2 Matrix screenshot capture: light+dark × {390×844, 768×1024, 1024×768, 1440×900, 1728×1117} top-of-page + full-page, into `website/docs/review/refine-storytelling/`.
- [ ] 9.3 Reduced-motion, keyboard, and forced-colors manual verification recorded in the review doc (include OS-level reduce-motion toggle result for hero/Peck/proof animations).
- [ ] 9.4 Performance verification: run showcase-performance suite + spot Lighthouse pass; confirm budgets (JS total unchanged outside existing islands; LCP element measured; CLS < 0.02).
- [ ] 9.5 Write/refresh anti-generic attestation (banned-pattern table) inside the review doc citing new hero/sections.
- [ ] 9.6 Full gate chain locally: `npm run check && npm test && npm run build && npm run check:dist && npm run check:assets && npx playwright test` from `website/`; fix or file follow-ups.
- [ ] 9.7 `openspec validate refine-useplethora-visual-product-storytelling --strict` passes; tasks checked off progressively per batch (P0 → P1 → P2) with commits direct to `main` per repo workflow.
