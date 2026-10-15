## Context

Verified current state (inspected in code and rendered locally at 1440×900 / 1728×1000 / 390×844):

- **Hero** (`brand.css`): `.device-desk` is `min(100%, 28rem)` (~444px at 1728px viewport, right edge ≈ 1402px → ~330px unused), `.device-phone` is `min(42%, 11rem)` at `right: 4%; bottom: -8%`; transforms are single `rotateY(-8deg)` / `rotateY(10deg)` on one `perspective(1200px)`; `.phone-bezel` is flat `#111` padding with the same `--shadow-frame` used by the desktop. Hero grid is `1.05fr / 0.95fr`.
- **Theme**: `BaseLayout.astro` inline script defaults to `system` when nothing is stored — confirmed live: dark-OS first visit gets `effectiveTheme=dark`. Dark tokens `--paper #121016 / --paper-2 #1a1622 / --paper-3 #251f30` sit within ~10% luminance of each other, so bands blend into one plane.
- **CTA**: `HomeCtas.astro` renders “Downloads are not published yet. This opens the downloads page.” under the primary button whenever `downloadsEnabled=false` (the current default).
- **Reading Desk** (`DemoIsland.css`): homepage variant has `padding-block: clamp(4.5rem, 8vw, 8rem)` plus intro `margin-bottom: clamp(3rem, 6vw, 6rem)`; chapter `<li>`s are `min-height: 72vh`. The stage (`sticky; top: 5.5rem`) exists but starts far below its heading. Machinery is strong: scene graph + IntersectionObserver chapter activation already drive desktop+phone compositions per chapter.
- **Assets**: v2 manifest ships 8 scenes × (desktop 720/1440, mobile 390) × AVIF/WebP/PNG under `/images/showcase/v2/2.0.0-2.7.0+9a6e7dc075b2/`, with hotspot metadata, theme `plethora-purple`, fixture/build provenance validated by `parseShowcaseData`. Total showcase weight 3.9MB for all variants.
- **Claims matrix** (`claims.json`): public-on-homepage rows: `local-reading-formats`, `incremental-reading`, `srs-fsrs`, `local-extracts`, `local-flashcards`. Trust-capable rows: `local-first-library`, `local-backups-export`, `byo-ai`. Shipping-but-not-homepage rows that matter here: `saved-position`, `local-tts`, `dictionary-peek`, `eink`, `image-occlusion`.
- **Gates**: `check-dist.mjs` enforces JS budget (180KB), banned phrases, claims, links; `check-assets.mjs` runs showcase validation; Playwright e2e covers a11y, keyboard hotspots, reduced motion, responsive snapshots.

Constraints inherited from prior changes: no glassmorphism, mesh gradients, particle fields, fake chat, mascots outside their beats, or wheel hijack (ship blockers from `design-useplethora-homepage-experience`); demo state machine (`machine.ts`) and capture fixtures are owned elsewhere (`revamp-useplethora-interactive-showcase`).

## Goals / Non-Goals

**Goals:**

- Hero reads as one staged product photograph: ≥1.4× larger desktop media than today at ≥1280px, phone as physical foreground device with believable depth.
- First visit lands on the light editorial theme unless the visitor chose otherwise; dark mode gains real hierarchy instead of abandonment.
- Product UI visible within the Reading Desk's first viewport on common desktop heights (≥768px-tall viewports).
- Every narrative section shows at least one real captured Plethora UI state (or an explicitly justified website-only composition of real crops).
- Copy audited: document/devices terminology, zero development-state sentences, claim-safe positives.
- No regression of LCP/CLS budgets, keyboard access, reduced-motion, or anti-generic rules.

**Non-Goals:**

- No changes to demo state logic (`machine.ts`), capture seeding/fixtures, analytics event schemas (field names like `surface` stay).
- No new app features to fill marketing gaps; missing scenes are either website-only compositions of real UI crops or documented capture requests — never invented UI.
- No WebGL/Three.js, scroll-jacking, autoplay ambient video, or JS motion libraries.
- Not redesigning inner pages beyond shared chrome/tokens they inherit (features/pricing/docs get tokens + header improvements automatically, not bespoke recompositions).

