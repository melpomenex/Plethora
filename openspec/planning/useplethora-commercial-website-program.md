# useplethora.com commercial website — program plan

Status: planning artifact (2026-08-23). Companion to six OpenSpec changes under `openspec/changes/`. Product: **Plethora**. Public site: **https://useplethora.com**. This program specifies the marketing website only. It does **not** implement the site, deploy to Vercel, or change application billing.

Canonical contracts: [`useplethora-website-shared-contracts.md`](./useplethora-website-shared-contracts.md).

## Vision

Plethora is a local-first reading, learning, retention, incremental-reading, and spaced-repetition application. The commercial site must make one idea inevitable:

> Everything you read. Remembered.

Supporting line (already in-product): **Read anything. Learn everything.**

The site is not a waitlist teaser. It is the finished commercial launch surface, able to go live the day legal entity, stores, and binaries exist — with downloads and checkout remaining **disabled** until those gates clear.

Plethora is not a read-it-later app. Read-it-later stops at save or read. Plethora continues through comprehension, extraction, connection, review, spaced repetition, and long-term recall.

Journey the homepage must enact, not merely list:

**Capture → Read → Understand → Connect → Remember**

## Commercial objective

- Convert serious readers, students, and researchers into installs of Free, then to **Plethora Pro** when they want sync, hosted intelligence, and cloud compute.
- Philosophy (already in `establish-plethora-commercial-product-foundation`): **do not paywall reading; paywall augmentation.**
- Display direction: Free; Pro **$5.99/month**; Pro **about $49.99/year**; storefront-localized prices where required. Prices are configuration, not layout.
- Personality: intelligent, academic without being institutional, playful without being childish, quirky but professional, calm, tactile, trustworthy, capable, rich without chaos.
- The site must be unmistakably Plethora — **Friendly Chirp** (P-bird in `assets/brand/plethora-icon-master.svg`), Knowledge Peck, paper-and-ink reading culture — not a generic AI SaaS landing page. Do not invent a second mascot or wordmark file (none exists).

## Audience

Primary: people who already read more than they retain (students, researchers, professionals, serious autodidacts).

Secondary: Anki/read-it-later migrants who need a precise, honest comparison.

Not: children; the mascot is a mark of craft, not a kids’-app cue.

## Repository audit summary (path-level evidence)

Audit date: 2026-08-23. Workspace: `/Volumes/external/mac-mini/Code/Plethora`. Empty sibling git repo `/Volumes/external/mac-mini/Code/plethora-website` contains only `.git` and is **not** the implementation home.

### OpenSpec conventions

| Finding | Path |
|---|---|
| Active OpenSpec tree (CLI `openspec`, schema `spec-driven`) | `openspec/` (`config.yaml`, `changes/`, `specs/`, `planning/`) |
| Legacy second tree (stale Incrementum `project.md`) | `OpenSpec/` on this case-sensitive volume — **do not add website work there** |
| Program-plan precedent | `openspec/planning/plethora-transformation-roadmap.md` |
| Artifact set per change | `proposal.md`, `specs/<capability>/spec.md`, `design.md`, `tasks.md`, `.openspec.yaml` |
| High-quality commercial precedent | `openspec/changes/establish-plethora-commercial-product-foundation/` |
| `openspec/AGENTS.md` | **does not exist**; follow CLI schema + this program |
| Root agent git rule | `AGENTS.md` (commit to `main` when asked; not used in this planning session) |

### Brand and mascot

| Finding | Path / notes |
|---|---|
| Canonical square mark | `assets/brand/plethora-icon-master.svg` |
| Adaptive foreground | `assets/brand/plethora-icon-foreground.svg` |
| Inventory + identifier rules | `BRANDING.md` |
| Mascot palette lock | `src/__tests__/brandInventory.test.ts` — body `#8B5CF6` `#7C3AED` `#5B21B6`. **Two beaks (intentional):** icon master `#6D28D9`; animated Chirp/Peck `#F59E0B`. Pupil `#1E1B4B` / `#241044`. Do not mix. |
| PWA `theme-color` leftover green | `#6daa2c` in `index.html` / `public/manifest.json` — **not** the marketing brand color (`BRANDING.md` D11) |
| Knowledge Peck startup | `openspec/changes/knowledge-peck-startup-animation/`; `src/components/startup/StartupBird.tsx`; `src/lib/startupAnimation/` |
| Optional in-app companion (off by default) | `src/components/companion/CompanionBird.tsx`; `openspec/changes/plethora-companion/` |
| In-product tagline | `src/config/product.ts` `PRODUCT_TAGLINE = 'Read anything. Learn everything.'` |
| Provisional API/domain in app config | `plethora.app` / `https://api.plethora.app` — **placeholders**, not the marketing domain |
| Green UI chrome still unresolved | `BRANDING.md` D11; `docs/release/PLETHORA_1_0_RC_FINDINGS.md` F-31 `#6daa2c` |
| Default app themes | `src/themes/builtin.ts` (many; not a marketing system) |
| Reading serif | `src/styles/reader.css` (Iowan/Charter/Source Serif 4) |
| UI font package present | `@fontsource/albert-sans` in `package.json` |

