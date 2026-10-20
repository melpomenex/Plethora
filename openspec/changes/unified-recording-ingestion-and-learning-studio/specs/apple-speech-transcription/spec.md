## MODIFIED Requirements

### Requirement: Optional AI post-processing
The system SHALL NOT automatically run expensive title/summary/tag/card generation on every transcript. Optional actions SHALL use existing shared AI task infrastructure with untrusted containment. An explicit per-session processing selection or applicable preserved global preference SHALL authorize the chosen enrichment stages, subject to provider/privacy consent; neither SHALL authorize activating generated cards without acceptance.

#### Scenario: User requests summary after complete
- **WHEN** transcript status is `completed` and the user invokes summarize
- **THEN** the existing shared summarize/task infrastructure runs on bounded source content wrapped as untrusted source
- **AND** no Apple-only summarize API is introduced

#### Scenario: Default completion
- **WHEN** a lecture or file job completes with no explicit session enrichment selection or applicable global preference
- **THEN** no learning generation or smart-tagging job starts

#### Scenario: Previously selected session enrichment
- **WHEN** an Apple recording finishes and the user already selected Prepare study suggestions for that session
- **THEN** the same bounded analysis pipeline as imported media runs subject to current privacy/provider authorization
- **AND** generated cards remain drafts until accepted

## ADDED Requirements

### Requirement: Apple recording joins shared durable sessions
Apple lecture capture SHALL persist audio independently of live speech and use the same canonical session/transcript/source contracts as imported and other-platform media. Live speech failure SHALL NOT destroy captured audio. On-device claims SHALL require actual local recognition eligibility, not merely a framework label.

#### Scenario: Apple speech unavailable
- **WHEN** an Apple user records audio but native speech cannot execute
- **THEN** saved audio remains accessible in the shared session with an actionable transcription state and no undisclosed remote fallback
