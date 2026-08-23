## 1. Baseline, contracts, and rollout safety

- [x] 1.1 Capture and document the current homepage and `/demo` failures at wide desktop, short laptop, tablet, and phone sizes, including empty/skeleton assets, global keyboard advancement, and desktop/mobile legibility.
- [x] 1.2 Inventory every current marketing screenshot and classify it as approved fixture content, empty/skeleton, placeholder, stale, or unsafe/personal; quarantine unsafe assets from all generated manifests without deleting unrelated untracked device work.
- [x] 1.3 Define `marketing-fixture-v2` and the initial required scene/layout matrix in shared typed schemas, including versioning, fixed logical time, sentinels, normalized hotspots, predecessors/successors, and fallback behavior.
- [x] 1.4 Add a `showcaseV2Enabled` launch flag and preserve a server-rendered poster/narrative fallback so rollout and rollback do not depend on the old interactive island.
- [x] 1.5 Resolve the launch capture theme/build ID and whether `explain.grounded` can inject a deterministic pre-authored result into the real explanation UI; record the approved scene path before final capture.

## 2. Complete deterministic fixture

- [x] 2.1 Extend the marketing demo-library schema and source files to cover document/file records, extracts/highlights, learning items, queue priorities, reading progress, review events, notes, tags, and graph connections for one coherent story.
- [x] 2.2 Implement a fixture compiler that emits stable IDs, ordering, logical dates, media hashes, fixture version/hash, and typed records consumable by app persistence adapters.
- [x] 2.3 Add fixture validation for licenses, allowlisted paths/domains, cross-entity references, required counts/story coverage, accidental personal/account data, commercial covers, and unknown binaries.
- [x] 2.4 Implement a browser/PWA capture adapter that creates a fresh explicit IndexedDB/database namespace and writes the fixture transaction before product layout mount.
- [x] 2.5 Implement the applicable Tauri/SQLite capture adapter or documented importer path using a fresh disposable database and the real repositories, with schema migration compatibility checks.
- [x] 2.6 Add scene-state applicators for route/current document, reader position and selection, card preview, review question/answer/rating, schedule outcome, and connection context without making in-memory stores authoritative for persisted data.
- [x] 2.7 Add reset/cleanup safeguards that target only the validated capture namespace and prove a normal user/developer database is never read or modified.
- [x] 2.8 Add fixture compiler and adapter tests for deterministic repeat runs, idempotence, migration failure, broken references, existing-user isolation, and complete app-query results.

## 3. Scene orchestration and trustworthy capture

- [x] 3.1 Create the generated shared scene catalog for `library.ready`, reader states, grounded explanation or approved omission, remember preview, review states, schedule, and connections across required desktop/mobile layouts.
- [x] 3.2 Add stable capture-only action/region selectors in the real product UI where needed and generate normalized hotspot rectangles from those actual controls rather than hand-maintained website guesses.
- [x] 3.3 Replace post-mount marketing store mutation with a capture bootstrap that verifies the explicit build capability, seeds before mount, resolves the requested scene, and rejects unknown fixture/scene parameters.
- [x] 3.4 Implement the readiness handshake for fixture commit, route and scene state, expected content sentinels, no skeleton/loading/error/placeholder UI, font readiness, decoded visible images, and stable animation frames.
- [x] 3.5 Update the Playwright capture runner to request each required scene/layout, fail fast on incomplete readiness, use deterministic locale/theme/DPR, and never write a production derivative after a failed scene.
- [x] 3.6 Extend the manifest and encoder with scene ID, source type, app version/git SHA, fixture version/hash, platform, viewport, DPR, theme, locale, capture time, source hash, intrinsic size, accessible description, hotspots, and safe-area metadata.
- [x] 3.7 Add capture-integrity checks that reject zero-document text, skeleton selectors, placeholder labels, error toasts, unexpected titles/covers/domains, missing controls, file-hash drift, and fixture/build mismatches.
- [x] 3.8 Update the native simulator/physical-device capture protocol to use the same fixture and scene IDs while keeping store listing images distinct from CSS viewport captures.
- [x] 3.9 Generate and review the complete new source scene set, then encode responsive AVIF/WebP/PNG derivatives into a versioned website asset directory.
- [x] 3.10 Point the active manifest only at approved non-placeholder scenes and explicitly quarantine the current empty/mislabeled website images and any personal-device captures from production consumption.

## 4. Shared simulator core

