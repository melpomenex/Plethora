# Specification: Scheduler Taxonomy & Naming Architecture

## MODIFIED Requirements

### Requirement: Central Scheduler Catalog declares Plethora-native product taxonomy
The system SHALL maintain a central registry of spaced repetition schedulers (`SCHEDULER_CATALOG` in `src/lib/schedulerCatalog.ts`) where all schedulers are registered with canonical identifiers: `"fsrs"`, `"adaptive"`, `"precision"`, `"classic"`, `"classic_5"`, `"classic_8"`, and `"classic_15"`.

#### Scenario: Schedulers expose Plethora product labels
- **WHEN** user-facing metadata is resolved for scheduler `"adaptive"`
- **THEN** `label` is `"Plethora Adaptive"`, `shortLabel` is `"Adaptive"`, and `thirdParty` is `false`

#### Scenario: Precision scheduler exposes Algorithm Arena metadata
- **WHEN** user-facing metadata is resolved for scheduler `"precision"`
- **THEN** `label` is `"Plethora Precision"`, `shortLabel` is `"Precision"`, and `thirdParty` is `false`

#### Scenario: FSRS scheduler preserves third-party attribution
- **WHEN** user-facing metadata is resolved for scheduler `"fsrs"`
- **THEN** `label` is `"FSRS-6"`, `shortLabel` is `"FSRS-6"`, and `thirdParty` is `true`

### Requirement: Algorithm Arena models use neutral competitor labels
The Algorithm Arena SHALL identify its candidate models via canonical IDs: `"classic"`, `"classic_15"`, `"classic_19"`, `"precision"`, and `"fsrs"`.

#### Scenario: Arena candidate labels avoid third-party trademarks
- **WHEN** the Algorithm Arena choices are rendered during card review
- **THEN** candidate labels are `"Plethora Classic"`, `"Classic 15"`, `"Classic 19"`, `"Plethora Precision"`, and `"FSRS"`, and no candidate displays a SuperMemo trademark

### Requirement: Knowledge formulation rules are presented neutrally
The knowledge formulation engine (`src/lib/ai/knowledgeFormulation.ts`) and associated UI modals SHALL present the formulation principles as "20 Rules of Knowledge Formulation" without personal pioneer branding in headers, command descriptions, or AI prompt personas.

#### Scenario: Command palette formulation command uses clean title
- **WHEN** the user opens the command palette and searches for `/20rules` or formulation actions
- **THEN** the command title is `"Formulate atomic flashcards following the 20 Rules of Knowledge Formulation"`
