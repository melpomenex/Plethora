## Context

Plethora is a native/PWA client with SQLite and optional cloud. The marketing demo cannot spawn that stack. Visitors still need to *feel* Capture→Remember. A finite state machine with one primary happy path and a few content-kind branches is the product.

## Goals / Non-Goals

**Goals:** 30s primary path; deterministic; phone shells; a11y; lazy; no fake capabilities; no live LLM.

**Non-Goals:** Full reader engine, PDF.js, real SRS math (show a plausible next date only as copy), user-uploaded files, accounts.

## Decisions

### State machine

Use `DEMO_HAPPY_PATH` from the contracts doc. Transitions only via labeled controls. Unexpected deep-links clamp to `library`.

Content kinds: `article` (primary), `book`, `pdf`, `podcast`, `video`. Switching kind from library resets to `item` for that kind. All kinds MUST reach `remember` / review; media kinds use a “key moment” instead of a highlight if there is no transcript UI to fake — but the moment must correspond to C’s fixtures (e.g. timestamp caption), not a bogus waveform toy.

### Device shells

- Detect `iOS` vs `Android` vs desktop; desktop still *shows* a phone (interactive) plus B’s angled desktop/e-ink stills around it.
- Toggle “iPhone / Android” visible, not buried.
- Chrome: status bar + simple nav glyphs. Do not imply iOS widgets that the app does not have.
- Interactive surface is the **phone**. Angled desktop is not the click target for the 30s path (too hard to read).

### Remember this

The control label SHALL be **Remember this** (or equivalent) and SHALL produce a card preview matching C’s card types actually supported (basic/cloze/Q&A/MCQ/occlusion as present in fixtures). Do not show a “Generate 40 cards with AI” control.

### Review

Show front → reveal → four or five grade buttons matching **actual in-app grade labels** (verify `src/components/review/` at implementation — do not invent six-grade 0–5 if the UI shows a different set). After grade, show a short “next in N days” using **fixed** demo numbers, with copy “Illustrative schedule, not your algorithm output.”

### A11y

- `role="region"` name “Interactive product demo”.
- Parallel `<ol>` “What happens in this demo” always in DOM.
- Live region updates on stage change, throttled (not every animation tick).
- Focus trap is **not** required (not a modal); Tab order inside the phone then to Restart.
- Touch targets ≥ 44px.

### Performance

- Dynamic import on first scroll-into-view or CTA.
- Preload only poster image.
- No WebGL.
- Prefers-reduced-motion: crossfade stages, skip Peck.

### Honesty

If a screenshot is placeholder, the demo MAY still use vector/HTML reconstructions **styled like** the app but MUST caption “Interactive prototype of Plethora’s flow; screenshots from the app appear above as they are produced.” Never add buttons that do nothing.

## Risks

- Prototype diverging from RC UI → D consumes C stills as backgrounds for each stage when available.
- Over-claiming AnkiConnect or cloud — not in the demo at all.

## Open Questions

Exact grade button set — bind to current review UI at implementation time.
