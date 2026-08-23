## Context

In-app UI is a dense multi-theme workbench (`src/themes/catalog.ts`) whose default chrome is still historically green (`BRANDING.md` D11, RC F-31). The mascot is a purple P-bird (`assets/brand/plethora-icon-master.svg`). Marketing must not dump the IDE theme onto the web, and must not become “purple blob AI.”

Knowledge Peck already encodes the metaphor: notice fragments → peck into cards → structure (`openspec/changes/knowledge-peck-startup-animation/`). Companion bird is optional and off by default — the website should not behave like a desktop pet.

## Goals / Non-Goals

**Goals:** Editorial, tactile, product-specific homepage; one story; honest device photos; Peck as selection, not circus; CSS-first motion; readable at 320–1440px; WCAG 2.2 AA contrast for text.

**Non-Goals:** Implementing D’s state machine; 3D/WebGL heroes; scroll hijacking; rewriting app QSS/CSS themes.

## Decisions

### Visual system

- **Paper + ink + sparingly used violet mark.** Backgrounds: warm off-white / graphite, not `#7C3AED` washes.
- **Display type:** a real optical serif (e.g. Source Serif 4 / Fraunces) for headlines — kinship with `src/styles/reader.css`.
- **UI type:** Albert Sans already in app packages; subset on the web (latin, weights 400–700). Do not load the app’s huge `@fontsource/*` list.
- **Devices:** CSS 3D `rotateY` ≤ ~12° so screen text stays legible; photographic shadows; no dummy notch farms.
- **Mascot:** only `plethora-icon-master.svg` / articulable derivative matching brand inventory hexes. No new animal.

### Homepage sequence (required)

1. Hero — “Everything you read. Remembered.” / “Read anything. Learn everything.” / Get Plethora + Try the interactive demo. Real product frames (or labeled placeholders).
2. Problem — saving ≠ remembering; graveyard of highlights; tool sprawl.
3. Capture — books, PDFs, articles, audio, video, notes into one library.
4. Read — real reader, incremental reading, position restore, TTS, e-ink **only as available**.
5. Understand — dictionary, grounded explain, questions on the passage; user-chosen local or cloud models; no “magic AI.”
6. Remember — cards (basic, cloze, Q&A, MCQ, image occlusion), SRS, rating. **This beat is heavier than Understand.**
7. Connect — library links with captions from the same demo story, not an abstract particle graph.
8. Trust — “Your knowledge is yours.” Calm, local-first, export, what leaves the device; **no ZK claim unless E’s matrix allows.**
9. Platforms — Windows, macOS, Linux, iOS, Android with honest availability from A/E config.
10. Pricing teaser — Free vs Pro summary linking to `/pricing`.
11. Close — “Don’t just save it. Remember it.”

### Motion language (map to learning)

| Beat | Motion |
|---|---|
| Extract | Passage lifts from a column |
| Peck | Bird glance + beak toward passage, then still |
| Connect | Two notes ease together |
| Recall | Blur/obscure → crisp answer |
| Schedule | Card slides along a dated rail |
| Retain | Loose scraps settle on a shelf |

Implementation: CSS scroll-driven animations where supported; `IntersectionObserver` fallback; no perpetual `requestAnimationFrame` decoration; pause when `document.hidden` or offscreen. `prefers-reduced-motion: reduce` → instant crossfades, static Peck pose, no parallax.

### Mascot rules

- Allowed: hero margin, extract beat, demo complete check, empty-demo rest pose.
- Forbidden: every section; bounce loops; trust/pricing/legal; covering copy; childlike SFX.

### Anti-generic checklist (ship blocker if failed)

No hero mesh gradient, no three identical rounded feature cards as the first fold, no glass cards without content, no particle canvas, no fake LLM chat as hero, no typewriter looping the slogan, no 3D mascot remix, no Lottie confetti, no “powered by AI” without grounding.

### Libraries

Prefer CSS. If a motion library is required, it MUST be lazy-loaded, tree-shaken, and justified in the PR against CSS scroll-timeline. No Three.js.

## Risks

- Placeholder screenshots looking like invented UI → labeled `placeholder` + C blocker.
- Over-animation on mobile thermals → pause offscreen, reduced motion, max one heavy scene.
- Green vs purple app chrome in photos → C/F-31; site still paper/ink.

## Open Questions

Founder sign-off on primary headline vs in-app `PRODUCT_TAGLINE`. F-31 screenshot chrome.
