## ADDED Requirements

### Requirement: Reproducible RC gate
The release candidate SHALL be defined by a gate set (unit/UI tests, Rust tests, performance benches, bundle budget, script tests, browser-extension tests, localization completeness) that must pass with no regressions, and the audit SHALL record each gate's result.

#### Scenario: Gates green
- **WHEN** the RC gate is evaluated
- **THEN** every listed gate passes or has a filed, justified exception

### Requirement: Findings classified and dispositioned
Audit findings SHALL be classified P0–P3 with evidence and an explicit disposition (fixed, deferred with rationale, or manual-verification steps), recorded in the RC findings document.

#### Scenario: P0/P1 blocks RC
- **WHEN** an open P0 or P1 finding exists
- **THEN** the RC is not declared complete until it is fixed

### Requirement: Human launch checklist contains only human tasks
The launch checklist SHALL contain only tasks that require human action or external parties (legal, financial, store enrollments, submissions, creative assets requiring approval) and SHALL NOT include tasks completable in-repository.

#### Scenario: Engineering work excluded
- **WHEN** an item is completable by repository changes
- **THEN** it is implemented or tracked as an engineering finding instead of appearing in the human checklist
