## MODIFIED Requirements

### Requirement: Responsive tutoring with bounded context

Tutor turns SHALL respond to learner answers using bounded recent turns and a distilled topic summary. Existing material-based tutoring SHALL continue grounding in current material and retrieved prerequisites. Study Plan tutoring SHALL use the pinned plan authority and current eligible references, with no global fallback on an empty or invalid scope. AI Knowledge Only SHALL use no library retrieval and SHALL label generated teaching unverified.

#### Scenario: Answer shapes the next move
- **WHEN** the user gives a partially correct response
- **THEN** the next tutor turn addresses the specific gap instead of advancing a canned sequence

#### Scenario: Context stays bounded
- **WHEN** a tutoring session runs long
- **THEN** the model context remains within budget by summarizing older turns rather than accumulating the full transcript

#### Scenario: Model-only tutor has no library context
- **WHEN** a learner resumes an AI Knowledge Only lesson with a populated library
- **THEN** the tutor uses only authorized lesson context and makes no library retrieval request

### Requirement: Grounding and learning-object conversion

Existing material-based tutors SHALL remain grounded in the user's material and retrieved library context. Study Plan turns, explanations and hints SHALL instead apply the pinned policy: validate exact library support, label permitted supplements or unverified output, and make missing support actionable. An eligible session SHALL support standard preview/edit/accept conversion into validated card candidates carrying available provenance. Tutor turns and card proposals alone SHALL NOT write grades, demonstrated evidence or scheduler ratings.

#### Scenario: Card from tutoring
- **WHEN** a user chooses to create a card from a tutoring session outcome
- **THEN** candidates open in the preview/edit/accept flow with provenance linking back to the source material where available

#### Scenario: Out-of-syllabus question
- **WHEN** a learner requests a fact outside the selected scope in Library Only
- **THEN** the tutor identifies missing support and offers to find material or review a policy change without answering as if the fact were sourced