**Do not invent a replacement mascot.** Website reuses the master SVG / articulable bird derived from it.

### Existing web / hosting

| Finding | Path / notes |
|---|---|
| App is Tauri 2 + Vite + React (`plethora-tauri`) | `package.json` |
| **Existing `vercel.json` deploys the PWA**, not a marketing site | `vercel.json` — `buildCommand: npm run build:pwa`, SPA rewrite to `index.html`, Python transcript function |
| PWA scripts | `dev:pwa`, `build:pwa` in `package.json` |
| Express/API server | `server/` (`npm run server:dev`) |
| No npm workspaces / no `website/` package | root `package.json` is the app |
| README still points at Incrementum-era demo URL | `README.md` → `https://readsync.org` |
| CSP/transcript still mention readsync.org | `src-tauri/tauri.conf.json`, `src/utils/youtubeTranscript.ts` |
| No `.openai/hosting.json` | absent |
| CI | `.github/workflows/{ci.yml,release.yml,mobile.yml,...}` — must not be retargeted at the marketing site without an **additive** workflow |
| Empty `plethora-website` repo | sibling folder; git only, no commits |

**Decision (updated after hosting audit):**

1. **Never** put the marketing site inside the Tauri/PWA SPA. Root `vercel.json` stays the PWA (historically `readsync.org`). A second Vercel project is mandatory.
2. **OpenSpecs and brand sources stay in this Plethora repo** (founder instruction for this planning session).
3. **Implementation location:** preferred `website/` in this repo (Astro 5, Root Directory `website`) so demo libraries, screenshots, and OpenSpec share git history. The empty sibling `plethora-website` repo MAY be used as the Vercel-connected deploy remote **only if** it is a subtree/split of `website/` — it is not a second source of truth for copy or claims.
4. Do not introduce npm/pnpm/turbo workspaces solely to host the site. Independent `website/package.json` is enough.
5. Do not point marketing DNS at the PWA project.

### Product claims vs code (do not treat “file exists” as store-ready)

Capability registry (source of pricing-page truth, not homepage slogans): `src/types/entitlements.ts`. All listed capabilities default to **Pro** with local fallbacks. Free is the local-first floor.

