## Why

Plethora's current website demo does not yet prove the product: the interactive phone is a simplified text reconstruction, while the screenshot pipeline can publish empty or partially hydrated app screens as non-placeholder assets because its in-memory seed is not a complete, verified database fixture. Prospective customers need one beautiful, truthful story that shows a populated library on desktop and mobile, then lets them take over and click through the real Plethora workflow without auth, network calls, dead controls, or confusing scroll behavior.

## What Changes

- Replace the existing phone-only demo with a responsive **Reading Desk** showcase: a scroll-led desktop/mobile product story followed by a clear handoff into a guided, clickable simulator.
- Introduce a deterministic, isolated marketing database fixture containing licensed mock documents, extracts, cards, queue state, review history, analytics, and connections so every shown surface looks intentionally lived-in rather than empty.
- Capture a versioned scene set from the real Plethora UI after database hydration, fonts, covers, and media are ready; verify content, provenance, hashes, dimensions, theme, platform, and build identity before the website may consume an asset.
- Drive both the scroll story and simulator from one scene graph and one fixture version. Visitors can use guided steps, click highlighted in-app hotspots, go back, restart, switch between desktop and mobile, and enter an optional free-explore mode without encountering decorative controls that appear functional.
- Use restrained, product-led motion: sticky storytelling on wide screens without wheel hijacking, continuity transitions between device captures, focused hotspot cues, and a non-sticky mobile treatment. Reduced-motion users receive immediate scene changes and the same complete narrative.
- Replace or quarantine empty, stale, mislabeled, or personal-device screenshots; production assets must contain only the approved fictional/CC0 demo corpus and must never expose a developer's real library or commercial covers.
- Add visual, interaction, accessibility, responsive, performance, and capture-integrity gates for the homepage and `/demo` experience.

## Capabilities

### New Capabilities

- `plethora-marketing-scene-fixtures`: Deterministic isolated database seeding, named capture scenes, real-app screenshot generation, provenance, validation, and freshness guarantees.
- `useplethora-interactive-showcase`: The Reading Desk scroll narrative, responsive desktop/mobile device presentation, shared scene graph, guided simulator, free exploration, accessible controls, motion behavior, and performance isolation.

### Modified Capabilities

<!-- No archived website capabilities currently exist under openspec/specs/. This change supersedes the behavior of the completed-but-unarchived build-useplethora-interactive-product-demo and create-plethora-marketing-demo-assets changes. -->

## Impact

- Website: `website/src/components/demo/**`, `website/src/components/home/HomeDemoSlot.astro`, adjacent homepage demo framing/styles, `/demo`, demo contracts, asset loading, analytics, and website unit/E2E/visual tests.
- App capture tooling: `src/lib/marketingCapture/**`, `src/components/dev/MarketingCaptureHost.tsx`, a capture-only seed adapter, and narrowly scoped capture-build routing/readiness hooks; normal first-run and user databases remain unchanged.
- Fixture and media pipeline: `marketing/demo-library/**`, `marketing/screenshots/**`, `scripts/marketing/**`, and `website/public/images/product/**`.
- Existing screenshot consumers continue to use a manifest, but the manifest schema gains scene, fixture, source-build, hash, viewport, safe-area, readiness, and hotspot metadata.
- No production auth, AI inference, billing, sync, or user-data APIs are introduced. The website simulator remains client-side after its static assets load.
