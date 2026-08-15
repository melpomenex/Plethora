## ADDED Requirements

### Requirement: Learn this action

The system SHALL provide a "Learn this" action on selected text and, where sensible, document
sections, gated on generative capability. The action SHALL analyze the content and return a
structured learning-material proposal: importance, knowledge type, concepts, suggested card
candidates, prerequisite concepts, tags, and rationale.

#### Scenario: Learn this on a selection
- **WHEN** a user selects a passage and invokes "Learn this" with AI available
- **THEN** the system classifies the material and returns validated card candidates matched to
  the knowledge type instead of only generic question-answer cards

#### Scenario: Learn this unavailable without capability
- **WHEN** no generative provider is available
- **THEN** the action is not offered as enabled and existing manual card-creation flows are
  unaffected

### Requirement: Knowledge-type-aware card candidates

Card candidates SHALL carry a card type (question-answer, cloze, definition, comparison,
enumeration, process/ordered steps, cause-effect, conceptual formula, application/example,
and image-occlusion reference when an image is involved) chosen by the classified knowledge
type (e.g. definition → definition/basic card, enumeration → cloze or list card, diagram →
occlusion reference, process → ordered-step card, comparison → A-vs-B card, formula →
conceptual card, cause/effect → why-how card, date/event → temporal card, example →
identify/apply card).

#### Scenario: Enumeration produces cloze or list candidates
- **WHEN** the classified knowledge type is an enumeration
- **THEN** proposed candidates include cloze or list-type cards rather than only generic Q/A

#### Scenario: Diagram presence proposes occlusion
- **WHEN** the analyzed content involves an image or diagram and vision plus occlusion support
  is available
- **THEN** the proposal references the image-occlusion flow for that content instead of
  fabricating text-only cards about the diagram

### Requirement: Candidate validation

All candidates SHALL be validated before preview: cloze deletions MUST appear verbatim in the
source passage; answers MUST be grounding-checked against the source; candidates MUST respect
caps (no more than 8 cards per invocation and no more than 2 cards per concept); duplicates
against each other and against existing items MUST be flagged.

#### Scenario: Ungrounded candidate is dropped or flagged
- **WHEN** a generated answer is not grounded in the source passage
- **THEN** the candidate is removed or clearly marked ungrounded and cannot be accepted without
  editing

#### Scenario: Cap enforcement
- **WHEN** the model returns more than 8 card candidates
- **THEN** only the top candidates within the cap are presented, ranked by the proposal's
  importance ordering

### Requirement: Preview, edit, accept, reject, regenerate

The user SHALL preview all candidates before anything is created, edit any candidate, accept
or reject individual candidates, regenerate the proposal, and switch a candidate to an
alternate card type. Accepted candidates SHALL be created through the existing domain services
(learning-item creation, cloze-from-extract, occlusion batch) — never by direct state mutation
from model output.

#### Scenario: Accept a subset
- **WHEN** a user accepts 2 of 5 proposed candidates
- **THEN** exactly the 2 accepted candidates become Incrementum learning items and the
  rejected ones leave no trace

#### Scenario: Regenerate replaces the proposal
- **WHEN** a user chooses to regenerate
- **THEN** a fresh proposal is generated and the previous unaccepted candidates are discarded

### Requirement: Provenance retention

Every accepted AI-generated learning object SHALL retain provenance: source document, source
location, original passage, relevant source image reference, provider/model identity, model
class, and generation timestamp, stored in the AI provenance records.

#### Scenario: Provenance query for an accepted card
- **WHEN** a user inspects an AI-created card's origin
- **THEN** the system can navigate to the source document location and report which
  provider/model produced it and when

### Requirement: No silent mass creation

The system SHALL NOT create learning items without explicit user acceptance. Automated flows
that propose material SHALL end in the same preview-and-approval UX; any future trusted
automation SHALL be a separately gated setting.

#### Scenario: Proposal timeout or failure creates nothing
- **WHEN** the generation request fails, times out, or is cancelled
- **THEN** no learning items, extracts, or links are created
