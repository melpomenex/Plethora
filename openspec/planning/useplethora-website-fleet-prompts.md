# Implementation fleet prompts — useplethora.com

Use these after the OpenSpec program is in git. Each agent works on **one** change. Do not deploy. Do not paste Vercel tokens. Do not modify root `vercel.json` (PWA). Read `openspec/planning/useplethora-commercial-website-program.md` and `useplethora-website-shared-contracts.md` first.

## Agent A — Foundation

Implement OpenSpec change `create-useplethora-website-foundation`. Create `website/` as an Astro 5 TypeScript app. Land shared config types exactly as the contracts doc. Add Vercel config **inside `website/`**. Leave checkout, downloads, analytics, and indexing disabled by default. Do not build homepage visuals or the interactive demo. Evidence: `openspec validate create-useplethora-website-foundation --strict`, `cd website && npm run build`.

## Agent C — Marketing assets (parallel with A after types exist, or on contracts doc alone)

Implement `create-plethora-marketing-demo-assets`. Build a legally safe, deterministic demo library on memory/sleep/learning. Reuse `demo/` seed patterns. Capture screenshots from the **real app**. Write licenses and a manifest. Mark placeholders as launch blockers. Do not invent a second screenshot stack if you can extend Playwright/`scripts/marketing/`.

## Agent E — Commercial pages (after A scaffold)

Implement `create-useplethora-commercial-pages`. Own secondary routes. Bind pricing and downloads to config. Gate every product claim. Do not invent LLC name, address, emails, D-U-N-S, or refund law. Anki page: `.apkg` only unless live AnkiConnect is re-verified.

## Agent B — Homepage experience (after A; placeholders OK)

Implement `design-useplethora-homepage-experience`. Editorial, tactile, Plethora-specific. Friendly Chirp + Knowledge Peck, restrained. Honor banned AI-SaaS patterns. CSS-first motion, `prefers-reduced-motion`. Do not implement the demo state machine (leave `HomeDemoSlot`).

## Agent D — Interactive demo (after A; integrate C assets when present)

Implement `build-useplethora-interactive-product-demo`. Deterministic 30s path, iPhone/Android shells, desktop/e-ink in the collage via B. No auth, no API, no real library. Keyboard/touch/SR/reduced-motion. No dead controls.

## Agent F — Quality gates (harness after A; full after B/D/E)

Implement `establish-useplethora-website-quality-gates`. Playwright, axe, performance budgets, SEO/robots, claim-phrase tests, staging noindex, launch checklist, rollback. Additive GitHub workflow only.

## Wave order

0: A (+ F harness)  
1: C, E, B in parallel  
2: D + B asset swap  
3: E commercial facts  
4: F rehearsal  

Lead agent merges in order A → {C,E,B,F-harness} → D → F-full.
