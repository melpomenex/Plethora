## Purpose

Governs the homepage hero's product presentation: the composed desktop+mobile device artwork, its scale/depth/overlap, premium generic device framing, grid escape, responsive fallbacks, and the launch-aware call-to-action hierarchy beneath the headline.

## ADDED Requirements

### Requirement: Hero media is a single composed product stage
The hero SHALL present the desktop and mobile product captures as one designed composition sharing a single perspective model, rather than two independently positioned rotated rectangles.

#### Scenario: Shared composition
- **WHEN** the hero renders at ≥1024px viewport width
- **THEN** both devices sit inside one perspective context with related angles, controlled overlap, and distinct-per-device shadow treatments

### Requirement: Substantially larger desktop media
At 1440px viewport width the rendered desktop frame SHALL be at least ~1.4× wider than the previous 28rem implementation (target band ≈34–40rem), with the text column retaining site-grid alignment and roughly 0.8:1.2 text-to-media proportions (final ratio tunable within that intent).

#### Scenario: Desktop width at 1440
- **WHEN** the homepage renders at 1440×900 in either theme
- **THEN** the desktop device frame renders at least 544px wide while the headline block remains aligned to the content grid

### Requirement: Controlled grid escape on large screens
On viewports ≥1280px the hero media MAY extend past the centered content grid toward the right viewport edge; it SHALL NOT create horizontal page overflow at any supported breakpoint, and on <1280px widths the composition SHALL stay within the grid.

#### Scenario: No horizontal overflow
- **WHEN** the homepage is loaded at 320, 390, 768, 1024, 1280, 1440, and 1728px widths
- **THEN** no horizontal scrollbar appears and no element overflows the document bounds

### Requirement: Believable restrained depth
Device transforms SHALL use subtle rotation values (rotateY magnitude ≤ ~15°, rotateX/rotateZ ≤ ~3°) under one shared perspective so screenshot text stays legible; the phone SHALL read as the physically front device overlapping the desktop by approximately 15–20% of the desktop width; the two devices SHALL use visibly different shadow energies (wide soft ground shadow vs tight contact shadow).

#### Scenario: Screenshot legibility under perspective
- **WHEN** the transformed hero is inspected at 100% zoom
- **THEN** body-size text inside the desktop capture remains readable and unskewed enough for comfortable reading

#### Scenario: Foreground phone overlap
- **WHEN** the composition renders at ≥768px
- **THEN** the phone overlaps the desktop edge within the 15–20% target and casts the tighter, higher-contrast contact shadow of the two

#### Scenario: Reduced motion statics
- **WHEN** `prefers-reduced-motion: reduce` is active
- **THEN** transforms are removed or minimized without breaking the overlap composition, and no animation runs

### Requirement: Generic premium phone framing
The mobile capture SHALL be presented in a layered generic device frame — outer metallic rim highlight, dark chamfer, inset screen with inner shadow, subtle thickness cue, and a small generic speaker/camera treatment where size permits — without Apple-specific branding, Dynamic-Island mimicry, large fake notches, or recognizable copyrighted industrial design.

#### Scenario: Framed versus padded
- **WHEN** the hero phone renders at ≥240px CSS width
- **THEN** the rim/inset layering is visible such that the screenshot does not read as an image inside plain black padding

#### Scenario: Small-size degradation
- **WHEN** the phone presentation renders below ~240px CSS width
- **THEN** fine bezel details (speaker/camera) are suppressed while the rim/inset screen treatment remains

### Requirement: Mobile hero fallback prioritizes the mobile product
Below 768px the hero SHALL prioritize a legible mobile device presentation (no shrunken desktop+phone pairing), keep headline/lede/CTAs readable before it, and preserve strong product presence; the desktop capture SHALL reappear later in the page narrative.

#### Scenario: Hero at 390px
- **WHEN** the homepage renders at 390×844
- **THEN** the mobile device presentation occupies a prominent share of the hero area, all copy remains ≥16px equivalent, and no horizontal overflow occurs

### Requirement: Launch-aware CTA hierarchy without development-state prose
The hero call-to-action row SHALL present a primary Get-Plethora action and one secondary action whose labels/hrefs respond to launch flags, using intentional visitor-facing wording in every state; implementation/development disclaimers SHALL NOT appear beneath or adjacent to primary CTAs anywhere on production pages.

#### Scenario: Downloads disabled state
- **WHEN** downloads are not enabled by launch flags
- **THEN** the primary CTA communicates upcoming availability as user-facing copy (e.g., coming-soon styling/label) and no sentence describing unpublished builds or internal wiring appears near the CTAs

#### Scenario: Downloads enabled state
- **WHEN** `downloadsEnabled` is true
- **THEN** the primary CTA reads "Get Plethora", links to `/downloads`, and behaves as a standard download entry point

### Requirement: Anti-generic preservation in the hero
The hero SHALL NOT introduce mesh/purple gradient wallpapers, particle effects, glassmorphism panels, fake chat, 3D mascot renders, or autoplaying ambient video; decorative additions are limited to the composition, mat/caption treatments derived from real UI.

#### Scenario: Banned-pattern sweep
- **WHEN** the finished hero is reviewed against the anti-generic checklist from `design-useplethora-homepage-experience`
- **THEN** every banned pattern is still attested absent with review screenshots recorded
