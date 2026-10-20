## ADDED Requirements

### Requirement: Feature operational evidence in AI Diagnostics

The existing AI Diagnostics interface SHALL show per-feature enabled state, required dependencies, available provider/backend, model readiness, last known success and error, operational readiness and recommended recovery. It SHALL cover Learn this, Ask Library, Socratic Tutoring, Image Occlusion Assist, Semantic Indexing, Answer Assessment, Knowledge Relationships, Extract-Worthiness, Learning Agent and Active Recall. Static validation, live dependency checks and bounded operational execution SHALL remain explicitly distinct.

#### Scenario: Compiled without model execution
- **WHEN** a schema adapter exists but no model execution has been observed
- **THEN** diagnostics shows static/dependency evidence only and does not label the workflow operational

#### Scenario: Generation succeeds but save fails
- **WHEN** generation succeeds and the subsequent approved save fails
- **THEN** diagnostics distinguishes those stages and shows persistence recovery rather than overall success

#### Scenario: Model changes or app restarts
- **WHEN** the provider/model revision changes or session-local history is lost on restart
- **THEN** prior evidence is marked stale or unknown rather than presented as current success

### Requirement: Explicit bounded fixture smoke tests

Operational smoke tests SHALL use controlled non-personal fixtures through production feature orchestration. The user SHALL explicitly start each selected bounded run and approve applicable remote/billing processing. Opening, refreshing or exporting diagnostics SHALL NOT initiate inference, downloads, indexing or personal-library queries. A smoke result SHALL state which real and fixture-backed stages were exercised; untested storage/navigation stages SHALL remain unverified.

#### Scenario: Successful selected smoke
- **WHEN** the user starts one available fixture test and grants required authorization
- **THEN** it executes within its declared bounds and displays stage-scoped outcome, duration and actual route

#### Scenario: No production adapter or hardware
- **WHEN** a selected feature lacks a production smoke adapter or available native model
- **THEN** the result reports that limitation and never substitutes a compile/mock result as an operational pass

#### Scenario: Personal library remains untouched
- **WHEN** any in-app smoke test runs
- **THEN** it uses no personal document and creates no durable user learning object, rating, relationship or index backfill

#### Scenario: Consent denied or test cancelled
- **WHEN** the user declines remote processing or cancels a running smoke test
- **THEN** further work stops, late results are ignored, no fallback occurs and the result is not passed

### Requirement: Privacy-safe feature observation and redacted reports

Feature observations SHALL correlate workflow stages using safe identifiers, duration metrics, outcome categories and recovery codes in the existing diagnostic infrastructure. Exported reports SHALL contain no private document/source identifiers or content, credentials, endpoints, raw prompts/completions, arbitrary model/provider strings, raw exceptions or image data. Export SHALL be explicit, bounded and local to the user.

#### Scenario: Malicious or sensitive diagnostic values
- **WHEN** a provider or error includes credentials, paths, content canaries or HTML in arbitrary string fields
- **THEN** the exported object retains only mapped safe categories and none of those sensitive values

#### Scenario: Bounded report export
- **WHEN** the user exports many recent diagnostic events
- **THEN** the report identifies its scope/version and any truncation without uploading anything

### Requirement: Actionable diagnostic recovery

Each unavailable, degraded or failed dependency SHALL point to a relevant existing recovery destination where one exists. Recovery navigation and Settings search SHALL remain accessible and SHALL NOT authorize or start setup operations.

#### Scenario: Missing embedding model
- **WHEN** indexing diagnostics identifies an absent embedding model
- **THEN** recovery opens the appropriate existing setup controls with an explanation and leaves download authorization to the user

#### Scenario: Search opens smoke controls
- **WHEN** the user finds smoke diagnostics through Settings search
- **THEN** the controls are revealed without running a smoke test or changing preferences