## Decisions

### D1. Theme default becomes Light; stored choices always win

- `BaseLayout.astro` bootstrap changes one branch: `stored === 'light' || stored === 'dark' ? stored : (stored === 'system' ? 'system' : 'light')`.
  - No key present → **Light** (was `system`). Key `system` → keeps following OS. Keys `light`/`dark` unchanged.
- Migration: users who never touched the toggle (the majority; the toggle is new-ish) get Light on next visit — intended, since dark default undermines the editorial identity. Anyone who ever clicked Auto explicitly stored `system` and is respected.
- The `ThemeToggle` segment, `plethora-theme-change` event, meta `theme-color` swap, and `tokens.css` selectors stay structurally identical. Only the fallback value and the `@media (prefers-color-scheme)` guard clause change (see D2): system-preference dark still applies when `data-theme='system'`.
- Decision points where "Auto" resets must be updated: any code path that writes `localStorage.removeItem('plethora-theme')` should write `'system'` instead, so "removed = system" can't silently become light-default-drift. (Audit finds none today; add a unit test pinning the semantics.)

*Alternative considered:* keep Auto default but add a hero-side "prefers light" hint — rejected: the brief calls the editorial identity P0; server-rendered first paint cannot A/B negotiate without FOUC risk.

### D2. Dark mode hierarchy through elevation, not neon

Keep all six mascot-violet hexes constant. Rework only neutral steps and shadows:

| Token | Current | New (dark) | Rationale |
|---|---|---|---|
| `--paper` | `#121016` | `#14101a` (page) | Keeps near-black violet base |
| `--paper-2` | `#1a1622` | `#1d1727` | Band separation ≥ ΔL*6 vs page |
| `--paper-3` | `#251f30` | `#2a2140` | Clearly elevated inset |
| `--surface-card` | `#1c1826` | `#211a30` | Cards read as objects |
| `--shadow-frame` | black 50% | layered: `0 0 0 1px rgb(255 255 255 / 0.06)` ring + `0.4rem 0.9rem 2rem rgb(0 0 0 / 0.62)` | Depth cue without glow |
| new `--elevated-hairline` | — | `rgb(244 239 230 / 0.09)` | Separate overlapping product frames |

Light theme keeps current paper values except introducing the same hairline token for framing stacked devices. Large editorial bands (`home-problem`, trust, close, reading-desk background) alternate `--paper` / `--paper-2` / (new) occasional `band-graphite`-style ink inversion used **once** — reserved for the Remember climax band — restoring rhythm that currently flattens.

Screenshot policy in dark mode: light-theme captures stay (they are genuinely bright content and become focal points); no separate dark captures this change (F-31 canonical-screenshot blocker stays out of scope). Each product frame gains a subtle `--elevated-hairline` border in dark mode so light screenshots don't look pasted.

### D3. Hero: one composition, measured targets

Replace two independently transformed figures with a `.hero-stage` wrapper (`perspective: 1600px` on wrapper; children share one perspective origin):

- **Scale:** desktop frame `clamp(30rem, 38vw, 40rem)` wide (target ≈35–40rem at ≥1440px vs 28rem today ⇒ ~1.45× linear). Grid shifts to `minmax(0, 0.85fr) minmax(0, 1.15fr)`. Exact ratios tuned during implementation within those bounds; acceptance measures rendered width ≥ 34rem at 1440px.
- **Grid escape:** at ≥1280px the media column may exceed `--wrap`: `.hero-stage { margin-right: min(0px, calc((var(--wrap) - 100vw) / 2 + var(--gutter))) }` pattern (or equivalent negative-margin trick inside a `grid-column` span). Text column stays on grid. Right bleed ≤ `(100vw − wrap)/2`; horizontal overflow forbidden — verify with overflow test.
- **Depth model (one language):**
  - Desktop: `rotateY(-14deg) rotateX(2deg) rotateZ(-0.5deg)` — slightly stronger than today because scale now carries realism; screenshot text legibility gate: body-size text in the 1440w capture remains readable (checked visually at 100% zoom).
  - Phone: separate plane, `rotateY(8deg) rotateX(1deg) rotateZ(0.75deg)`, positioned overlapping the desktop's right edge by **15–20% of the desktop width**, top third near desktop top, bottom extending below desktop bottom edge (staggered silhouettes read intentional).
  - Phone z-index above desktop; distinct shadow stacks: desktop gets wide soft ground shadow; phone gets tight contact shadow (small blur, high alpha, offset toward its light side) + subtle drop shadow — visibly different energies.