- [x] 4.1 Replace the existing demo contract with generated scene/layout types and a reducer for narrative mode, guided simulator mode, Explore mode, path history, selected layout, and explicit visitor takeover.
- [x] 4.2 Implement validated transitions, nearest-layout equivalents, Back, Restart, Exit demo, completion, and invalid-state clamping with exhaustive reducer tests.
- [x] 4.3 Implement `/demo?scene=<id>&layout=<mobile|desktop>` parsing and canonical URL updates without exposing capture-build routes or accepting arbitrary asset paths.
- [x] 4.4 Build a responsive scene-image component with intrinsic sizing, AVIF/WebP/PNG sources, decode state, safe-area metadata, accessible descriptions, retry, and reuse of decoded scenes.
- [x] 4.5 Build the normalized hotspot layer using semantic buttons, actual action labels, visible hover/focus cues, 44-pixel targets, and no response for unmapped screenshot regions.
- [x] 4.6 Build guided controls with a single recommended action, concise prompt, progress, Back, Restart, Exit demo, and layout switch; remove the current window-level Enter/arrow listener.
- [x] 4.7 Build Explore navigation from declared destinations and valid scene transitions only, including clear explanations and offers when a destination is unavailable on the selected layout.
- [x] 4.8 Add consent-aware showcase analytics for impression, chapter, takeover, action, layout switch, completion, restart, exit, and asset failure using content-free stable identifiers.

## 5. Reading Desk visual experience

- [x] 5.1 Replace the current `home-demo-frame`/phone-only slot with server-rendered Reading Desk markup for Collect, Read, Understand, Remember, and Return using one continuous fixture narrative.
- [x] 5.2 Design and implement the wide product stage: editorial chapter/progress rail, large readable desktop capture, coordinated phone foreground, restrained Plethora paper/ink framing, and product-first visual hierarchy.
- [x] 5.3 Implement wide-screen chapter activation with `IntersectionObserver` and CSS sticky positioning without canceling wheel/touch events, rewriting scroll position, or activating simulator actions.
- [x] 5.4 Implement continuity transitions between desktop and mobile scenes using bounded crossfades, clipping, focus emphasis, and shallow 2D transforms; pause all motion while offscreen.
- [x] 5.5 Implement the explicit “Try the flow” handoff at the appropriate chapter, preserving the active logical scene and moving focus to the first recommended simulator action.
- [x] 5.6 Implement the short-laptop/tablet/phone in-flow composition with full-width mobile scenes, no pinned multi-column stage, readable chapter copy, and a non-tiny accessible desktop detail treatment.
- [x] 5.7 Implement a reduced-motion variant with immediate/non-spatial scene changes, no parallax/device flight/pulsing, and identical content and interaction outcomes.
- [x] 5.8 Reuse the same Reading Desk/simulator components on `/demo`, with a more focused full-page composition and normal site navigation/escape paths.

## 6. Accessibility, resilience, and performance

- [x] 6.1 Scope arrow/Enter/Space/Escape behavior to focused simulator controls, implement logical focus entry/exit/restoration, and verify the experience never traps focus or changes while focus is elsewhere.
- [x] 6.2 Add concise live-region outcomes, meaningful scene descriptions, semantic chapter navigation, visible focus/high-contrast states, and a complete server-rendered ordered narrative/CTA fallback.
- [x] 6.3 Handle disabled JavaScript, failed hydration, missing manifests, and failed image decode without an empty device frame, dead control, or loss of the product story.
- [x] 6.4 Lazy-hydrate the simulator on viewport proximity or intent, preload only the responsive first poster, prefetch at most the next likely scene per relevant layout, and prevent alternate layouts from downloading eagerly.
- [x] 6.5 Add website bundle and scene-asset budgets plus assertions that homepage hero/LCP rendering does not request or depend on the simulator chunk or non-poster scene set.

## 7. Verification and handoff

- [x] 7.1 Add unit tests for manifest parsing, asset selection, deep links, reducer transitions, history/restart, layout fallback, hotspot mapping, analytics payloads, and image failure/retry.
- [x] 7.2 Add Playwright interaction tests for the complete guided path and Explore mode using mouse, touch, and keyboard, including focus scoping and no-op clicks outside hotspots.
- [x] 7.3 Add accessibility tests with axe plus manual screen-reader checks for the Reading Desk, simulator takeover, live outcomes, layout switching, completion, and JavaScript-free fallback.
- [x] 7.4 Add responsive visual tests at wide desktop, short laptop, tablet, and phone sizes for narrative, takeover, guided, Explore, reduced-motion, loading, and failure states.
- [x] 7.5 Run fixture/capture integrity checks and manually review every approved source scene for real-app fidelity, licensed fictional content, legibility, correct controls, and absence of personal data.
- [x] 7.6 Run `cd website && npm test && npm run check && npm run build && npm run check:assets && npm run check:dist` and the applicable website Playwright suite.
- [x] 7.7 Run root script tests and required project gates, including `npm run test:scripts` and `npm run bench:check`; update performance baselines only for an intentional measured change with its rationale documented.
  - `npm run test:scripts` passes. The final isolated `npm run bench:check` compares all 40 baselines successfully and passes the bundle budget; no performance baseline was changed.
- [x] 7.8 Update marketing capture/seed documentation, asset provenance, scene-authoring guidance, regeneration commands, rollback procedure, and the rule that store screenshots require the native RC/device path.
- [x] 7.9 Validate this change with `openspec validate revamp-useplethora-interactive-showcase --strict` and confirm all required v2 assets are fresh before enabling `showcaseV2Enabled` for indexed production.
