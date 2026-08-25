## ADDED Requirements

### Requirement: Canonical Documentation Source-of-Truth Ingestion
The documentation system SHALL establish `docs/product/**` as the single authoritative source of truth for Plethora product documentation, automatically synchronizing and transforming canonical documents into the Astro content collection `website/src/content/docs/**` during build time.

#### Scenario: Build-time synchronization and transformation
- **WHEN** `npm run website:build` or `node scripts/docs-sync-website.mjs` executes
- **THEN** all canonical markdown documents from `docs/product/**` are validated, enriched with website taxonomy metadata, and written to `website/src/content/docs/`, while internal notes marked `published: false` are excluded from the public build.

### Requirement: Comprehensive Feature Coverage of Shipped Capabilities
The documentation center SHALL provide dedicated, code-verified documentation articles covering all user-facing features across reading viewers, document ingestion, queue composition, spaced repetition algorithms (FSRS-6, Plethora Adaptive, Plethora Precision, TAS), flashcard review surfaces, language learning tools, media/TTS, AI providers, RSS/podcasts, platform specifics, themes, and local-first privacy.

#### Scenario: Verification of shipped feature documentation
- **WHEN** the documentation coverage script (`scripts/docs-coverage.mjs`) runs
- **THEN** every active user-facing capability identified in the capability registry is mapped to an authoritative wiki page with concrete behavioral rules, prerequisites, and expected outcomes.

### Requirement: Strict Truthfulness, Claim Assertion & Limitation Disclosure
Public documentation articles SHALL assert all referenced factual claims against the claim matrix in `website/src/config/claims.json`, preventing unverified claims (such as live AnkiConnect sync, unreleased cross-device sync, or unenforced paywalls) from appearing in public copy without explicit status qualification badges.

#### Scenario: Validation of claim references in documentation
- **WHEN** an article frontmatter specifies `claimIds: ["local-reading-formats", "srs-fsrs"]`
- **THEN** the validation suite verifies that all IDs exist in `claims.json` and possess `public: true` with a verified shipping status.

#### Scenario: Detection of unauthorized or unverified claims
- **WHEN** an article contains unverified claims or banned phrases (such as "zero-knowledge sync" or "live AnkiConnect sync" stated as current facts)
- **THEN** `website/scripts/check-wiki.mjs` fails with a descriptive error specifying the offending file and line number.

### Requirement: Automated Link & Reference Integrity Validation
The documentation test suite SHALL validate that every internal markdown link, related document ID, and heading anchor across all published documentation articles resolves to a valid, existing destination without 404 errors.

#### Scenario: Internal link verification
- **WHEN** `website/scripts/check-wiki.mjs` scans all articles in `website/src/content/docs/`
- **THEN** any broken internal link (`[link text](../category/missing-slug)`) or invalid `relatedDocs` ID causes the script to exit with code 1 and output the exact broken references.