- **Mobile (<768px) fallback:** drop the desktop frame entirely (today it hides but the phone shrinks to 12rem under a text block). New order: headline → lede → CTAs → large mobile device presentation (~min(78vw, 20rem)) standing on a soft radial paper mat; caption line ties it to "your pocket library". Desktop capture reappears later (Reading Desk). Between 768–1279px: both frames, reduced angles (≤60% of desktop rotation values), overlap kept, media below text.
- Accessibility: transforms disabled under `prefers-reduced-motion` (static front-facing frames keep slight overlap), none of the copy sits in a transform context (H1/lede never skewed), `alt`s describe scenes not decoration.

### D4. Generic premium phone frame (and matching desk frame upgrade)

Layered construction around the mobile screenshot, ~4–6% bezel-to-screen ratio:

1. Outer rim: `border-radius: 2.1em; background: linear-gradient(145deg, #3a3644, #17141c 55%, #2c2735)` (metal edge highlight that flips light/dark sides),
2. Inner dark chamfer: 2px `#0b0a0f` ring,
3. Screen inset: screenshot with `border-radius: 1.5em`, inset `box-shadow: inset 0 0 2px rgb(0 0 0 / 0.8)`,
4. Top accent: small speaker slot (rounded pill, low contrast) + centered camera dot — generic, not iPhone-mimicry; no notch, no Dynamic Island,
5. Side sheen: 1px vertical highlight on one edge via pseudo-element gradient,
6. Thickness illusion: 2–3px darker bottom/right outer edge offset before the contact shadow.

The Reading Desk `__phone-frame` (DemoIsland.css) reuses the same tokens (shared CSS custom properties in tokens.css: `--device-rim-radius`, `--device-screen-radius`, gradients) so hero, desk, and simulator-mobile treatments converge. Desktop/laptop frame similarly gains an edge highlight + camera dot + base hinge shadow, one notch subtler than the phone.

### D5. Launch-aware CTA hierarchy, no dev-state prose

`HomeCtas.astro` states driven by `loadLaunchFlags()`:

| Flags | Primary CTA | Secondary |
|---|---|---|
| `downloadsEnabled` | "Get Plethora" → `/downloads` | "Try the interactive demo" → `#demo` |
| else | "Get Plethora — Coming soon" → `/downloads` (page explains availability honestly) | "See what it does" → `#demo` |

Delete the `.cta-note` disclaimer sentence entirely, everywhere (`hero`, `close` surfaces). Violet treatment: primary CTA background `--accent-hover`→ hover `--accent`; pressed adds `translateY(1px)` + reduced brightness; focus ring unchanged. Ghost secondary gets underline-on-hover + border `--line-strong`.

Same principle applied platform-wide (P0 item 8 "remove visible development-state messaging"):

- `HomePlatforms`: heading becomes “Desktop and mobile.” Status chips render honest human states from the manifest (“Available” / “In final testing” / “Planned”) — wording finalized against actual `DOWNLOADS.platforms[*].status/message` values during implementation; no manifest-speak.
- `HomePricingTeaser`: replace “Checkout is not live” / “display direction only” with launch-aware line linking `/pricing`; exact legal-safe phrasing drafted in tasks with claim-gate review.
- Trust section rewrite in D8.

### D6. Controls & radius language

- New token `--radius-control: 7px` (range tested 6–8px) applied to `.btn`, `.showcase-button`, `.showcase-tab`, inputs/selects, theme menu trigger. `--radius: 2px` remains the default for cards/panels/editorial boxes — cards do NOT round up.
- Hover states: primary buttons gain background shift + slight `box-shadow: 0 2px 8px rgb(28 25 22 / 0.18)`; ghost controls gain border-color strengthen + underline. Pressed: `translateY(1px)`.
- ThemeToggle: replaced by compact control — icon-only trigger button (44×44 target) opening a small disclosure menu with the three labeled options (radiogroup semantics, `aria-expanded`, arrow/Esc handling), OR a 3-icon segmented control if it fits comfortably beside nav at ≥1024px. Spec requires: visible current selection, keyboard operable, no layout shift, ≤ 44px height. Choice between menu vs segmented made in implementation review against real header width budget (nav labels + CTA at 1280/1024/768).

