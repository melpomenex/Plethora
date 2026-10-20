## ADDED Requirements

### Requirement: Session dispatch honors actual provider and authorization
Session jobs SHALL use shared configured provider/model resolution, durable job identity and executable capability checks. Remote dispatch SHALL require valid audio authorization and current privacy policy even if no interactive disclosure presenter exists. Unsupported selections SHALL yield a remedy without silent remote substitution.

#### Scenario: Offline local unavailable
- **WHEN** local-only transcription is selected but the local engine is unavailable and cloud credentials exist
- **THEN** the job is blocked with local setup options and no audio leaves the device

#### Scenario: Worker starts without disclosure UI
- **WHEN** a remote job has no valid recorded authorization and no presenter is available
- **THEN** it waits for consent and performs no upload

### Requirement: Atomic committed-unit checkpointing
Each finished session transcription unit SHALL commit its segments and processed position together. A failed write SHALL NOT be acknowledged as success. Retry/restart SHALL reuse committed units without duplicating source segments or downstream learning drafts.

#### Scenario: Checkpoint write failure
- **WHEN** the segment transaction fails
- **THEN** processed position remains at the prior committed unit and retry replays the failed unit safely

#### Scenario: Retry after crash
- **WHEN** an interrupted session job resumes
- **THEN** committed segment keys are retained once and only unfinished units are processed

### Requirement: Single execution and effective cancellation
A session job SHALL have at most one active executor. Cancellation SHALL stop new work, abort eligible in-flight processing and reject stale completion/writes while preserving media/committed text. Restricted background execution SHALL checkpoint/pause safely rather than imply continued work.

#### Scenario: Cancel with late response
- **WHEN** a provider response arrives after cancellation
- **THEN** the cancelled job is not marked completed and no new segments or drafts from that response are committed

#### Scenario: Two windows claim a job
- **WHEN** two controllers attempt to resume the same job
- **THEN** only one executes it and the other observes the shared status

### Requirement: Measured session progress
Progress SHALL identify job/session and actual executing provider/model, report committed work and use a percentage only when a valid total is known. Stage failures SHALL preserve successful prior stages.

#### Scenario: Unknown duration
- **WHEN** media preparation cannot determine duration
- **THEN** progress remains indeterminate with a stage description instead of a fabricated percentage
