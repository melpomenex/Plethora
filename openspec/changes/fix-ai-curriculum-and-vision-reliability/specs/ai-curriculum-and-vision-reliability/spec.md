## ADDED Requirements

### Requirement: Curriculum preflight pins resolved route and handles resume cleanly

Starting or resuming AI curriculum generation with "Use app default" SHALL pin the authorized route and compare source document IDs as sets so transient discovery or ordering differences do not fail generation.

#### Scenario: Starting curriculum generation with default model succeeds without false drift error
- **WHEN** the user opens CurriculumGenerator with "Use app default" and clicks Start
- **THEN** generation uses the pinned authorized route without throwing `provider_changed_on_resume`
- **AND** any failure preserves the existing saved Study Plan

### Requirement: Mirage Vision reports clear runtime availability without relative dlopen failures

`CactusLibrary::load` SHALL probe standard bundle paths including `Contents/Frameworks/` and SHALL report an actionable missing-runtime error rather than failing with macOS Hardened Runtime relative `dlopen` errors.

#### Scenario: Missing Cactus library surfaces actionable status
- **WHEN** `libcactus` is not bundled or configured via `PLETHORA_CACTUS_LIB`
- **THEN** Mirage Vision reports a clear unavailable-runtime status with recovery instructions instead of a raw relative-path `dyld` error
