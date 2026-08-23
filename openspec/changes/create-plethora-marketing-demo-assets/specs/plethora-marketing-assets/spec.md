## ADDED Requirements

### Requirement: Demo library is legally safe and coherent
The marketing demo library SHALL contain only original, public-domain, or permissively licensed material with attribution recorded in `marketing/licenses/ATTRIBUTION.md`. Items SHALL share one educational story. Commercial book covers, scraped articles, and personal data SHALL NOT appear.

#### Scenario: Attribution file
- **WHEN** a new demo file is added
- **THEN** ATTRIBUTION.md lists its license and source, and CI or the freshness script fails if a binary lacks an entry

### Requirement: Seeding is deterministic and opt-in
Loading the marketing library into the app SHALL be deterministic (stable ids) and SHALL NOT alter default production first-run behavior unless a documented marketing/dev flag is set.

#### Scenario: Normal install
- **WHEN** a user launches Plethora without the marketing seed flag
- **THEN** their library is not overwritten by marketing fixtures

### Requirement: Screenshots come from the real application
Production marketing screenshots SHALL be captured from the real Plethora UI using the seeded library. Invented controls that the app does not have SHALL NOT be drawn onto screenshots.

#### Scenario: Manifest integrity
- **WHEN** the asset manifest is read by the website
- **THEN** each non-placeholder screenshot references a file on disk with viewport, theme, alt text, and license

### Requirement: Placeholders are explicit launch blockers
Required shots that cannot yet be captured SHALL be marked `placeholder: true` and listed as blockers. Indexed production SHALL NOT ship while required blockers remain (enforced with change F when indexing is on).

#### Scenario: Missing reader shot
- **WHEN** the reader screenshot is absent
- **THEN** the manifest records a blocker id `screenshot-reader` rather than substituting a mock-up of a fictional app
