## Purpose

Establishes production-copy discipline for the Plethora marketing website: document/device terminology rules, elimination of development-state messaging, and claim-safety gating so visible copy never leaks implementation status or unverified claims.

## ADDED Requirements

### Requirement: User-facing copy uses "document", not "essay"
Production-facing website copy SHALL refer to reading artifacts as documents (or the specific true format such as PDF/article where apt); framing the showcase workflow around "essay" SHALL NOT appear in user-visible marketing copy. Generic content-type lists (e.g., "books, essays, and papers" describing what users read) are not violations.

#### Scenario: Homepage audit
- **WHEN** all homepage sections and their embedded captions are grepped for the singular/plural word "essay"
- **THEN** no remaining occurrence frames the product's artifact as an essay, while legitimate generic genre listings may remain with documented justification

#### Scenario: Showcase narrations and labels
- **WHEN** the Reading Desk, demo page, scene labels, narrations, and accessibility descriptions render
- **THEN** they consistently use "document"/"documents" for the example artifact

### Requirement: User-facing copy uses "devices", not "surfaces"
Where website copy presents hardware/platform availability to visitors, it SHALL say device/devices (e.g., "across your devices"); internal technical concepts legitimately named surface — CSS tokens/properties (`--surface-*`), analytics event fields/types, claims-matrix `allowedSurfaces` keys, component prop names, non-user-visible config fields — MAY remain unchanged.

#### Scenario: Visitor-facing sweep
- **WHEN** rendered page text visible to visitors is audited for the standalone words "surface(s)" used to mean hardware
- **THEN** occurrences are replaced with device terminology or rephrased; technical identifiers remain untouched and listed in a whitelist

### Requirement: No development-state messaging in production copy
Production-facing pages SHALL NOT display sentences that describe build/pipeline/internal state as visitor-facing disclaimers (e.g., explaining what "this page does not claim" about features, that downloads "are not published yet", or that pricing figures exist only for internal direction); launch-incomplete states SHALL be expressed through intentional user-facing wording driven by launch flags.

#### Scenario: CTA adjacency check
- **WHEN** any production page renders a primary call-to-action in any flag state
- **THEN** no development-status disclaimer text appears beneath or beside it

#### Scenario: Platform/pricing states
- **WHEN** platform availability or pricing renders while storefront/download flags are disabled
- **THEN** wording presents honest human-facing statuses (e.g., available / in final testing / planned) without referencing manifests, build processes, or claim-testing scope

### Requirement: Claim-safety gates keep enforcing truthfulness
All new or edited capability statements on the website SHALL map to the claims matrix — public rows restricted to allowed surfaces, pending items marked with the established pending attribute, banned-phrase list still enforced by the dist gate.

#### Scenario: Claims tests pass after copy changes
- **WHEN** the finished copy set is validated via the website unit suite and dist checks
- **THEN** claims-surface enforcement, banned-phrase scanning, and launch-blocker gates all pass without new exemptions beyond documented whitelists

### Requirement: Terminology regression guard exists
The repository SHALL include an automated check (grep-based CI gate) that fails when user-facing `essay(s)` reappear outside the documented generic-genre whitelist, and reports user-facing `surface(s)` usage for review against the technical-use whitelist.

#### Scenario: Regression attempt
- **WHEN** a change reintroduces user-visible "essay" framing into homepage or showcase copy
- **THEN** the automated gate fails with a message pointing at the offending file
