## ADDED Requirements

### Requirement: Uniform job lifecycle API
Cloud work SHALL be submitted via `POST /v1/jobs {kind, params, idempotency_key?}` returning `202 {job_id}`, observed via `GET /v1/jobs/:id` (status, progress, result, normalized error), cancelled via `DELETE /v1/jobs/:id`, and resynced via `GET /v1/jobs?since=`. Job status SHALL be one of `queued|running|succeeded|failed|cancelled`. Progress SHALL be optional `{current, total, unit}`.

#### Scenario: Submit and observe a reference job
- **WHEN** an authenticated Pro user submits a valid job of a registered kind
- **THEN** it transitions queued→running→succeeded with progress updates visible via polling or SSE

#### Scenario: Idempotent resubmission
- **WHEN** the same idempotency key is submitted twice
- **THEN** the second call returns the original job without duplicate execution

### Requirement: Jobs retry with bounds and recover from crashes
The framework SHALL retry failed jobs with exponential backoff + jitter up to a per-kind `max_attempts`, enforce per-kind timeouts, and recover orphaned jobs (worker crash) via lock expiry. Cancellation SHALL be checkpointed: long-running handlers SHALL observe cancel requests at defined intervals and stop promptly.

#### Scenario: Worker crash mid-job
- **WHEN** a worker dies while holding a job lock
- **THEN** the lock expires and the job is retried or failed per remaining attempts, never stuck in `running` forever

#### Scenario: Backoff is jittered and bounded
- **WHEN** a job fails repeatedly
- **THEN** retry delays grow exponentially with jitter and stop after max_attempts with a terminal failed state

### Requirement: Feature job kinds register into the framework
Each cloud feature (document reconstruction, TTS generation, transcription, embedding batches, capture, export) SHALL register a kind (zod-validated params, timeout, attempts, concurrency, quota binding, handler) with the shared registry instead of building bespoke queueing. The framework SHALL own validation, authz, quota pre-flight, metering, and storage of artifacts (object storage refs, not DB blobs).

#### Scenario: New kind requires no framework changes
- **WHEN** a feature proposal adds a job kind with standard needs
- **THEN** it registers via the plugin interface and inherits retries/quotas/observability without modifying core routes

### Requirement: Errors use a stable envelope
All `/v1/*` endpoints SHALL return errors as `{ error: { code, message, retryable, retryAfter? } }` with the documented stable code set. Clients SHALL map `quota_exceeded`/`rate_limited`/`provider_unavailable` to the corresponding capability reasons without parsing prose.

#### Scenario: Quota rejection is machine-readable
- **WHEN** a job submission exceeds the capability envelope
- **THEN** the response is `429` with `code: "quota_exceeded"`, `retryAfter` aligned to window reset, and quota headers present

### Requirement: Provider abstraction prevents vendor lock-in
Server-side AI/compute vendors SHALL sit behind a `ProviderRegistry` (credentials by env, per-call cost accounting, timeouts, circuit breakers on consecutive failures). Domain/job code SHALL address provider classes, not vendors; adding or swapping a vendor SHALL require registration/config only.

#### Scenario: Circuit breaker opens on provider outage
- **WHEN** a provider fails consecutively beyond threshold
- **THEN** its circuit opens, dependent jobs fail fast with `provider_unavailable` (retryable), and health state is observable

### Requirement: Cost controls are structural
Per-account daily cost ceilings and per-kind global budget guards SHALL be enforced (hard stop + alert) regardless of quota configuration. Started work follows the per-capability grace policy; no configuration SHALL allow unbounded compute spend.

#### Scenario: Daily ceiling trips
- **WHEN** an account's metered cost crosses its daily ceiling
- **THEN** further billable job submissions are rejected until reset and an alert event is emitted
