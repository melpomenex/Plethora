## ADDED Requirements

### Requirement: Socratic tutoring mode

The system SHALL provide a tutoring mode built on guided questioning rather than immediate
answers, clearly distinct from normal Q&A, invocable on selections, sections, or concepts.

#### Scenario: Tutor opens with a guiding question
- **WHEN** a user starts tutoring on a concept (e.g. eigenvectors)
- **THEN** the tutor opens with a guiding question referencing the material rather than a
  definition

### Requirement: Responsive tutoring with bounded context

Tutor turns SHALL respond to the user's answers rather than following a fixed script, using a
bounded conversational context (recent turns plus a distilled topic summary) grounded in the
current material and retrieved prerequisites.

#### Scenario: Answer shapes the next move
- **WHEN** the user gives a partially correct response
- **THEN** the next tutor turn addresses the specific gap instead of advancing a canned
  sequence

#### Scenario: Context stays bounded
- **WHEN** a tutoring session runs long
- **THEN** the model context remains within budget by summarizing older turns rather than
  accumulating the full transcript

### Requirement: Progressive hints, stuck detection, and escape hatch

The tutor SHALL detect when the learner is stuck, provide progressively stronger hints
(bounded levels), eventually provide a direct explanation, and always offer a "just explain
it" escape hatch. The tutor SHALL NOT question endlessly.

#### Scenario: Stuck learner gets escalating help
- **WHEN** the user fails to progress across consecutive turns
- **THEN** hint strength increases and after the bounded hint levels a direct explanation is
  provided

#### Scenario: Escape hatch
- **WHEN** the user taps "just explain it" at any point
- **THEN** the tutor provides a direct grounded explanation immediately

### Requirement: Task-policy routing with graceful fallback

Tutoring SHALL route to the reasoning model class when available (with automatic fallback to
the full class when it is not), per the shared task policy.

#### Scenario: No reasoning capability
- **WHEN** no reasoning-capable provider exists
- **THEN** tutoring proceeds on the full model class without user-visible failure

### Requirement: Grounding and learning-object conversion

Tutor turns SHALL be grounded in the user's material and retrieved library context, and a
session SHALL be able to end by converting the tutored concept into validated card candidates
via the standard preview flow.

#### Scenario: Card from tutoring
- **WHEN** a user chooses to create a card from a tutoring session outcome
- **THEN** candidates open in the preview/edit/accept flow with provenance linking back to
  the source material
