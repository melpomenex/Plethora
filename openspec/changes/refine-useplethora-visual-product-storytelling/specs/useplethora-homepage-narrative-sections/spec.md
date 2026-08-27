## Purpose

Defines the homepage narrative sections' behavior: Reading Desk composition (simultaneity, chapter rail, scene continuity), real-UI storytelling for Capture/Read/Understand/Remember/Connect/Trust, the product-proof presentation, product-specific motion, visual rhythm/asymmetry, and responsive/accessibility/performance requirements for these sections.

## ADDED Requirements

### Requirement: Reading Desk shows product UI immediately on desktop
At common desktop viewports (≥1024px wide, ≥700px tall), entering the Reading Desk section SHALL present the section heading and a visible Plethora product stage together within the initial viewport, without requiring scroll through empty space first.

#### Scenario: Section entry at 1440×900
- **WHEN** the Reading Desk section top enters the viewport on a 1440×900 desktop
- **THEN** both the heading block and a rendered product composition are simultaneously visible or within ~120px of visibility

#### Scenario: Reduced intro whitespace
- **WHEN** the homepage renders at desktop widths
- **THEN** vertical padding above/below the Reading Desk section and the gap between its heading and content are substantially smaller than the previous clamp(3rem–8rem) treatments, with total dead space before the stage reduced to near-zero

### Requirement: Visible numbered chapter rail driven by existing state
The Collect → Read → Understand → Remember → Return flow SHALL be presented as a deliberate narrative rail with numbered chapters, an active-state treatment including a restrained violet indicator, and indicator movement as chapters change; state SHALL continue to be driven by the existing IntersectionObserver activation logic without wheel hijacking.

#### Scenario: Chapter progression
- **WHEN** the visitor scrolls from the Collect chapter into Read
- **THEN** the active chapter treatment (opacity/violet indicator position) moves to Read, keyboard focus order is unaffected, and no native scrolling is intercepted

#### Scenario: Not a stepper-card component
- **WHEN** the rail renders
- **THEN** chapters appear as typographic rail entries rather than five identical rounded cards

### Requirement: One-document story continuity across scenes
The desk's device composition SHALL persist across chapter transitions while captured scenes crossfade/drift between document-journey moments (arrives in library → reopened → passage selected → review prompted → scheduled & connected), with per-chapter captions describing the same single example document using the word "document".

#### Scenario: Scene transition consistency
- **WHEN** the active chapter changes on desktop
- **THEN** only scene imagery/caption updates (crossfade/drift ≤ ~400ms) while the frames remain in place, producing one continuous product story

#### Scenario: Reduced-motion equivalent
- **WHEN** reduced motion is preferred
- **THEN** scene changes apply instantly and all narrative information remains available statically

### Requirement: Reading Desk interactivity and accessibility preserved
Existing guided/explore takeover, hotspots, back/restart controls, mobile inline chapter media, and analytics events SHALL keep functioning, including full keyboard operability of hotspots with visible focus.

#### Scenario: Keyboard hotspot navigation
- **WHEN** a keyboard user enters the guided simulator and focuses hotspots
- **THEN** arrow keys cycle hotspots, Enter activates the recommended action, and Escape exits — matching previous behavior

### Requirement: Real product proof in the capture beat
The Capture section SHALL pair its typographic format strip (Books, PDFs, Articles, Audio, Video, Notes) with a real library screenshot presentation showing captured sources converging into the actual Plethora library, optionally animated once per visit to illustrate capture; any capability claims shown SHALL be claim-gated.

#### Scenario: Library evidence present
- **WHEN** the Capture section renders
- **THEN** a genuine Plethora library capture is visibly featured alongside the format list, not typography alone

#### Scenario: Motion illustrates capture
- **WHEN** animation runs for the convergence treatment (motion allowed)
- **THEN** it plays a finite, once-per-view sequence that settles fragments into the product frame and pauses when offscreen; under reduced motion it renders as a static arrangement

### Requirement: Proof band states only verified capabilities
A READ ANYTHING / REMEMBER IT-style proof presentation SHALL list only capabilities verified by the repository claims matrix (`public: true`, surface allowed, or explicitly `data-claim-pending`-marked); no invented features, metrics, or testimonials may be listed.

#### Scenario: Claim-gated listing
- **WHEN** each listed proof-band item is checked against `claims.json`
- **THEN** every non-pending item maps to a public claim row whose allowed surfaces include the homepage, and pending items carry the pending marker convention

