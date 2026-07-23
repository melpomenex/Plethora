# startup-bundle-budget

The startup-critical JS chunk stays within a defined budget; deferred-loadable assets load outside it.

## ADDED Requirements

### Requirement: Theme registry loads outside the startup chunk
The full built-in theme registry SHALL be excluded from the startup-critical chunk. Only the minimal fallback themes needed for first paint MAY load eagerly, and the fallback module SHALL be the single source of truth for those themes (no duplicated definitions).

#### Scenario: Theme registry is a separate chunk
- **WHEN** the production bundle is built
- **THEN** the built-in theme registry emits as its own lazily-loaded chunk and the entry chunk does not contain it

#### Scenario: Theme selection still works
- **WHEN** a user whose persisted theme is a non-fallback built-in theme launches the app
- **THEN** the app first paints with a valid fallback theme and applies the persisted theme as soon as the registry chunk loads, with no error and no permanent flash of unstyled content

### Requirement: Settings sections load lazily
Each settings section panel SHALL load as its own lazy chunk when its section is opened. Settings search and section navigation metadata SHALL remain available without loading the panels.

#### Scenario: Opening Settings loads only the shell
- **WHEN** the user opens Settings
- **THEN** only the settings shell and the initially visible section's chunk are fetched, not all section panels

#### Scenario: Cross-section search unaffected
- **WHEN** the user searches settings for a term matching a not-yet-loaded section
- **THEN** the matching section appears in results and opening it loads its chunk on demand

### Requirement: Exactly one PDF.js worker ships
The production asset set SHALL contain exactly one PDF.js worker build, used by all platform paths (worker-port path, workerSrc fallback path, and PWA path).

#### Scenario: Single worker asset in dist
- **WHEN** the production bundle is built
- **THEN** the emitted assets contain exactly one PDF.js worker file and PDF rendering works on desktop, Android, and PWA using it

### Requirement: Bundle budgets are enforced
A build-time check SHALL fail the build when the entry chunk size or the total emitted asset size exceeds recorded budgets, so regressions are caught at build time rather than discovered in profiling.

#### Scenario: Budget regression fails the build
- **WHEN** a change increases the entry chunk beyond its recorded budget
- **THEN** the budget check exits non-zero and names the offending metric and its limit
