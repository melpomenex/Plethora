## ADDED Requirements

### Requirement: Pricing is configuration-driven
The pricing page SHALL render Free vs Pro from typed plan configuration (display prices, interval toggle, feature ids). It SHALL NOT hard-code store SKUs or fake in-app purchase prices inside product mock UI. Checkout SHALL remain disabled until launch flags enable it.

#### Scenario: Default clone
- **WHEN** checkoutEnabled is false
- **THEN** Pro CTAs do not navigate to a live payment provider

### Requirement: Downloads never lie
The downloads page SHALL recommend a platform without hiding others, SHALL show system requirements, and SHALL render coming-soon or disabled states instead of 404 links when artifacts are missing.

#### Scenario: iOS before store listing
- **WHEN** iOS availability is `coming-soon`
- **THEN** the iOS control explains unavailability and is not a broken App Store URL

### Requirement: Public claims are gated
Product statements on commercial pages SHALL reference claim matrix ids. Claims with `public: false` SHALL NOT appear on indexed pages.

#### Scenario: AnkiConnect
- **WHEN** `anki-connect-live` is not public
- **THEN** the Anki page does not state that live AnkiConnect synchronization is available

### Requirement: Legal identity is not fabricated
Terms, privacy, refunds, and contact pages SHALL use legal placeholder fields. When entity/email/jurisdiction are null, pages SHALL display a draft notice. D-U-N-S SHALL NOT be published.

#### Scenario: Missing entity
- **WHEN** legalEntityName is null
- **THEN** the privacy page states that it is a draft and does not invent a company name

### Requirement: Audience pages are distinct and honest
SEO landing pages SHALL have unique introductory copy and self-canonical URLs, SHALL NOT keyword-stuff, and SHALL NOT duplicate the homepage verbatim.

#### Scenario: Canonical
- **WHEN** `/anki` is requested
- **THEN** the canonical link is the Anki page URL and the content distinguishes package import from live sync