### D7. Header/nav hierarchy and stuck state

- Nav links trimmed by route flags (config-level `inPrimaryNav` edits): target set Features · How it works · Demo · Pricing · Docs; Downloads link moves to footer + CTA. ("Get Plethora" button lives right of nav.)
- Header becomes position-aware sticky: native `position: sticky; top: 0`, plus IO at a sentinel just below hero toggling `is-stuck`: background `color-mix(in srgb, var(--paper) 92%, transparent)` + `backdrop-filter: blur(8px)` guarded by `@supports (backdrop-filter...)` **and** omitted entirely under forced-colors or when "reduce transparency" is requested (`@media (prefers-reduced-transparency: reduce)` → solid `var(--paper)`). Border-bottom strengthens + `0 1px 12px rgb(28 25 22 / 0.06)` shadow while stuck. Height shrinks 4rem → 3.25rem transition-free (state classes only, animated color/background only ≤ 200ms).

### D8. Reading Desk composition

Structural changes to `reading-desk--homepage` (page variant inherits spacing/token fixes only):

1. **Simultaneity:** merge intro into the narrative grid — left rail column holds kicker + H2 + lede + chapter rail; right column holds the sticky stage. At 1024×768+, entering the section shows heading AND product stage together (stage aligned `top: 5.5rem`, min-height reduced to `min(72vh, 42rem)`).
2. **Dead space:** section padding-block → `clamp(2.5rem, 5vw, 4.5rem)` top / same bottom; intro margin-bottom → `var(--space-5)`. Chapter `li` min-height 72vh → clamp(38vh, 52vh); total scroll length preserved by five chapters ≈ 2.6 viewports, enough dwell time for the existing observer thresholds (`-24%/-48%` rootMargin kept).
3. **Chapter rail (replaces plain list):** chapters become numbered entries — `01 Collect … 05 Return` — with a persistent thin vertical progress track on the rail's left edge; active chapter's number marker fills `--accent` (violet), label transitions `opacity .48→1` (existing behavior retained), smooth marker movement via `transform translateY` keyed to the active index (CSS only). Not stepper-cards: no boxes, borders, equal-height card grids.
4. **Scene continuity:** the stage's desktop+phone composition persists across chapters; on chapter change images crossfade (`transition opacity 220ms` already present — extend with 12px upward drift and caption crossfade). Per-chapter captions («The document arrives in the library», «Reopened exactly where you stopped» …) update beneath/beside the stage using the SAME IntersectionObserver state — no new JS state machine; final copy uses *document* (D10 table).
5. Mobile/tablet (<64rem): rail collapses to a horizontal numbered mini-progress strip above each chapter's inline screenshot (existing per-chapter media); screenshot width min(100%, 22rem) → grows to `min(88vw, 26rem)` for presence.
6. Hotspots/"Try the flow" takeover behaviors, analytics events, keyboard hotspot navigation: untouched.

### D9. Section storytelling with real UI

Each weak section gets real captures (scene IDs from the v2 manifest). Website-only composites are built exclusively by cropping/masking the shipped screenshots (CSS `object-position`/`clip-path` over real assets), never by drawing fake chrome:

