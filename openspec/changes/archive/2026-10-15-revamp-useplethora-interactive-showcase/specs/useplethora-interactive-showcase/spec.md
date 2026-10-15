## ADDED Requirements

### Requirement: Homepage presents a continuous Reading Desk story
The homepage SHALL present the Plethora workflow as the ordered chapters Collect, Read, Understand, Remember, and Return using one coherent fixture story and legible real-app desktop/mobile scenes.

#### Scenario: Visitor scrolls through the showcase
- **WHEN** a visitor follows normal document scroll through the showcase
- **THEN** chapter copy and product scenes advance in order while preserving the same document, passage, card, and review narrative

### Requirement: Scroll storytelling never hijacks navigation
On eligible wide viewports the showcase MAY use a sticky stage selected by observed chapter visibility, but it MUST NOT cancel wheel/touch events, rewrite scroll position, require scrub precision, or trigger product actions merely from scrolling. On small or short viewports the narrative SHALL use a non-sticky in-flow layout.

#### Scenario: User scrolls quickly past the section
- **WHEN** the visitor scrolls past the Reading Desk without interacting
- **THEN** the page exits the section normally without trapping, snapping, or auto-activating a simulator hotspot

#### Scenario: Phone viewport
- **WHEN** the viewport does not meet the configured wide width and height thresholds
- **THEN** each chapter and its mobile scene render in normal document flow without a pinned multi-column stage

### Requirement: Control is handed to the visitor explicitly
The narrated showcase SHALL provide a visible “Try the flow” action that enters simulator mode, identifies the first available action, and moves focus into the simulator. Scrolling alone SHALL NOT enter simulator mode.

#### Scenario: Take over from Remember chapter
- **WHEN** the visitor activates “Try the flow”
- **THEN** simulator progress begins at the corresponding scene, the recommended hotspot is announced and focused, and Back, Restart, Exit demo, and layout controls are available

### Requirement: Simulator uses one validated scene graph
The homepage and `/demo` simulator SHALL use the same finite scene graph, reducer, and validated scene assets. Every transition SHALL resolve to a declared successor or a documented layout fallback and SHALL NOT call Plethora auth, user-data, inference, billing, or sync APIs.

#### Scenario: Complete guided path
- **WHEN** a visitor activates the recommended action at each guided scene
- **THEN** the simulator moves from the populated library through reading, selection, explanation or its approved omission, card creation, review, rating, schedule, and completion without a dead end

#### Scenario: Website is offline after assets load
- **WHEN** the visitor disconnects after the scene bundle is available
- **THEN** guided interactions continue without application API requests

### Requirement: Hotspots correspond to real in-app actions
Interactive hotspots SHALL be positioned from normalized scene metadata, expose the actual action label, and transition to the captured outcome of that action. Unmapped screenshot regions SHALL remain visibly non-interactive, and decorative controls MUST NOT be drawn to imply unsupported behavior.

#### Scenario: Visitor activates Remember this
- **WHEN** the visitor activates the hotspot corresponding to the real “Remember this” control
- **THEN** the next scene shows the real card-preview outcome for the selected fixture passage

#### Scenario: Visitor clicks outside a hotspot
- **WHEN** the visitor clicks an unmapped portion of the screenshot
- **THEN** simulator state does not change and the recommended action remains discoverable without an error or misleading animation

### Requirement: Guided and Explore modes are understandable
Guided mode SHALL expose one recommended next action, concise context, progress, history-aware Back, Restart, and Exit demo. After or alongside the guided path, Explore mode SHALL expose only declared destinations and valid transitions rather than pretending to offer arbitrary app navigation.

#### Scenario: Back and restart
- **WHEN** a visitor goes back after two actions and then restarts
- **THEN** Back returns to the actual prior scene and Restart returns to `library.ready`, clears path history, and preserves the selected layout when supported

#### Scenario: Explore destination unavailable on layout
- **WHEN** the visitor chooses a destination unsupported by the selected layout
- **THEN** the simulator explains the layout difference and offers the nearest supported layout or scene without rendering a dead control

### Requirement: Desktop and mobile presentations remain legible
The showcase SHALL use layout-specific captures and device treatments. Switching between desktop and mobile SHALL preserve the logical scene when available; desktop UI MUST NOT be reduced to unreadable scale on a phone viewport.

#### Scenario: Switch at review question
- **WHEN** a visitor switches from desktop to mobile while viewing `review.question`
- **THEN** the mobile capture of the same fixture card appears and guided progress/history are preserved

