## Context

The website currently has two disconnected demonstrations of Plethora:

1. `website/src/components/demo/**` renders a hand-built phone UI from `content.json`. It is deterministic, but it does not look or behave like the current application, it offers no desktop experience, and its window-level keyboard handler can advance the demo while focus is elsewhere on the page.
2. `scripts/marketing/**` and `src/components/dev/MarketingCaptureHost.tsx` attempt to seed and capture the real app. The file seed only copies books into `demo/`, while the PWA capture host mutates in-memory stores after the shell has mounted. The readiness marker does not prove that database writes, route data, covers, fonts, or images have settled. The committed website images therefore include empty/skeleton libraries even though their manifest entries say they are populated, real, non-placeholder captures.

The repo already contains a coherent CC0/public-domain “Why we forget what we read” corpus, fixed IDs and timestamps, Playwright, Astro/React, app stores/repositories, and a website asset manifest. This design repairs and joins those pieces; it does not introduce a second demo product or a hosted copy of a user account.

The primary stakeholders are prospective customers evaluating Plethora, the marketing-site owner, app UI owners whose screens are captured, release owners who need trustworthy asset provenance, and accessibility/performance reviewers.

## Goals / Non-Goals

**Goals:**

- Make the first impression unmistakably Plethora: a calm, editorial Reading Desk where one piece of reading travels from capture to recall across desktop and mobile.
- Seed a complete, realistic, legally safe application state into disposable persistence before the captured UI mounts.
- Generate every website simulator scene from the real app and reject empty, stale, private, or partially rendered captures.
- Let visitors understand the workflow through normal scrolling, then explicitly take control of a guided simulator with useful, predictable actions.
- Keep desktop and mobile presentations readable and platform-appropriate instead of shrinking one layout into the other.
- Preserve keyboard, touch, screen-reader, reduced-motion, low-bandwidth, and JavaScript-failure paths.
- Keep the homepage LCP independent of the interactive code and non-poster scene set.

**Non-Goals:**

- Embedding the live PWA/Tauri app, a database, auth, sync, billing, user uploads, or live AI inference in the marketing site.
- Recreating every Plethora screen or supporting arbitrary navigation inside a screenshot.
- Producing App Store/Play Store listing images from CSS device frames; those remain native-device/RC deliverables.
- Restyling the product UI solely for marketing captures or drawing fictional controls over screenshots.
- Seeding normal first-run libraries or touching an existing developer/user database.
- Scroll-jacking, autoplay video, WebGL, or a new animation framework.

## Decisions

### 1. A versioned fixture is seeded through real persistence before app mount

`marketing/demo-library/` remains the content source of truth, but a fixture compiler will emit a normalized `marketing-fixture-v2` package containing documents, file records, extracts/highlights, learning items, queue priorities, review events, reading progress, notes, tags, and graph edges. The package uses fixed IDs, a fixed logical clock, stable media hashes, and a schema version.

Capture adapters will create a new disposable database/IndexedDB namespace and insert the fixture through the same repositories or import boundaries the app reads. Seeding completes before the main layout mounts; the app then boots normally against that isolated store. Every capture run starts from a fresh namespace and applies a named scene overlay (for example, current document and review phase) only after the base fixture transaction commits.

This replaces post-mount `setDocuments()` mutation as the authoritative path. In-memory scene state remains acceptable only for ephemeral UI state that is not persisted by the real app, such as whether a review answer is currently revealed.

Alternatives considered:

- Copying EPUB/PDF files into `demo/` is insufficient because it does not create cards, history, queues, graph state, or deterministic import completion.
- Mutating React stores is quick but can race initial repository reads and produces screenshots of state the database does not actually contain.
- Shipping a prebuilt user database is brittle across schema migrations. Compiling and inserting a typed fixture makes migration failures explicit.

### 2. Capture is controlled by a named scene contract and a strict readiness handshake

A shared generated scene catalog will define each storytelling node. Initial nodes are:

| Scene ID | Product moment | Required layouts |
| --- | --- | --- |
| `library.ready` | Populated library and next-action queue | desktop, mobile |
| `reader.open` | Essay open at the meaningful passage | desktop, mobile |
| `reader.selected` | Passage selected with real action affordances | desktop, mobile |
| `explain.grounded` | Canned, source-grounded explanation in the real UI | desktop, mobile where supported |
| `remember.preview` | Card preview created from the selected passage | desktop, mobile |
| `review.question` | Due card before reveal | desktop, mobile |
| `review.answer` | Answer and actual grade controls | desktop, mobile |
| `review.scheduled` | Rated card and updated next review | desktop, mobile |
| `connections.context` | The idea connected to the rest of the library | desktop, mobile where legible |