| Section | Today | Becomes |
|---|---|---|
| Problem | type only | keeps editorial narrow column; gains oversized pull-quote scale (rhythm anchor) |
| Capture | format strip text | **Product-proof band**: part A "READ ANYTHING" retains the 6-format strip (Books PDFs Articles Audio Video Notes) and pairs it with `library.ready` desktop crop converging fragment snippets (four small crops of real captures — reader, audio row, note, PDF cover — settling into the frame; finite, once-per-visit animation; static composition under reduced motion); part B "REMEMBER IT" lists Spaced repetition / Incremental reading / Flashcards / Image occlusion / TTS / Connections with per-item claim gating (see mapping below) |
| Read | typography only | split editorial: narrative left; right shows `reader.open` (desktop crop: progress + return point annotated with small real-UI callout fragments) + mobile reader panel; TTS/e-ink mentions appear only with claim-allowed or `data-claim-pending` markers |
| Understand | bordered paragraph | sequence strip: passage excerpt text (real fixture sentence) → `reader.selected` crop showing contextual actions; dictionary/explain/question actions named from real UI labels |
| Remember (climax) | Peck + hand-built card mock | full-width ink-inverted band; finite five-beat sequence on a shared device: passage → Knowledge Peck nod at the moment of extraction → `remember.preview` → `review.question` ↔ user-tappable reveal `review.answer` → schedule chip animating onto `review.scheduled`'s timeline crop. One pass on enter-view then rests at the scheduled beat; Replay control restores it; reduced-motion renders all five beats as a static annotated filmstrip. Peck appears once here (plus its existing sanctioned slots) — no page-wide mascot |
| Connect | two notes + "linked" | real `connections.context` capture (desktop) with the two actual related items from the demo fixture highlighted by subtle overlay rings tied to the relationship edge; mobile pair shown beneath for continuity. Fallback if highlights prove illegible: annotate with short real captions beside the frame (still real UI, no invented graph) |
| Platforms / Pricing / Trust | dev-state copy | rewritten per D5/D8 mapping; platforms get launch-state chips; pricing teaser tightened to plan facts + link |

Claim gating for new statements: every capability word in Capture-band/Read/etc. must resolve to a `claims.json` row with `public: true` and this surface listed, or carry `data-claim-pending="true"` (existing convention). Homepage misses are extended rather than faked: extend `allowedSurfaces` to `homepage` ONLY for verified-shipping rows whose evidence files confirm general availability — expected candidates: `saved-position`, `local-tts`, `dictionary-peek` (TTS/e-ink phrasing "on supported setups" preserved). `image-occlusion` keeps features-only routing (its evidence targets authoring UX), so proof-band lists it with pending marker or omits — decide at copy PR via the existing claims test.

Motion inventory (all sections): CSS-only, IntersectionObserver-triggered, run once per view, pause offscreen/hidden (reuse `[data-motion-scene]` helper), `prefers-reduced-motion` static-equivalent mandatory. No perpetual loops (hotspot cue pulse excepted, already gated).

### D10. Terminology migration rules

**essay → document** (user-facing). Audited occurrences:

| Location | Current | Action |
|---|---|---|
| `HomeCapture.astro` ×2 | "one essay…", "that essay lands" | → document |
| `HomeRead.astro` | "Tonight’s essay…" | → "Tonight’s document stays…" |
| `HomeConnect.astro` h2 | "The same essay, two notes…" | → "The same document…" (heading also superseded by Connect redesign) |
| `HomeRemember.astro` | "sleep essay" | → "sleep document" |
| `DemoIsland.tsx` chapters ×2 + SCENE_LABELS "Essay open" | essay | → document ("Document open") |
| `showcase-scenes-v2.json` narrations/accessibilityDescriptions ×~4 | "the essay" / "highlighting essay" | → document (fields are NOT hash-guarded by `parseShowcaseData`; update `machine.test.ts`/`DemoIsland.test.ts` expectations) |
| `asset-manifest.json` alts ×2 | "essay" | → document (+ downstream alt consumers) |
| `content/pages/readers.md` | "Books, essays, and papers" | **keep** — describes genuine essay-genre content, not the showcase artifact |
| `/demo`, how-it-works, commercial pages sweep | n/a | grep-audited in tasks; apply rule, no blind rename of quoted titles |

Narration sanity gates after edit: `npm test`, catalog parse (metadata fields untouched), `check:assets`.

**surface(s) → device(s)** (user-facing only):

