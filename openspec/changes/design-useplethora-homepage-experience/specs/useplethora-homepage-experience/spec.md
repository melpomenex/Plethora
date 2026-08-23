## ADDED Requirements

### Requirement: Homepage tells a single memory story
The homepage SHALL present the journey Capture → Read → Understand → Connect → Remember using one coherent example artifact, not a disconnected icon grid as the primary explanation.

#### Scenario: Visitor reads in order
- **WHEN** a visitor scrolls the homepage from top to bottom
- **THEN** they encounter hero, problem, capture, read, understand, remember, connect, trust, platforms, pricing teaser, and closing CTA in that order (or an explicitly documented improvement that still contains each beat)

### Requirement: Primary copy is Plethora-specific
The hero SHALL use the primary promise “Everything you read. Remembered.” and MAY use the supporting line “Read anything. Learn everything.” CTAs SHALL include “Get Plethora” and “Try the interactive demo”.

#### Scenario: Headline present
- **WHEN** the homepage is rendered
- **THEN** the H1 contains the primary promise and both CTAs exist as links or buttons

### Requirement: Visual language is not generic AI SaaS
The homepage SHALL NOT rely on the banned pattern list in this change’s design (mesh blobs, fake chat hero, particle fields, looping typewriter slogan, interchangeable rounded feature-card trio as the first fold).

#### Scenario: Review artifact
- **WHEN** implementers complete the homepage
- **THEN** `website/docs/homepage-review.md` exists and attests each banned pattern is absent, with attached screenshots

### Requirement: Canonical mascot only
Mascot artwork SHALL derive from `assets/brand/plethora-icon-master.svg` (or the website copy) using the inventory hexes. A second mascot SHALL NOT be invented. Mascot motion SHALL respect `prefers-reduced-motion`.

#### Scenario: Reduced motion
- **WHEN** the user prefers reduced motion
- **THEN** the bird does not bounce or loop and Peck is a static pose

### Requirement: Motion is interruptible and optional
Decorative animation SHALL pause when offscreen or when the document is hidden, SHALL NOT require a permanent rAF loop, and SHALL NOT hijack scrolling. Content SHALL remain readable if animation JS fails.

#### Scenario: JS disabled
- **WHEN** JavaScript is disabled
- **THEN** hero copy, section copy, and CTAs remain visible in HTML