Each scene records a stable ID, predecessor/successors, device/layout support, capture route, fixture version, narration, accessible description, actual in-app action label, normalized hotspot rectangles, transition type, and expected content sentinels.

Capture URLs exist only in development or an explicit capture build and require both a fixture ID and scene ID. The app exposes `data-marketing-ready="complete"` only after all of the following succeed: fixture transaction, route resolution, requested scene state, absence of loading/skeleton UI, `document.fonts.ready`, decoded in-viewport images, two stable animation frames, and expected text/data sentinels. Failure writes no production asset.

The capture runner records app version, git SHA, fixture version/hash, scene ID, platform, viewport, DPR, theme, locale, source file hash, capture time, and whether the source is PWA, desktop, simulator, or physical device. The encoder may mark an asset `placeholder: false` only after validation passes.

Alternative considered: using fixed delays. Delays hide races and still allow empty stores, failed covers, or font swaps; explicit readiness is deterministic and diagnosable.

### 3. The visual concept is a Reading Desk, not a phone mockup carousel

The homepage showcase tells one continuous story in five editorial chapters: **Collect**, **Read**, **Understand**, **Remember**, and **Return**. On wide screens, a restrained text/progress rail sits beside a sticky product stage. The stage begins as a large, readable desktop window; at continuity moments a phone moves into the foreground showing the same document, passage, and card. Paper texture, fine rules, warm off-white space, and the existing Plethora bird/Knowledge Peck language may frame the product, but the captured UI remains the focal point.

Normal page scrolling selects the active chapter through `IntersectionObserver`; CSS `position: sticky`, opacity, clipping, and small transforms provide continuity. Wheel/touch events are never canceled, scroll position is never rewritten, and the stage unpins naturally. Motion is limited to crossfades, 2D/very shallow perspective shifts, focus rings, and device handoffs. It must not resemble an auto-advancing slide deck.

At the **Remember** chapter a visible “Try the flow” control changes the stage from narrated mode to simulator mode and moves focus to the first action. Scroll never silently clicks an app action. On small screens there is no sticky multi-column composition: chapters appear as readable blocks with a full-width mobile capture, and the simulator opens as an in-flow region. Desktop scenes are available through a labeled layout switch and a detail viewer rather than being scaled down to illegible text.

Alternatives considered:

- A row of device cards lacks narrative continuity and repeats the current screenshot-collage problem.
- A long pinned scrollytelling canvas is dramatic but traps users and performs poorly on short/mobile viewports.
- Video looks polished but is passive, difficult to keep accessible, and expensive to update whenever the UI changes.

### 4. Guided and Explore modes use real screenshots plus an honest hotspot layer

The simulator is a finite scene graph, not a miniature app implementation. Its visual layer is the captured real UI; its interaction layer contains normalized hotspots derived from actual controls in that scene. Hotspots expose the real action label, render a tasteful focus/hover cue, and transition to the scene that represents the real outcome. The screenshot itself is not presented as generally clickable.

Guided mode is the default. It shows one recommended action, a concise “what to try” prompt, visible progress, Back, Restart, Exit demo, and device/layout switch. After the guided path completes, Explore mode lets visitors choose among supported product destinations and valid hotspots. Unsupported screenshot controls are not given hotspots and the simulator chrome explicitly says this is a guided product preview. Decorative controls must not be placed over them.

The website state is `{ mode, sceneId, layout, pathHistory, hasTakenControl }`. Both homepage and `/demo` use the same reducer. `/demo?scene=<id>&layout=<mobile|desktop>` deep-links to valid nodes and clamps invalid values to `library.ready`. Switching layout preserves the scene when that capture exists; otherwise it moves to the nearest equivalent scene with an explanation.

An iframe/live-PWA embed was rejected because it would ship far more code, expose network/auth/user-data boundaries, behave unpredictably on third-party storage policies, and make the marketing experience dependent on app startup reliability.

### 5. Input belongs to the showcase, never the whole page

Hotspots and simulator controls are semantic buttons in document order. Arrow keys move among hotspots only while focus is inside the simulator; Enter/Space activates; Escape exits simulator mode; Backspace is not captured. Homepage-level global key handlers are removed. Touch targets are at least 44 CSS pixels even when the visible control outline is smaller.

Scene changes update a polite live region only after a deliberate visitor action. Each scene supplies a meaningful accessible description of the product state and action outcome; alt text does not dump every visible word. A persistent ordered-list fallback describes the complete flow when JavaScript or images fail.

With `prefers-reduced-motion: reduce`, scenes change without device flight, parallax, auto-scroll, or animated hotspot pulses. The same applies when the visitor chooses an explicit “Reduce motion” control. High-contrast/focus-visible states are tested rather than inferred from screenshot pixels.