#### Scenario: View desktop scene on a phone
- **WHEN** a visitor requests desktop layout from a narrow viewport
- **THEN** the experience provides an accessible detail view or controlled pan/zoom treatment instead of a tiny full-window image with illegible controls

### Requirement: Showcase input is scoped and accessible
All simulator actions SHALL be semantic controls operable by pointer, touch, and keyboard with visible focus and at least 44-by-44 CSS-pixel touch targets. Keyboard shortcuts SHALL apply only while focus is within the simulator, and scene changes SHALL update a concise polite live region.

#### Scenario: Enter elsewhere on homepage
- **WHEN** focus is outside the showcase and the visitor presses Enter or an arrow key
- **THEN** the showcase scene does not change and default page behavior is preserved

#### Scenario: Keyboard completes path
- **WHEN** a keyboard-only visitor enters simulator mode
- **THEN** they can discover and activate every guided action, switch layout, go back, restart, and exit without a focus trap or pointer input

### Requirement: Motion respects preference and comprehension
Device movement, scene transitions, and hotspot cues SHALL be restrained and SHALL stop when the showcase is offscreen. With reduced motion enabled, scene changes SHALL be immediate or use a non-spatial crossfade, and the complete narrative and simulator functionality SHALL remain available.

#### Scenario: Reduced motion visitor takes control
- **WHEN** `prefers-reduced-motion: reduce` is active and the visitor starts the simulator
- **THEN** no parallax, device flight, scroll-linked transform, or pulsing cue runs, while focus, progress, and outcomes remain clear

### Requirement: Progressive loading preserves homepage performance
The server-rendered chapter copy and first responsive poster SHALL be usable before the simulator hydrates. Simulator code and non-poster scene assets SHALL load only on viewport proximity or explicit intent, use explicit dimensions, and prefetch no more than the next likely scene per relevant layout.

#### Scenario: Initial homepage load above the fold
- **WHEN** the demo has not approached the viewport and no demo CTA was activated
- **THEN** the browser does not request the simulator chunk or the non-poster scene set and hero rendering does not depend on demo JavaScript

#### Scenario: Next scene image fails
- **WHEN** a required image cannot be decoded
- **THEN** the narration and controls remain available, the device frame shows an explicit quiet fallback with Retry, and no empty shell is mistaken for the product

### Requirement: Deep links and invalid state are safe
`/demo` SHALL support stable scene and layout query parameters from the active catalog. Invalid, removed, or unsupported values SHALL clamp to a known safe scene and SHALL NOT crash, expose capture internals, or request arbitrary files.

#### Scenario: Invalid scene parameter
- **WHEN** `/demo` receives an unknown scene ID or layout value
- **THEN** it opens `library.ready` in the default supported layout and keeps all simulator controls functional

### Requirement: Static and assistive alternatives tell the full story
The showcase SHALL keep a structured ordered narrative in the server-rendered DOM and provide meaningful scene descriptions. If JavaScript is unavailable, assets fail, or the simulator cannot hydrate, visitors SHALL still understand the capture-to-review workflow and reach normal product calls to action.

#### Scenario: JavaScript disabled
- **WHEN** the homepage is loaded without JavaScript
- **THEN** the five chapters, representative validated images or poster, workflow summary, and primary product CTA remain readable without an empty demo slot

### Requirement: Showcase analytics are consent-aware and content-free
Showcase analytics SHALL use the existing consent-aware wrapper and MAY record stable chapter, scene, layout, action, completion, restart, exit, and asset-failure identifiers. They MUST NOT record fixture text, pointer coordinates, user-agent strings, account identifiers, or session replay.

#### Scenario: Analytics disabled
- **WHEN** analytics configuration or consent disables tracking
- **THEN** all showcase behavior remains functional and no analytics network request is required for a transition

### Requirement: Responsive, accessibility, and interaction quality is gated
Automated checks SHALL cover the scene reducer, every guided transition, layout switching/fallback, Back/Restart, deep links, focus scoping, reduced motion, asset failure, manifest integrity, and analytics. Browser acceptance SHALL cover wide desktop, short laptop, tablet, and phone layouts with accessibility and visual review.

#### Scenario: Release candidate validation
- **WHEN** the showcase is proposed for indexed production
- **THEN** all required scene assets pass fixture/provenance checks and website tests show no dead controls, empty/skeleton product frames, serious accessibility violations, or responsive clipping in the supported viewport matrix
