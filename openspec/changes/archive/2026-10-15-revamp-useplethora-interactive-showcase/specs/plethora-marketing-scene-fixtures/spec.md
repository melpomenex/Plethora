## ADDED Requirements

### Requirement: Marketing fixture represents a complete coherent library
The capture system SHALL compile one versioned marketing fixture containing approved documents, file metadata, extracts, cards, queue state, reading progress, review history, notes, tags, and knowledge connections that together tell the same licensed demo story.

#### Scenario: Populated first capture
- **WHEN** the fixture is loaded into a fresh capture database
- **THEN** required library, queue, reader, review, analytics, and connection queries return the expected fixed entities and counts without additional imports or network calls

#### Scenario: Broken cross-reference
- **WHEN** a card, extract, review event, or connection references an entity absent from the fixture
- **THEN** fixture compilation fails before any screenshots are generated

### Requirement: Fixture seeding is deterministic and isolated
Marketing seeding SHALL use fixed IDs, a fixed logical clock, stable media hashes, and a versioned schema; it SHALL create a disposable persistence namespace and SHALL NOT read, modify, merge with, or reveal a normal user or developer database.

#### Scenario: Repeated seed
- **WHEN** two capture runs seed the same fixture version for the same app schema
- **THEN** their persisted entity values, ordering, due state, and fixture hash are identical

#### Scenario: Existing user data
- **WHEN** a developer has a populated Plethora library on the same machine
- **THEN** the capture run uses a different explicit database or browser-storage namespace and no existing title, cover, account, or history appears in a capture

### Requirement: Fixture state exists before captured UI mounts
The capture application SHALL complete the base fixture transaction before mounting the requested product route. Post-mount store mutation SHALL NOT be the authoritative source for persisted marketing data.

#### Scenario: Library route boot
- **WHEN** capture starts at `library.ready`
- **THEN** the first settled library query reads the complete fixture and the capture never exposes a zero-document or skeleton state as ready

### Requirement: Named scenes resolve to real product states
Every required showcase scene SHALL declare a stable scene ID, fixture version, route, expected content sentinels, supported layouts, predecessor/successor relationships, accessible description, and actual action targets in a machine-readable scene catalog.

#### Scenario: Resolve review answer
- **WHEN** the runner requests `review.answer` with a supported layout
- **THEN** the real review surface opens on the fixture card with its answer and current in-app grading controls visible

#### Scenario: Unknown scene
- **WHEN** the runner requests a scene ID not in the catalog
- **THEN** capture fails with a diagnostic and writes no screenshot or production manifest entry

### Requirement: Capture readiness proves complete hydration
The app SHALL mark a scene capture-ready only after fixture commit, route resolution, scene state application, font readiness, visible image decode, stable layout, expected sentinels, and absence of loading, skeleton, placeholder, or error UI.

#### Scenario: Cover has not decoded
- **WHEN** all expected text is present but an in-viewport cover is still loading
- **THEN** the readiness handshake remains incomplete and the runner does not capture the scene

#### Scenario: Empty library regression
- **WHEN** the requested populated library renders zero-document copy or skeleton cards
- **THEN** readiness fails and the asset cannot be marked non-placeholder

### Requirement: Marketing screenshots come from the real app
Each production scene image SHALL be captured from the actual Plethora UI running against the approved fixture. The pipeline MUST NOT draw fictional product controls, replace product content after capture, or represent a PWA-sized frame as a native store screenshot.

#### Scenario: Website mobile scene
- **WHEN** a mobile scene is approved for the website simulator
- **THEN** its manifest identifies whether the source was PWA, simulator, or physical device and preserves the real controls visible in that source

#### Scenario: Store-size request
- **WHEN** a release owner requests an App Store or Play Store image
- **THEN** the pipeline requires the designated native RC/device capture path rather than upscaling or reframing a CSS viewport capture

### Requirement: Assets have verifiable provenance and freshness
Every non-placeholder asset SHALL record scene ID, source build/version and git SHA, fixture version/hash, source type, platform, viewport, DPR, theme, locale, capture time, dimensions, file hash, license, and accessible description. The website build SHALL reject required assets whose files, hashes, fixture versions, or source builds do not match the active manifest policy.

#### Scenario: Stale fixture asset
- **WHEN** a required screenshot was captured from a different fixture version than the active scene catalog
- **THEN** freshness validation fails and indexed production cannot consume that screenshot

#### Scenario: Tampered image
- **WHEN** the bytes of a referenced screenshot change without a manifest hash update
- **THEN** asset validation fails before the website build is accepted

### Requirement: Captures contain only approved fictional or licensed content
The capture pipeline SHALL allow only content and media declared in the marketing corpus attribution inventory. It MUST reject personal data, real account identifiers, unapproved remote media, commercial covers, and content from a developer's library.

#### Scenario: Unexpected title or image domain
- **WHEN** capture validation detects a title, cover hash, person image, or remote domain outside the fixture allowlist
- **THEN** the scene is quarantined and no website derivative is produced

### Requirement: Capture builds cannot affect normal product behavior
Fixture and scene controls SHALL be unavailable in normal production launches unless an explicit capture build capability is present. A query string alone MUST NOT enable destructive seeding or replace a user's library.

#### Scenario: Production URL includes capture parameters
- **WHEN** a normal production PWA or app opens with fixture and scene query parameters
- **THEN** those parameters do not create, replace, or expose marketing fixture data

### Requirement: Required scene set is complete across declared layouts
The release gate SHALL verify that every scene/layout pair marked required by the active story has a validated non-placeholder asset and valid outgoing simulator action metadata.

#### Scenario: Missing desktop reader scene
- **WHEN** `reader.open` declares desktop as required but no fresh desktop image exists
- **THEN** the showcase readiness check fails and production continues to use its explicit fallback rather than an empty device frame

