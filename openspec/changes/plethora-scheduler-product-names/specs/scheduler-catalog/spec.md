## ADDED Requirements

### Requirement: Central scheduler display catalog
The system SHALL provide a single scheduler catalog that maps every selectable scheduler id (`fsrs`, `sm2`, `sm5`, `sm8`, `sm15`, `sm18`, `sm20`) to its user-facing label, description, and rating schema reference, and all user-interface code SHALL resolve scheduler names through this catalog instead of hardcoding them.

#### Scenario: UI resolves labels from catalog
- **WHEN** any settings, statistics, inspector, transparency, or onboarding surface needs a scheduler display name
- **THEN** it obtains the label from the scheduler catalog, and no user-facing component contains a hardcoded SM-2/SM-18/SM-20/SM-15/SM-19 string

#### Scenario: Persisted identifiers unchanged
- **WHEN** a scheduler is selected, stored, synced, or serialized
- **THEN** the persisted id values (`fsrs`, `sm2`, `sm5`, `sm8`, `sm15`, `sm18`, `sm20`), Rust enum serde ids and order, Tauri command names, and settings validation enums are exactly as before the rename

### Requirement: Plethora product names for SuperMemo-derived schedulers
The system SHALL display SuperMemo-derived schedulers under Plethora product names: `sm2` → "Plethora Classic", `sm18` → "Plethora Adaptive", `sm20` → "Plethora Precision", while FSRS SHALL remain labeled "FSRS-6" and MUST NOT be presented as Plethora-derived.

#### Scenario: Settings shows product names
- **WHEN** the user opens the learning-algorithm setting
- **THEN** options are labeled FSRS-6, Plethora Adaptive, Plethora Precision, and Plethora Classic with behavior-focused descriptions and no superiority claims

#### Scenario: Localized names
- **WHEN** a non-English locale is active
- **THEN** scheduler labels and descriptions in that locale use the renamed values while key names remain unchanged

### Requirement: Scheduler behavior invariant under rename
Renaming display strings SHALL NOT alter scheduling behavior, persisted payloads, rating schemas, or rating controls.

#### Scenario: Rating semantics preserved
- **WHEN** algorithm is `sm18` or `sm20`
- **THEN** touch devices use the joystick rating interaction and desktop uses the six-grade buttons exactly as before, and grading produces identical payloads

#### Scenario: Arena labels consistent across stack
- **WHEN** arena statistics are rendered (native or browser backend)
- **THEN** model labels come from the updated Rust label source and its TS mirror, which agree; arena model ids and their order are unchanged
