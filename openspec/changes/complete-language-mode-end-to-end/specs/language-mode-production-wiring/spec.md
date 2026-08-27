## ADDED Requirements

### Requirement: Wrapper injects production bindings
`DocumentViewerWrapper` SHALL pass shadowing providers, writing provider, pronunciation manifest, reading assist registry, and capability map into `LanguageLearningHostProvider`.

#### Scenario: Tab document opens
- **WHEN** a learner opens a document tab through `DocumentViewerWrapper`
- **THEN** the language host SHALL receive production provider bindings and capability overrides

### Requirement: Queue Scroll uses language host
Queue Scroll embedded documents SHALL use `DocumentViewerWrapper` in embedded mode so Language Mode host overlays are available.

#### Scenario: Queue Scroll document item
- **WHEN** a learner views a document in Queue Scroll mode
- **THEN** Language Mode controls and overlays SHALL be mountable through the shared host provider

### Requirement: Translation service registers AI provider
The default translation service SHALL register both ML Kit and configured AI translation providers.

#### Scenario: Desktop with configured AI
- **WHEN** translation is requested on desktop with a configured AI provider
- **THEN** the translation service SHALL select the AI provider when ML Kit is unavailable

### Requirement: No empty production reading assist registry
Production reading assist registry SHALL register providers only when they can truthfully assist; overlays MUST NOT instantiate empty registries silently.

#### Scenario: Reading assist overlay opens
- **WHEN** the learner invokes reading assist
- **THEN** the overlay SHALL use the shared production registry injected by the host

### Requirement: Golden-path integration test
An automated integration test SHALL cover profile load, association creation, host ready resolution, and truthful capability defaults.

#### Scenario: Golden path executes in CI
- **WHEN** the golden-path integration test runs
- **THEN** it SHALL verify association creation transitions the host to `ready` with non-optimistic capabilities