### 6. Asset loading is progressive and bounded

The server-rendered homepage includes the first responsive poster and chapter copy. The React simulator and later scene images load only when the showcase approaches the viewport or the visitor activates a demo CTA. At most the next likely scene for each currently relevant layout is prefetched; decoded images are reused between narrative and simulator modes.

Images use AVIF/WebP with PNG fallback, explicit intrinsic dimensions, responsive sources, and per-scene crop/safe-area metadata. Desktop and mobile images are separate captures, not CSS crops of one master. A load failure keeps the narration and accessible controls, shows a quiet retry action, and never leaves an empty device frame.

No new animation dependency is required. The implementation uses Astro, React, CSS, `IntersectionObserver`, and the existing test/capture toolchain. Bundle and asset budgets are added to website checks; the initial page must not request the simulator chunk or non-poster scene set before proximity/intent.

### 7. Analytics measure comprehension without replaying content

Existing analytics wrappers gain events for showcase impression, chapter view, takeover, hotspot action, layout switch, completion, restart, asset failure, and exit. Payloads contain only stable scene/layout IDs and coarse timing buckets. They do not include query text, document content, pointer coordinates, user-agent strings, or session replay data. Analytics remain no-op when consent/configuration disables them.

### 8. Quality gates verify truth as well as rendering

The fixture compiler validates schema, license entries, stable IDs, cross-entity references, due counts, and required story coverage. Capture tests assert expected titles/counts and reject skeleton selectors, zero-document copy, placeholder labels, error toasts, unknown covers, real-person imagery, and unapproved domains. Manifest checks verify hashes and prevent a fixture/build mismatch.

Website tests cover every scene-graph transition, deep link, Back/Restart, layout fallback, focus path, reduced motion, image failure, and analytics event. Playwright covers wide desktop, short laptop, tablet, and phone viewports with axe checks and visual snapshots of the complete Reading Desk and simulator states. Manual acceptance includes actual device touch behavior and a provenance review of every source capture.

## Risks / Trade-offs

- **Real UI changes invalidate hotspots or sentinels** → Bind scenes to stable capture-only selectors/action IDs, fail freshness checks on mismatch, and regenerate the scene set with the same change that moves the control.
- **Screenshot transitions can feel less fluid than a live app** → Capture adjacent states with stable framing and use short continuity transitions; prioritize truth, legibility, and fast response over simulated physics.
- **A complete fixture may track app schema changes** → Compile through typed repositories, version the fixture, and make capture seeding a tested migration consumer.
- **Sticky motion can overwhelm or break on short viewports** → Enable the wide treatment only when both width and height thresholds pass; use the in-flow mobile/tablet layout otherwise.
- **A hotspot overlay may imply the entire screenshot is interactive** → Visibly distinguish guided actions, label the simulator as a preview, and never change state for unmarked screenshot regions.
- **Many scene images increase transfer size** → Responsive per-layout captures, modern formats, one-step prefetching, reuse between modes, and no eager download of alternate layouts.
- **Fixture content could drift from licenses or accidentally include a developer library** → Allowlisted corpus paths/domains, content sentinels, screenshot OCR/manual review, isolated database names, and a hard production gate.
- **The product's mobile and desktop flows are not identical** → Preserve platform-specific scenes and explain layout-only differences; do not fabricate parity.

## Migration Plan

1. Add fixture v2, compiler, isolated persistence adapters, scene catalog, and integrity tests without changing the website.
2. Generate a complete capture set into a new versioned directory. Keep it quarantined until provenance, content, readiness, and responsive visual reviews pass.
3. Implement the shared website scene reducer and simulator behind `showcaseV2Enabled`; keep the current demo as the fallback while the flag is off.
4. Build the Reading Desk narrative, reduced-motion/in-flow variants, asset loader, analytics, and E2E/visual gates against the approved scene manifest.
5. Enable v2 in preview, test on representative desktop/mobile devices, and compare conversion/exit instrumentation if analytics is available.
6. Make v2 the default only when all required captures are fresh and non-placeholder. Remove the old hand-built `content.json` UI and quarantine empty/mislabeled/personal screenshots after all consumers point at v2.
7. Roll back by disabling `showcaseV2Enabled`, which returns the server-rendered poster/narrative fallback without changing the app or user data. The fixture and capture route remain excluded from production app behavior.

## Open Questions

- Final captures must use the launch-approved Plethora theme/build; the fixture and scene contract are theme-neutral, but visual acceptance cannot be finalized before that build is named.
- The `explain.grounded` scene should use a deterministic, pre-authored result rendered by the real explanation UI. If the product cannot inject that result without a live provider, the scene will show source selection and “Explain” intent, then continue directly to `remember.preview` rather than faking a network response.
