# Spec: personalized-language-content-generation

## ADDED Requirements

### Requirement: Profile/interest-constrained request

Generation SHALL accept a target profile/language, topic/interest, length, genre/style, approximate coverage/difficulty, new-word target, repeated Learning vocabulary, and optional grammar/style constraints. Application locale SHALL not select target language implicitly.

#### Scenario: Spanish Roman history
- **WHEN** a user requests a 1,000-word Spanish Roman-history article at Comfortable difficulty
- **THEN** the request uses the Spanish profile and bounded learner-state context while preserving the selected topic

### Requirement: Normal document integration

Generated/adapted material SHALL become a normal Plethora document and SHALL use existing readers, processing, lexicon, coverage, Queue, TTS, analytics, and language mode. It MUST NOT create a parallel lesson/content store.

#### Scenario: Open generated story
- **WHEN** generation completes
- **THEN** the result appears as a document that can be opened, processed, queued, and studied like imported content

### Requirement: Provenance and source honesty

Generated text SHALL be labeled generated; adaptations SHALL retain source document ID/version and be labeled adapted/simplified/harder. The original source MUST remain unchanged and generated text MUST NOT claim to be a quotation.

#### Scenario: Simplify article
- **WHEN** the user chooses Simplify on an existing article
- **THEN** a linked adapted document is created with original attribution and generated provenance, while the source article is untouched

### Requirement: Measured output difficulty

After generation, the same processing/coverage pipeline SHALL measure actual language, lexical coverage, state counts, and difficulty. The UI SHALL distinguish requested targets from measured results and handle pending/failed analysis.

#### Scenario: Target missed
- **WHEN** generated text measures 88% known despite a requested 95%
- **THEN** the result reports actual coverage and offers adjust/regenerate rather than claiming 95%

### Requirement: Controlled learner-state context

Generation SHALL use a compact, relevant, bounded learner-state sample and SHALL not dump the complete lexicon or unrelated source library into prompts by default. Cloud use SHALL be disclosed and controllable.

#### Scenario: Privacy opt-out
- **WHEN** cloud learner-state sharing is disabled
- **THEN** generation uses local/BYO capabilities or reports unavailable without sending the lexicon to a hosted provider

### Requirement: Provider/cost resilience

Local/on-device, BYO, and hosted providers SHALL use existing AI consent/credentials/quotas and support cancellation/retry/partial failure. No provider is required for ordinary reading or existing documents.

#### Scenario: Cancel generation
- **WHEN** the user cancels a streamed request
- **THEN** no incomplete document is silently presented as finished and any temporary artifact is recoverable/cleaned according to existing import policy

### Requirement: Optional TTS and media

Generated text MAY use existing TTS/audio-edition infrastructure, with cache/cost disclosure and original-audio preference irrelevant unless adapting a source that has original media. TTS failure SHALL not invalidate the document.

#### Scenario: TTS unavailable
- **WHEN** generated text imports successfully but TTS is unavailable
- **THEN** the text document remains fully usable and audio is labeled unavailable