### Requirement: Read section shows the actual reader
The Read section SHALL present real reader captures demonstrating an open document with reading progress and return-to-position context, using imagery from the showcase asset set; capabilities mentioned beyond the captures (e.g., TTS, e-ink) SHALL follow claim gating.

#### Scenario: Reader evidence
- **WHEN** the Read section renders
- **THEN** visitors see a real Plethora reader screenshot (not reconstructed placeholder chrome) with caption copy tied to returning to the same position in the document

### Requirement: Understand shows a grounded passage interaction
The Understand section SHALL show the real selected-passage state of the Plethora reader with its contextual actions, framed as document-grounded assistance; fake chat interfaces SHALL NOT be used.

#### Scenario: Selection evidence
- **WHEN** the Understand section renders
- **THEN** the displayed interaction derives from a real reader-selection capture showing contextual actions anchored to the passage

### Requirement: Remember is the visual climax built on real review states
The Remember section SHALL be visually dominant relative to Understand and SHALL stage a finite product sequence — passage extraction (with the Knowledge Peck moment), card/review-item preview, question, answer reveal, scheduled result — reusing real showcase scenes (e.g., remember.preview, review.question, review.answer, review.scheduled); looping ambient mascot motion SHALL NOT be introduced.

#### Scenario: Sequence uses real scenes
- **WHEN** the Remember sequence advances (automatically on entering view, then resting)
- **THEN** every depicted state is a real capture or a website-only composition built strictly from real capture crops, ending in the scheduled state

#### Scenario: Manual replay and reduced-motion statics
- **WHEN** a visitor replays the sequence or prefers reduced motion
- **THEN** replay restarts the same finite beats, and reduced motion presents the beats as an accessible static arrangement with all captions readable

#### Scenario: Mascot restraint maintained
- **WHEN** the Knowledge Peck moment plays
- **THEN** the mascot performs its brief sanctioned gesture tied to extraction and remains still afterward, consistent with prior mascot rules

### Requirement: Connect shows a real knowledge relationship
The Connect section SHALL replace wireframe-styled note pairs with a real connections view from the showcase assets, presenting two actual related knowledge items and their meaningful relationship with captions/context; generic glowing node graphs and fabricated graphs SHALL NOT be introduced.

#### Scenario: Connection evidence
- **WHEN** the Connect section renders
- **THEN** visitors see a real Plethora connections capture featuring the demo fixture's two related items with explanatory caption text

### Requirement: Trust communicates positively and claim-safely
The Trust section SHALL lead with user-facing ownership messaging (e.g., "Your knowledge is yours.") supported only by verified statements about local-library capability, exportability, and disclosed cloud involvement, plus a deeper link to data-handling documentation; unsupported privacy claims and implementation/testing disclaimers SHALL NOT appear.

#### Scenario: Claim-safe trust copy
- **WHEN** Trust copy is audited against the claims matrix and banned-phrase list
- **THEN** no zero-knowledge, end-to-end-encryption-sync, storefront, or other non-public claims appear, and all positive statements trace to public trust-capable claim rows

### Requirement: Deliberate rhythm and controlled asymmetry
The homepage SHALL vary section composition deliberately — mixing full-width product moments, narrow editorial columns, oversized serif statements, and edge-bleeding media — with asymmetry achieved through grid alignment techniques that never compromise reading order, keyboard navigation, or responsive integrity; uniform heading→paragraph→content stacking SHALL NOT dominate every band.

#### Scenario: Rhythm variance
- **WHEN** consecutive homepage sections are compared
- **THEN** at least three distinct width/scale treatments appear among hero, proof/capture, narrative sections, Remember climax, and closing bands

#### Scenario: Asymmetry does not break semantics
- **WHEN** the page is linearized by screen readers or viewed at 320px width
- **THEN** reading order matches DOM/heading order and no asymmetric layout produces clipped or overlapping text

### Requirement: Narrative-section performance budgets hold
All new visual work in narrative sections SHALL use static Astro-rendered HTML/CSS, responsive images (AVIF/WebP variants via the existing manifest), lazy loading below the fold, and CSS-only motion that pauses offscreen; JS additions outside existing interactive areas SHALL NOT be introduced.

#### Scenario: Weight and vitals budget
- **WHEN** the finished homepage is measured at 1440px on a throttled connection
- **THEN** LCP remains ≤ 2.5s-equivalent conditions, CLS < 0.02, total JavaScript stays within the existing dist budget, and added hero/section image transfer fits the design's per-image caps