| Claim area | Status | Evidence |
|---|---|---|
| PDF/EPUB/HTML/MD readers | Implemented (shipping on desktop) | `docs/IMPLEMENTATION_STATUS.md`; product docs under `docs/product/features/reading/` |
| Incremental reading, extracts, queue | Implemented | same; `docs/product/concepts/incremental-reading.md` |
| Saved position | Implemented | `docs/product/features/reading/position-restore.md` |
| TTS (local/system) | Implemented; **premium_tts is Pro** | entitlements `premium_tts`; `docs/product/features/tts/` |
| E-ink mode | Implemented | `docs/product/features/platform/eink-mode.md` |
| Dictionary peek | Implemented | `docs/product/features/language/dictionary-peek.md` |
| Explanations / grounded Q&A / summaries | Implemented, **provider-dependent** | `docs/product/features/ai/*`; BYO-key + local |
| Flashcards incl. cloze, Q&A, MCQ, image occlusion | Implemented | `src/components/review/ReviewCard.tsx`; `docs/product/features/review/image-occlusion.md` |
| Adaptive SRS (FSRS and others) | Implemented | `docs/product/features/scheduling/` |
| Knowledge graph UI | Implemented locally; **`knowledge_graph` capability is Pro in registry** | `src/components/graph/`; entitlements |
| Local backups / export / `.plethora` / `.apkg` | Implemented | `docs/PRIVACY_ARCHITECTURE.md`; `docs/product/features/imports/anki-apkg.md` |
| Anki **package** import/export | Implemented | `docs/product/features/imports/anki-apkg.md` |
| AnkiConnect **live sync** | **Do not market as shipping** | `docs/IMPLEMENTATION_STATUS.md` “Planned”; UI+client exist in `src/api/integrations.ts` / `IntegrationSettings.tsx`; `docs/USER_HANDBOOK.md` **overclaims** bidirectional sync |
| Cross-device Plethora E2EE sync | **Do not market as shipping** | Billing/launch audit: `src-tauri/src/sync/` in-memory/empty pull; Yjs realtime **removed**; OpenSpec/`RUN_LOG` overclaim. Crypto helpers ≠ product. |
| Zero-knowledge / E2EE multi-device | **Gated / blocked** | Conflicting docs vs stub engine. Public copy forbidden until a verified threat model **and** a working sync path. |
| Pro capability gating | **Not enforced in UI** | `CapabilityGate` / `useCapability` exist but are unused at reader/TTS/graph/transcription call sites. Do **not** say “Free cannot X / Pro unlocks X” as current behavior. Say intended launch packaging, or only describe local features everyone has today. |
| Web/desktop paid checkout | **Absent** | No Stripe/Paddle provider. Checkout CTAs stay disabled. |
| Google Play Billing | **Absent** | No `plethora-playbilling` plugin. |
| iOS IAP | **Code, not commercially proven** | StoreKit2 provider exists; not device/sandbox complete. |
| Display prices $5.99 / $49.99 | **Founder direction only** | **Not in application code.** Mock StoreKit fixtures use **$9.99 / $79.99** — the website MUST NOT copy fixture prices. |
| OCR / cloud transcription / premium TTS | Local paths exist; cloud/premium are Pro + provider-dependent | entitlements |
| Advanced analytics | Local stats exist; `advanced_analytics` is Pro | entitlements |
| Windows / macOS / Linux desktop | Shipping (self-signed macOS noted) | `docs/IMPLEMENTATION_STATUS.md` |
| Android APK | Shipping sideload; **Play enrollment open** | human checklist |
| iOS | Simulator / in progress; **not App Store ready** | `docs/IMPLEMENTATION_STATUS.md`; `prepare-plethora-ios-app-store-listing-and-review-package` |
| Billing / $5.99 / $49.99 | **Not in application code** | no price literals; `implement-cross-platform-subscription-billing-and-license-management` still describes absent StoreKit/Play/web checkout |
| Legal entity / D-U-N-S / store banking | **Blocked-external** | `docs/release/PLETHORA_1_0_HUMAN_LAUNCH_CHECKLIST.md` |

### Screenshot / demo infrastructure to reuse

| Finding | Path |
|---|---|
| First-run demo dir (currently README only; no books committed) | `demo/README.md` (`demo/apkg`, `demo/books`) |
| PWA demo loader | `src/lib/demoContent.ts` |
| Demo-mode OpenSpec | `openspec/changes/add-demo-mode-with-onboarding/` |
| Playwright visual tests (PDF reflow, phone **390×844**, warn-only CI) | `playwright.config.ts`; `npm run test:visual`; freeze query `kp-freeze` / `plethora-display-mode=eink` |
| In-app screenshot overlay (not marketing) | `src-tauri/src/screenshot.rs`; `src/utils/screenshotCapture.ts` |
| Checked-in mobile PNGs (provenance unverified for launch) | `docs/release/*.png` (`1_library.png` … `6_stats.png`) |
| iOS listing screenshot storyboard (RC-build rule) | `openspec/changes/prepare-plethora-ios-app-store-listing-and-review-package/` |
| Store screenshot capture still an open human task | launch checklist “Produce final app screenshots… after the green-theme decision” |

