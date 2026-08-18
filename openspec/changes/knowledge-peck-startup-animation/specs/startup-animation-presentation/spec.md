# Delta: startup-animation-presentation

## ADDED Requirements

### Requirement: Branded launch surface replaces the generic boot spinner
The earliest painted content of the main window SHALL be a branded static frame (Plethora mascot centered on the fixed `#0A0A0A` boot surface) embedded in `index.html` ahead of React mounting, and the primary branded startup experience SHALL be the Knowledge Peck overlay rather than the generic `PageLoader` spinner. The generic spinner MAY remain as the Suspense fallback for non-main routes and utility surfaces.

#### Scenario: Pre-JavaScript paint is branded
- **WHEN** the webview paints before the React bundle has executed
- **THEN** the static frame (mascot on the dark boot surface) is visible instead of an empty root or platform-default white flash

#### Scenario: Geometry parity across layers
- **WHEN** the React overlay takes over from the static frame
- **THEN** mascot size and position match the static frame (asserted by a unit test comparing `index.html` inline geometry with the shared `KP_GEOMETRY` constants), producing no visible jump

### Requirement: The choreography communicates the Knowledge Peck metaphor
The full choreography SHALL present, in order: floating unstructured knowledge fragments appearing around the mascot; a subtle mascot observation movement; at least one peck that visually transforms the pecked fragment into a structured card; at least two selected pieces becoming visually connected (desktop); consolidation of the selected structure; and a resolve into the Plethora mascot/wordmark mark followed by a crossfade revealing the application. Fragment content SHALL be abstract, language-neutral tokens (no hardcoded words).

#### Scenario: Desktop metaphor beats
- **WHEN** the desktop choreography runs to completion
- **THEN** three fragments appear, the mascot glances, three pecks each transform a fragment into a card, connectors join at least two cards, the trio consolidates, and the scene resolves into the mascot with the Plethora wordmark

#### Scenario: A peck transforms its target
- **WHEN** the mascot pecks a knowledge fragment
- **THEN** that fragment visibly changes state (raw token → emphasized card) with a restrained scale impulse and snaps into its structural position, without particle bursts

### Requirement: Desktop composition and timing
The desktop choreography SHALL complete its branded span (entrance through wordmark resolve) within approximately 1.2–1.8 seconds (canonical 1520 ms) whenever startup timing permits, use three knowledge fragments and 2–3 pecks, and keep the scene visually compact (centered container capped around 480 px) so it reads clearly on large displays.

#### Scenario: Canonical desktop timeline
- **WHEN** the desktop timeline is built by the pure timeline module
- **THEN** its phase boundaries place the wordmark resolve within the 1200–1800 ms window and all animated elements stay within the capped container bounds

### Requirement: Mobile composition and timing
The mobile experience SHALL use a deliberately simplified composition — two fragments, two pecks, larger elements — completing its branded span within approximately 700–1200 ms (canonical 1080 ms). It MUST NOT be a scaled-down copy of the desktop scene.

#### Scenario: Phone form factor selects the mobile script
- **WHEN** the overlay mounts with a phone-class form factor
- **THEN** the variant registry supplies the mobile phase script (2 fragments, 2 pecks) with mobile-specific composition and timing

### Requirement: Brand and mascot fidelity
The animated mascot SHALL reuse the canonical Plethora P-bird design and exact brand colors (gradient `#8B5CF6/#7C3AED/#5B21B6`, amber beak) via a new articulable inline SVG derived from `assets/brand/plethora-icon-master.svg`. The existing mascot assets, icon pipeline, and companion implementation MUST NOT be modified. A brand-inventory test SHALL guard the new SVG's colors.

#### Scenario: Brand inventory guard
- **WHEN** the brand inventory test suite runs
- **THEN** the startup bird component (and the static-frame copy in `index.html`) are asserted to contain the canonical brand hexes, and no alternate mascot design is introduced

