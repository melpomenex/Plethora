# Homepage anti-generic review

Change: `design-useplethora-homepage-experience` (B).  
Product: Plethora. Route: `/`.  
Date: 2026-08-23.

**Design read:** commercial marketing homepage for serious readers, editorial paper-and-ink (not dark-AI SaaS). Dials from the program plan: variance 6, motion 5, density 4.

## Screenshots

Captured with headless Chromium against the Astro preview of `website/dist` (viewport, not full-page):

| Width | File |
|---|---|
| 1440×900 | [review/homepage-1440.png](./review/homepage-1440.png) |
| 390×844 | [review/homepage-390.png](./review/homepage-390.png) |

Cursor IDE browser MCP could not attach a tab in this session. Layout at 320 / 768 / 1024 was checked in CSS (`brand.css` breakpoints) rather than extra PNG captures. After C lands real frames, recapture the collage.

## Banned-pattern attestation

| Pattern | Absent? | Notes |
|---|---|---|
| Hero mesh / purple gradient wallpaper | Yes | Paper `--paper`; violet only on Friendly Chirp |
| Three identical rounded feature cards as first fold | Yes | Split hero + labeled device frames |
| Glassmorphism | Yes | Header/footer are paper + hairline |
| Particle canvas | Yes | None |
| Fake LLM chat as hero | Yes | None |
| Looping typewriter slogan | Yes | Static H1 |
| Second mascot / 3D remix | Yes | Master paths from `assets/brand/plethora-icon-master.svg`; Peck uses amber beak `#F59E0B` |
| Lottie confetti | Yes | None |
| “Powered by AI” ungrounded | Yes | Understand copy is passage-grounded + `data-claim-pending` |
| Fake product chrome / invented UI | Yes | Frames are `data-placeholder="true"` + “screenshot pending” |
| PWA green `#6daa2c` | Yes | Not used |
| Wheel hijack | Yes | No `wheel` / `preventDefault` listeners |
| Perpetual rAF decoration | Yes | One CSS Peck nod; IO + `document.hidden` pause |
| JS motion library | Yes | None added (task 4.5 N/A; no bundle-byte PR note) |
| Dark-AI default theme | Yes | Light paper site; no graphite band shipped (task 1.3) |
| Neon on trust | Yes | `#trust` is still type on `--paper-2`, no Peck |

## Narrative and copy

Order: hero → demo slot (D mount) → problem → capture → read → understand → remember → connect → trust → platforms → pricing → close.

Single story artifact: a sleep-and-memory essay (capture through connect). Remember `min-height: 100dvh` and larger display type than Understand.

H1: “Everything you read. Remembered.”  
Supporting: “Read anything. Learn everything.”  
CTAs: Get Plethora → `/downloads` with coming-soon from launch flags; Try the interactive demo → `#demo`.

`CLAIMS` has no `public: true` rows allowed on homepage. Capability sentences use `data-claim-pending`. No E2EE, AnkiConnect live sync, or checkout claims.

## Motion / reduced motion

- Knowledge Peck only in `#remember` (extract beat).
- `@media (prefers-reduced-motion: reduce)`: no Peck animation, no device `rotateY`.
- Offscreen: `IntersectionObserver` removes `is-in-view` / sets `is-paused`.
- Hidden tab: `visibilitychange` + `html.is-document-hidden`.
- Manual OS check (task 6.2): enable Reduce Motion and confirm the bird stays still and frames are not skewed. Not executed as a live OS toggle in this agent session; CSS gates are in place.

## JS disabled

Hero, sections, and CTAs are in Astro HTML. Peck animation is enhancement only.

## Fonts

System UI stack + Source Serif 4 latin subsets (display only). See [fonts.md](./fonts.md).

## Follow-ups

- **C:** replace `data-placeholder` frames via `website/src/config/asset-manifest.json` or `marketing/asset-manifest.json`.
- **D:** fill `#demo` / `HomeDemoSlot`; do not add a second mascot or wheel hijack.
- **E:** claim matrix still empty for public homepage; commercial wrapper import paths were corrected so `astro build` resolves (`AudiencePage.astro` lives under `components/commercial/`, so layout imports must be `../../layouts/...`).