- `claims.json` statement `eink`: "compatible reading surfaces" → "compatible reading devices" (user-visible on features/pricing; statement text change + claims test refresh).
- Sweep pages/content/marketing prose for "across surfaces"-style usage → devices.
- **Stays `surface`:** CSS custom properties (`--surface-*`), `claims.ts` `ClaimSurface`/`allowedSurfaces`, `analytics.ts` `ShowcaseSurface` and event properties, `HomeCtas surface=...` attribute prop, `showcase-scenes-v2.json` internal `"surface": "reader"` scene field (not user-visible), code/docs identifiers.

Enforcement: extend `scripts/check-dist.mjs` banned-phrase scan with production-copy greps for `\bessays?\b` and user-facing `surfaces?` whitelisted paths (starter whitelist: assets/config internals listed above), so regressions fail CI.

### D11. Screenshot/source quality

- Keep manifest pipeline as single source of truth; website must never alter pixels manually.
- Phone rendering target rises to ~19–21rem max → 390px-wide source yields ≈1.9× DPR at 480 device px — acceptable; if visual review shows softness, request a 480px mobile breakpoint from capture tooling (`sourceType: playwright-css-viewport` infra supports new size) — task included with explicit skip-if-unneeded criterion.
- Hero `sizes` attributes updated to truthful hints (`(min-width:1280px) 38vw, ...`), keeping eager/fetchpriority=high only on hero sources; everything below folds lazy.
- Budget additions to `scripts/showcase-budgets.json` + check-dist: per-image transfer caps (hero AVIF @1440 ≤ 140KB; sequential desk scenes lazy) and total-Above-the-fold ≤ 400KB; LCP element = hero H1 text or frame image (measure, don't assume), CLS < 0.02 (aspect-ratio boxes mandatory — device-frames e2e extended to hero-stage children).

## Risks / Trade-offs

- [Stronger perspective degrades screenshot readability] → cap rotations (±14° Y, ±2° X/Z); visual QA at 100%/200% zoom against readability checklist; reduced-motion strips transforms.
- [Grid-escape causes horizontal overflow on odd widths] → overflow test at 320/390/768/1024/1280/1440/1728 + margin-clamp formula bound; CI Playwright case.
- [Light default surprises returning dark-OS visitors who never chose] → accepted product decision (brief-directed); Auto remains one click away; migration notes recorded in design + rollout task.
- [Reading Desk shortening breaks IntersectionObserver activation windows] → keep rootMargin percentages relative; verify all 5 chapters activate in automated scroll test before/after parity.
- [Copy edits to showcase narrations diverge from capture provenance] → narration strings aren't hashed (verified in `parseShowcaseData`); run catalog tests + asset checker; keep `accessibleDescription` semantics accurate to depicted scene.
- [New dark shades drift from app themes] → brand-inventory hexes untouched; only neutral steps shift; screenshot spot-check against testid theme swatches.
- [Extra motion multiplies CLS/jank on low-end] → animations transform/opacity only, run-once, offscreen pause reuse; budgets enforced by existing perf spec + new image budgets.
- [claims.json allowedSurfaces extensions] → only `public:true` shipping rows with existing evidence paths; claims unit tests rerun; no new factual assertions authored.
- [Phone bezel detail reads gimmicky at small sizes] → speaker/camera details hidden below 240px render width (container/media query), rim+inset suffice.

## Migration Plan

1. Land P0 batch behind nothing (site is pre-index; `PUBLIC_INDEXING=noindex` default) — commit sequentially on main per AGENTS.md: tokens/theme → hero/framing → CTA states → dark hierarchy.
2. Recapture review screenshots (1440×900, 1728×1117, 1024×768, 768×1024, 390×844; light+dark) into `website/docs/review/refine-storytelling/`.
3. Run gates: `npm run check && npm test && npm run build && npm run check:dist && npm run check:assets && npx playwright test`.
4. Rollback: git revert per commit; theme default revert is a one-line flag restore; no data migrations exist (localStorage keys unchanged).

## Open Questions

- Final phone-frame proportions and whether the 480px mobile capture breakpoint is needed (decided via visual QA in P0 tasks; doesn't change specs).
- ThemeToggle as disclosure menu vs segmented icons (both satisfy the spec; picked in implementation against 1024/1280 header width measurements).
- Exact launch-chip wording per download status value (constrained to truthful mapping from `DOWNLOADS` statuses; finalized with legal-safe copy pass).
