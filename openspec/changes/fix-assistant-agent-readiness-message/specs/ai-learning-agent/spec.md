## ADDED Requirements

### Requirement: Blocked-mode messaging names the real blocker

When the Learning Agent mode cannot start because feature readiness is not `ready`, the
Assistant SHALL explain the first unmet readiness dependency, and SHALL NOT present a
degradation limitation as the blocking reason.

#### Scenario: Mobile lexical fallback does not block the agent mode

- **WHEN** the learning-agent readiness row has status `setup-required` and carries the
  `ai.limitation.lexicalRetrieval` limitation
- **THEN** toggling the mobile `Learn` control reports the unmet dependency's reason
- **AND** the notice does not mention lexical retrieval as the reason

#### Scenario: Ready row with a limitation stays enterable

- **WHEN** the learning-agent readiness row is `ready` and carries a limitation
- **THEN** the mode toggle enters Learning Agent mode without an unavailable notice

#### Scenario: No reason key still explains the block

- **WHEN** the row is not `ready` and no unmet dependency exposes a reason key
- **THEN** the notice uses the stable fallback copy `assistant.agent.modeBlocked`

### Requirement: Readiness copy is always localized

Every readiness reason or limitation rendered by the Assistant SHALL be resolved through
the i18n layer before display, so a raw translation key is never shown to the user.

#### Scenario: Missing translation cannot leak a key

- **WHEN** a readiness reason key resolves to no localized string
- **THEN** the user sees the English fallback or the generic blocked copy
- **AND** no dotted key such as `ai.limitation.lexicalRetrieval` appears in the UI

#### Scenario: Placeholder contract preserved

- **WHEN** the unavailable notice renders
- **THEN** `assistant.mode.unavailable` receives a single already-translated `{reason}`
- **AND** the copy still reads as one sentence on desktop and mobile presentations
