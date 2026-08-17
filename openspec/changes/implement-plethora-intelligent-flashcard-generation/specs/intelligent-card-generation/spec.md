## ADDED Requirements

### Requirement: Generation supports multiple card forms with validated sources
Generators SHALL produce (at minimum) Q/A, cloze, image-occlusion, conceptual, application, and compare/contrast forms, each carrying a form-specific field set, difficulty estimate, target concept(s), and a source quote that SHALL be validated against the actual source text — fabricated quotes fail generation.

#### Scenario: Fabricated quote rejected
- **WHEN** a generated card's quote cannot be found in the cited source passage
- **THEN** the candidate is rejected or regenerated before reaching preview

### Requirement: Deterministic quality heuristics annotate candidates
Card-quality heuristics (answer leakage, scope breadth, yes/no trivia, ambiguity, cloze salience, length budgets) SHALL score and annotate every candidate deterministically. Annotations surface in preview; heuristic failures block acceptance unless explicitly overridden per card.

#### Scenario: Leakage flagged
- **WHEN** a Q/A candidate's question contains its answer
- **THEN** preview marks the leakage and the accept action requires override

### Requirement: Duplicate detection blocks silent duplicates
Every candidate SHALL pass card-level duplicate detection (embedding similarity + lexical near-duplicate + source-hash identity against existing cards in scope). Detected duplicates present a side-by-side comparison (keep both / merge / skip) and SHALL NOT be addable silently.

#### Scenario: Near-duplicate blocked
- **WHEN** a candidate is ≥ the similarity threshold of an existing card
- **THEN** acceptance shows the duplicate comparison first

### Requirement: Acceptance is explicit with provenance
No card SHALL be created without explicit user acceptance. Every accepted card SHALL record AI provenance (task, model) and a stable `source_ref` (document/locator/extract/concept) supporting later lifecycle analysis (proposal 14).

#### Scenario: Provenance invariant
- **WHEN** any acceptance path creates a card
- **THEN** a provenance row and source_ref exist (test-enforced across all entry points)

### Requirement: Preferences adapt generation locally
Accept/reject/edit signals SHALL adjust generator parameters (forms, length, difficulty) within bounded drift, stored locally per user, inspectable and resettable. Preference data SHALL never sync or leave the device.

#### Scenario: Reset restores defaults
- **WHEN** the user resets card preferences
- **THEN** subsequent generations use default parameters

### Requirement: Hosted generation is capability-gated; BYO/local stays free
Plethora-hosted premium generation SHALL require `enhanced_card_generation` with per-period card quotas, disclosed data flow (excerpts/images leave the device), and AI-exclusion enforcement. On-device Nano and user-keyed provider generation SHALL remain fully available without the capability.

#### Scenario: Free user generates from a chapter
- **WHEN** a Free user batch-generates from a chapter with Ollama configured
- **THEN** the full multi-form, deduplicated preview flow works
