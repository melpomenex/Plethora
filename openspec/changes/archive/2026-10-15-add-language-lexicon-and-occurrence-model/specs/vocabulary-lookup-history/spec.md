# Spec Delta: vocabulary-lookup-history

## MODIFIED Requirements

### Requirement: Durable profile-scoped lookup projection

Lookup history SHALL be backed by the durable language lexicon when a profile is available, preserving legacy counts/timestamps/source IDs through a compatibility projection. New lookup events MUST NOT depend solely on localStorage.

#### Scenario: Legacy store compatibility
- **WHEN** the user opens the existing vocabulary history surface after migration
- **THEN** it reads the durable projection and preserves the prior recent/count ordering semantics

### Requirement: No learning side effect

Recording a lookup SHALL update lookup evidence only and MUST NOT create an SRS item, rate a Queue item, or change language knowledge state without a separate explicit action.

#### Scenario: Repeated cached lookup
- **WHEN** a cached Dictionary Peek is reopened
- **THEN** it does not inflate lookup history merely because the component re-rendered