### Requirement: Reduced-motion variant
When the OS/browser reports `prefers-reduced-motion: reduce` (via the existing presentation context), the system MUST NOT play the pecking choreography. It SHALL show a static mascot with at most a single appearing knowledge card and a quick crossfade into the application on readiness, without translation-heavy movement, bouncing, or repeated motion. Reduced-motion handling MUST NOT alter startup readiness behavior.

#### Scenario: Reduced-motion launch
- **WHEN** the presentation context reports reduced motion at launch
- **THEN** the overlay renders the static variant and crossfades to the app when ready; no pecks, translations, or loops occur

### Requirement: E-ink variant
When true e-ink mode is active (existing `isEinkMode` capability), the system MUST present approximately three crisp full-state steps — (1) mascot with knowledge fragments, (2) selected/connected structure, (3) Plethora mark — advanced by plain timeouts, with a white surface, no fades, translucency, continuous repaints, or looped animation.

#### Scenario: E-ink launch
- **WHEN** the device is in e-ink display mode at launch
- **THEN** the overlay shows the three stepped stills and reveals the application without animated transitions

### Requirement: Theme determinism and visual restraint
The boot surface SHALL use the fixed brand-dark `#0A0A0A` background across all themes (matching the current generic loader and the native splash), transitioning to the themed application via the reveal crossfade. The animation SHALL be silent, animate only `transform`/`opacity` (compositor-friendly properties), and contain no strobing or high-frequency brightness oscillation (no more than three luminance transitions per second) and no decorative excess (no confetti, particle systems, neon glow, or squash-and-stretch cartooning).

#### Scenario: Silent, compositor-only animation
- **WHEN** the choreography's source and timeline data are inspected by tests
- **THEN** no audio is produced, animated properties are limited to transform/opacity, and no phase oscillates brightness above the flashing limit

### Requirement: Native splash continuity on Android
The Android launch SHALL tint the platform splash (Android 12+ `windowSplashScreenBackground`, and the pre-31 window background) to the same `#0A0A0A` boot surface with the existing launcher icon (the mascot), so native splash → static frame → animation read as one continuous launch without a flash or discontinuity. The change SHALL be recorded in the generated-tree hand-edit inventory (`docs/android-build-notes.md`).

#### Scenario: Android splash matches the boot surface
- **WHEN** an Android 12+ device cold-starts the app
- **THEN** the native splash background color equals the static frame's `#0A0A0A` and the centered icon is the mascot, verified by asserting the theme resource contents in a unit test

### Requirement: Performance and dependency constraints
The feature SHALL introduce no new runtime dependencies, keep the entry chunk within the existing bundle budget, run its rAF driver only while animation stages are active (cancelling it on every exit path, including idle/abort), use CSS keyframes for idle micro-motion, and record a performance baseline for the pure timeline module per the repository's benchmark-gate protocol.

#### Scenario: No leaked animation loop
- **WHEN** the overlay reaches any terminal stage (`done`, `aborted`, or idle)
- **THEN** no requestAnimationFrame callback remains scheduled (asserted in tests)

#### Scenario: Gates stay green
- **WHEN** `npm run check:bundle` and `npm run bench:check` run after implementation
- **THEN** both pass with the new statically-imported component included and the new benchmark baselined in `scripts/perf-baselines.json`

### Requirement: Variant extensibility without an animation framework
The choreography SHALL be defined as data (per-variant, per-form-factor phase scripts) in a registry keyed by variant id, with `knowledge-peck` as the sole initial entry. The machine, driver, and component MUST NOT hardcode phase content, so future variants (e.g., Highlight Peck, Flashcard Peck, Connection Peck, Card Stack) can be added as new registry entries without architectural change.

#### Scenario: Registry-driven choreography
- **WHEN** the timeline module builds the launch choreography
- **THEN** it resolves phases from the variant registry entry for the current variant and form factor rather than from component-local logic
