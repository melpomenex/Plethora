## ADDED Requirements

### Requirement: Browser FSRS-7 parity
The browser/PWA TypeScript FSRS-7 implementation SHALL produce scheduling state equivalent to the vendored Rust canonical implementation within documented floating-point tolerance.

#### Scenario: Differential random corpus
- **WHEN** 10,000 deterministic random review histories are replayed in TypeScript
- **THEN** incremental scheduling matches replay scheduling for stability, stability_fast, and difficulty