**Do not build a parallel screenshot world.** Populate `demo/apkg` + `demo/books` (importers already exist). Extend Playwright with scene-freeze URLs (Knowledge Peck pattern). Keep store-size captures (6.9"/6.5"/iPad 13") as a **device/RC** path per listing OpenSpec — CSS 390×844 is not an App Store screenshot. **Do not** update `src/visual/__snapshots__` when regenerating marketing shots. **Do not** use in-app `screenshot.rs` overlay as store tooling. **Do not** add Percy/Chromatic/Storybook unless hosted review is explicitly required.

### Overlapping active OpenSpecs

Website changes MUST NOT implement billing, entitlements, sync, or store listing copy as product work. They **consume** facts from:

- `establish-plethora-commercial-product-foundation` (capability registry; tasks marked done)
- `implement-cross-platform-subscription-billing-and-license-management`
- `implement-plethora-accounts-authentication-and-entitlements`
- `implement-plethora-pro-feature-discovery-upgrade-and-paywall-ux`
- `prepare-plethora-for-apple-app-store-and-google-play-commercial-release`
- `prepare-plethora-ios-app-store-listing-and-review-package`
- `implement-plethora-cloud-privacy-security-data-export-and-account-deletion`
- `canonical-product-documentation-and-ask-plethora` (docs corpus → Help page)
- `knowledge-peck-startup-animation` / `plethora-companion` (mascot motion vocabulary)
- `complete-plethora-identity-cleanup` / `rebrand-incrementum-to-plethora`
- `plethora-1-0-release-candidate-hardening`

No prior change owns `website/` or useplethora.com.

## Design principles

1. **Product-specific or it does not ship.** If swapping the logo would make the page work for another AI startup, rewrite.
2. **Story over checklist.** One artifact travels Capture→Remember on the homepage.
3. **Real pixels.** Production shots come from the real app + canonical library. No fictional chrome that invents features.
4. **Remember > generate.** Intelligence is grounded explanation, not magic.
5. **Local-first calm on trust pages.** No mascot theater on Privacy, Security, Pricing legal notes, or Terms.
6. **Mascot as pecker of ideas**, not clip art. Knowledge Peck: notice → select → card. Rare, motivated, reduced-motion safe.
7. **Progressive enhancement.** Content and CTAs work if JS/animation fail.
8. **Configuration over redesign.** Plans, download URLs, checkout, indexing, and claims flags change in data files.
9. **No fabricated social proof.** No fake reviews, user counts, awards, or latency stats.
10. **Banned patterns:** glowing gradient blobs as the design; purple mesh behind every section; repetitive rounded feature cards; empty glassmorphism; particles; fake AI chat as hero; endless typing loops; constantly floating panels; stock illustrations; gratuitous 3D; neon; vague AI copy; motion unrelated to reading/memory; scroll hijacking; dead controls.

Dial read (for implementers): marketing site for literate adults; editorial + tactile product photography; **variance 6 / motion 5 / density 4**, dropping motion to 2 under `prefers-reduced-motion` and on trust pages.

## Information architecture

| Route | Owner change | Notes |
|---|---|---|
| `/` | B (visual + narrative), D (demo island), C (assets) | Foundation owns shell |
| `/features` | E | Claim-gated |
| `/how-it-works` | E | Mirrors homepage story in static form |
| `/pricing` | E | Free vs Pro from entitlement registry + display prices |
| `/downloads` | E | Platform detect + all downloads |
| `/privacy` | E | Draft until counsel; launch gate |
| `/security` | E | Only verified statements |
| `/docs` `/docs/*` | E | May index `docs/product/` or curated subset |
| `/changelog` | E | From `CHANGELOG.md` or a curated feed |
| `/support` `/contact` | E | Destinations from config |
| `/terms` `/refunds` | E | Placeholders + gates |
| `/students` `/readers` `/researchers` `/spaced-repetition` `/incremental-reading` `/read-it-later` `/anki` | E | Distinct angles; canonical tags to avoid duplicate SEO |
| `/demo` optional | D | Deep link into demo state |

Global chrome (nav, footer, skip link, cookie/consent slot): **A**.

## Proposal index

| # | Change | Wave | Owns |
|---|---|---|---|
| A | `create-useplethora-website-foundation` | 0 | `website/` package, Astro, routes shell, launch config, Vercel project files **under `website/`**, headers, env schema, shared TS contracts |
| B | `design-useplethora-homepage-experience` | 1 | Visual tokens, homepage sections, mascot, motion, device collage layout, banned-pattern checklist |
| C | `create-plethora-marketing-demo-assets` | 1 | Demo library, licenses, capture scripts, manifests, optimized derivatives |
| D | `build-useplethora-interactive-product-demo` | 2 | Demo state machine, device shells, a11y alternative, lazy island |
| E | `create-useplethora-commercial-pages` | 1 content / 3 facts | Secondary pages, pricing matrix, downloads, legal scaffolding, audience pages |
| F | `establish-useplethora-website-quality-gates` | 0 scaffold / 4 enforce | Tests, Lighthouse, a11y, SEO, analytics validation, launch checklist, rollback |

## Dependency graph

```text
                    PROGRAM + CONTRACTS (this folder)
                                │
                                ▼
              A  create-useplethora-website-foundation
                 (website/ exists, types, flags, Vercel app config)
                     │
     ┌───────────────┼───────────────────┬────────────────────┐
     ▼               ▼                   ▼                    ▼
     C            E (IA + MD)            B                 F (test harness)
  assets          copy structures     homepage look      (can stub pages)
     │               │                   │
     └──────┬────────┘                   │
            ▼                            ▼
            D  interactive demo  ← real screenshots from C
            B  swaps placeholder frames for C assets
            E  fills prices/downloads when founder provides facts
            ▼
            F  full gates + launch rehearsal
```

Hard edges:

- B, D, E MUST NOT create a second package or competing router.
- D MUST consume C’s manifest; placeholders allowed until C lands, tracked as blockers.
- E MUST consume A’s plan/download/legal config; MUST NOT hard-code Stripe URLs.
- F MAY start on A’s scaffold (link check, a11y on empty layout) but production budgets wait for B+D.

## File ownership (exclusive unless noted)

| Path | Owner | Others |
|---|---|---|
| `website/package.json`, `website/astro.config.ts`, `website/src/env.d.ts` | A | none |
| `website/vercel.json`, `website/.vercelignore`, `website/src/middleware.ts` | A | F may add headers tests, not duplicate config |
| `website/src/config/launch.ts` `plans.ts` `downloads.ts` `legal.ts` `claims.ts` `analytics.ts` `demo-contract.ts` | A creates; **E owns content of plans/downloads/legal/claims**; **D owns demo-contract additions via PR to A’s types only if needed** | B reads tokens |
| `website/src/styles/tokens.css` `brand.css` | B | A may import once |
| `website/src/pages/index.astro` + `website/src/components/home/**` | B | D mounts demo in an agreed slot `HomeDemoSlot` |
| `website/src/components/demo/**` | D | B styles the frame chrome only via tokens |
| `website/src/pages/{features,how-it-works,pricing,downloads,privacy,security,docs,changelog,support,contact,terms,refunds,students,readers,researchers,spaced-repetition,incremental-reading,read-it-later,anki}.*` | E | none |
| `website/src/layouts/` `website/src/components/chrome/` | A | B/E consume |
| `marketing/demo-library/**` `marketing/licenses/**` | C | app seed script may read |
| `marketing/screenshots/**` `website/public/images/product/**` | C | B/D consume |
| `scripts/marketing/**` | C | F calls freshness check |
| `website/tests/**` `website/playwright.config.ts` | F | others add fixtures under their dirs |
| Root `vercel.json` | **untouched** (PWA) | A documents coexistence |
| App source `src/**` `src-tauri/**` | C may add a **seed/capture** entry behind a flag; no behavior change for default users | D MUST NOT import app stores |

## Asset ownership

- Mascot SVG: copy or import from `assets/brand/` into `website/src/assets/brand/` (C or B; **B owns usage**, C owns rasterization if needed).
- Product screenshots: C.
- OG/social default card: B art-directs, C produces from real UI if possible.
- Fonts: B chooses subsets; A wires loading.

## Implementation waves

### Wave 0 — Contracts and foundation

- Land A (package, layout, flags, Vercel config files, no production deploy required).
- F scaffolds test runner and CI workflow `website-ci.yml` (additive).
- Founder: confirm Vercel team/project name (do not guess; do not paste tokens).

### Wave 1 — Parallel construction

- C: demo library + capture pipeline (can run on a developer machine with the app).
- E: page IA, MD/content collections, claim matrix UI states (checkout disabled).
- B: homepage visual system with **labeled placeholders** if C assets are not ready.
- F: a11y lint + HTML snapshot tests against A+E routes.

### Wave 2 — Integrated product experience

- D: demo island on B’s slot, using C stills + curated prototype chrome that matches captured UI.
- B: replace placeholders; device collage; motion; reduced-motion variants.

### Wave 3 — Commercial integration

- E: real download URLs or explicit coming-soon; pricing config; legal drafts; support email **only if founder supplies**.
- Analytics wired but off until consent/provider decision.
- Changelog/docs integration.

### Wave 4 — Release verification

- F: budgets, browsers, SEO, staging noindex, rehearsal, rollback doc.
- Production domain, www redirect, launch-day flag flip. **Still not part of this planning session.**

## Launch blockers (website)

Tracked in `website/src/config/launch-blockers.ts` (A creates the type; F fails CI if production `PUBLIC_INDEXING=index` while any `severity: "block"` remains).

Blockers known today:

1. Legal entity name, jurisdiction, terms, privacy, refunds — human checklist.
2. D-U-N-S / Apple org enrollment — not website-displayed, but blocks iOS download links.
3. Store products + localized prices.
4. Desktop/mobile binaries and store URLs.
5. Canonical screenshot set from RC build (F-31 theme decision).
6. Verified encryption/privacy copy.
7. AnkiConnect claim resolution (handbook vs status doc).
8. Support email / contact path.
9. Vercel project linked to the **website** directory, not the PWA `vercel.json`.
10. Decision: public tagline override vs `PRODUCT_TAGLINE` in the app.

## Decisions required from the founder

1. Confirm **useplethora.com** as canonical (vs `plethora.app` placeholder in `src/config/product.ts`).
2. Confirm homepage primary headline **Everything you read. Remembered.** (app still uses the supporting line as `PRODUCT_TAGLINE`).
3. Free vs Pro matrix: adopt entitlements registry as source, then explicitly add/remove rows (OCR, TTS, sync, graph).
4. Trial: none unless you enable it in config.
5. Analytics vendor (Plausible / none / other) and cookie-consent necessity.
6. Help: curated marketing docs vs exposing `docs/product/` wholesale.
7. Whether sideload Android APK is offered before Play.
8. Whether iOS section is “coming soon” until TestFlight/App Store.
9. Green vs purple app chrome before final screenshots (F-31).
10. Vercel **team and project** for the marketing site (verify CLI `vercel whoami` / link; never paste tokens into git or chat).
11. Legal copy: draft-in-public vs noindex until counsel.
12. Demo topic: recommend **memory, sleep, and learning** (coherent, non-copyright). Confirm or replace.

## Risks

| Risk | Mitigation |
|---|---|
| Overwriting PWA Vercel project | Separate project; never change root `vercel.json` in website changes |
| Marketing invented UI | C’s RC-capture rule; F visual drift check |
| Claiming Pro/sync/ZK too early | Claim matrix; CI grep for banned phrases when flags off |
| Generic AI aesthetic | B’s prohibition list + review artifact (screenshots at 4 widths) |
| Scroll hijack / inaccessible demo | No `preventDefault` on wheel; CSS fallbacks; SR script |
| Duplicate OpenSpec trees | Only `openspec/` |
| Handbook AnkiConnect overclaim | E must follow `IMPLEMENTATION_STATUS` not handbook |
| Font/app theme mismatch | Website editorial tokens; don’t dump 65 @fontsource families |
| Motion JS cost | CSS-first; demo code-split; pause offscreen |

## Definition of website launch readiness

Ready for **indexed production** only when all are true:

- [ ] A–F tasks complete or explicitly deferred with founder sign-off
- [ ] `PUBLIC_INDEXING=index` and robots allow `/` 
- [ ] Legal entity + final Privacy + Terms + refunds
- [ ] Claim matrix has no `public: true` rows below allowed statuses
- [ ] Download buttons match real artifacts or labeled coming-soon
- [ ] Checkout disabled **or** live against real products (no fake in-demo prices)
- [ ] Lighthouse + a11y + CWV budgets pass on production URL
- [ ] Staging remains noindex
- [ ] OG images and sitemap valid
- [ ] Rollback procedure rehearsed
- [ ] Post-deploy smoke (home, pricing, downloads, privacy, demo start) recorded

**Preview/staging** may go live earlier with `noindex`, disabled checkout/downloads, and draft legal banners.

## Audit follow-up (2026-08-23)

Evidence from parallel repo audits was merged into this program and the six changes:

- Hosting: not a workspaces monorepo; PWA already occupies root Vercel; marketing is a **second project**. `website/` in this repo remains the preferred source; empty `plethora-website` is deploy-remote-only if used.
- Brand: in-product tagline is **Read anything. Learn everything.** Site H1 **Everything you read. Remembered.** is founder-direction until confirmed. Canonical bird is Friendly Chirp; two beak hexes; PWA green is not brand.
- Screenshots: reuse Playwright + `demo/` importers; 390×844 CSS ≠ store sizes; warn-only app visual CI must not be rewritten.
- Commercial honesty: Pro gates unused; sync stub; no web checkout; no Play Billing; $5.99/$49.99 not in code (do not use $9.99 fixtures); AnkiConnect not a public claim.

## Fleet prompts (after this planning session)

See the final report in the planning conversation and `openspec/planning/useplethora-website-fleet-prompts.md`.
