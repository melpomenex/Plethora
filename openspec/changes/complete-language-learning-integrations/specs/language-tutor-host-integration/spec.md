## ADDED Requirements

### Requirement: Tutor requests SHALL use a bounded learner context packet

Existing tutor and document-assistance entry points SHALL build a profile-scoped `LearnerContextPacket` through the shared context builder before invoking a provider. The packet SHALL be bounded, freshness-aware, source-attributed, and redacted according to the active privacy policy.

#### Scenario: Learner asks a language question from a document
- **WHEN** the learner invokes the tutor from a language-enabled document or selection
- **THEN** the request SHALL include only the bounded source context, relevant lexical evidence, target/base language, profile settings, and source anchors permitted by the privacy policy

#### Scenario: Context exceeds the budget
- **WHEN** the selected document and lexicon evidence exceed the configured context budget
- **THEN** the builder SHALL rank and truncate context deterministically and SHALL identify the source excerpts retained

### Requirement: Existing tutor surfaces SHALL expose language-aware actions

TutorSheet, TutorComposer, document assistance, Language Peek explanations, and writing-practice entry points SHALL reuse the existing tutor/session/provider runtime while supporting language modes for explanation, conversation, correction, source grounding, and target-vocabulary practice.

#### Scenario: Learner opens tutor from a selected sentence
- **WHEN** the learner chooses Explain or Ask Tutor for a selected sentence
- **THEN** the existing tutor surface SHALL open with the sentence, source anchor, profile language, and bounded learner context prefilled without creating a second tutor session

#### Scenario: Learner starts writing practice
- **WHEN** the learner chooses a writing prompt from the tutor or document surface
- **THEN** the tutor SHALL create a shared practice draft with the prompt/source provenance and SHALL preserve the learner's raw text

### Requirement: Tutor output SHALL remain source-grounded and capability-aware

Language tutor responses SHALL distinguish source-backed explanation, provider-generated correction, and uncertain or unavailable content. The UI SHALL expose source references where available and SHALL not fabricate morphology, pronunciation, translation, or learner-state claims.

#### Scenario: Provider lacks a requested capability
- **WHEN** the configured provider cannot supply morphology, translation, or pronunciation feedback for the target language
- **THEN** the tutor SHALL show an unavailable state or offer an available fallback without presenting invented data

#### Scenario: Source context is stale
- **WHEN** the source document or sentence fingerprint no longer matches the selected context
- **THEN** the tutor SHALL reject or refresh the stale context before displaying a source-grounded answer

### Requirement: Tutor provider and privacy states SHALL be explicit

Tutor integrations SHALL honor local, BYO, and cloud provider settings, cancellation, retry, offline behavior, retention, and consent. Cloud requests SHALL not include document or learner data unless the active policy allows the specific request.

#### Scenario: Cloud tutor requires consent
- **WHEN** a language tutor action would send selected text or learner context to a cloud provider without consent
- **THEN** the host SHALL pause before sending and present the provider/privacy choice

#### Scenario: Tutor request is cancelled
- **WHEN** the learner cancels a streaming tutor response
- **THEN** the request SHALL stop, partial output SHALL be labelled incomplete, and no practice evidence or SRS action SHALL be recorded automatically

### Requirement: Writing corrections SHALL require explicit evidence acceptance

Writing feedback SHALL display the learner text separately from minimal corrections, natural alternatives, explanations, categories, confidence, and provenance. Showing feedback alone SHALL not mark vocabulary as successfully produced or reschedule an item.

#### Scenario: Learner accepts a correction
- **WHEN** the learner explicitly accepts or self-assesses a corrected production
- **THEN** the host SHALL offer the shared active-evidence action with the correction/source/provider provenance

#### Scenario: Learner dismisses a correction
- **WHEN** the learner dismisses or edits a suggested correction
- **THEN** the original learner text SHALL remain intact and no active evidence SHALL be recorded unless the learner explicitly accepts it

### Requirement: Tutor integration SHALL preserve existing sessions and accessibility

Language turns SHALL be stored in the existing tutor/session model where persistence is enabled, shall support resume/cancel/retry, and shall remain keyboard, touch, screen-reader, reduced-motion, and e-ink usable.

#### Scenario: Tutor session resumes
- **WHEN** the learner reopens a tutor session containing language context
- **THEN** the session SHALL restore its bounded context metadata and source references without replaying stale full-document content

