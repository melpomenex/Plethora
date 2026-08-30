## Purpose

Defines reliable, honest behavior for streaming downloads of Hugging Face-managed model artifacts (e.g. the local Nemotron ASR GGUF): progress that never moves backwards, retries that resume instead of restarting, timeouts that tolerate large files on slow connections, human-readable failure messages, and guaranteed terminal events so the UI never shows stale download state.

## ADDED Requirements

### Requirement: Download progress SHALL be monotonic
For a single artifact download, the percentage reported to the UI SHALL be monotonically non-decreasing from the first event to completion, regardless of retries, reconnects, or resume attempts. A retry or resumed range request SHALL NOT re-emit a lower cumulative percentage for the same install id and file.

#### Scenario: Progress never jumps backwards on retry
- **WHEN** a mid-stream failure occurs at 60% and the downloader retries (resuming from disk or re-requesting)
- **THEN** all subsequent progress events for that file SHALL report a cumulative received-byte count and percentage greater than or equal to the last emitted value before the failure

#### Scenario: Unknown total reports bytes, not a fake percent
- **WHEN** the server provides no content length and no size hint is known
- **THEN** progress events SHALL report bytes received (with total 0 / percent 0 or omitted-by-consumer semantics) instead of oscillating percentages, and the UI SHALL display bytes downloaded rather than a misleading percentage

### Requirement: Retries SHALL resume from bytes already on disk
When a download attempt fails mid-stream and the partial file still exists, the next retry SHALL send an HTTP `Range: bytes=<received>-` request to continue from the received offset when the server supports ranges, instead of restarting from byte zero. If the server does not support range resume (returns 200 instead of 206), the downloader MAY restart from zero but SHALL still keep the reported progress monotonic per the requirement above. Partial data SHALL only be reused when its length matches the recorded received offset; on any mismatch the download SHALL restart from zero.

#### Scenario: Mid-stream failure resumes via Range
- **WHEN** the connection drops after 300 MB of a 495 MB file and the server supports byte ranges
- **THEN** the retry SHALL issue `Range: bytes=314572800-`, continue appending to the existing partial file, and complete the download without re-downloading the first 300 MB

#### Scenario: Server ignores Range
- **WHEN** the retry sends a Range request and the server responds 200 with the full body
- **THEN** the downloader SHALL discard the stale partial, restart cleanly, and still never emit a lower cumulative progress value than the previous attempt's high-water mark

#### Scenario: Integrity still verified after resume
- **WHEN** a download completes across multiple resumed segments
- **THEN** the SHA-256 of the final assembled file SHALL still be verified against the pinned hash and SHALL fail closed on mismatch

### Requirement: Download timeouts SHALL tolerate large files
The HTTP client used to stream artifact bodies SHALL NOT impose a total-request deadline that the body cannot satisfy. It SHALL instead bound connection establishment and per-read inactivity (idle) durations. Slow-but-actively-streaming downloads of multi-hundred-MB artifacts SHALL be allowed to run to completion; only stalled connections (no bytes within the inactivity window) or unreachable servers SHALL time out.

#### Scenario: Slow connection completes
- **WHEN** a 495 MB artifact streams at a rate that would take several minutes, with data arriving continuously
- **THEN** the download SHALL NOT be aborted by a client-side total timeout and SHALL complete without progress resets

#### Scenario: Stalled connection times out and retries
- **WHEN** the server stops sending bytes for longer than the inactivity window
- **THEN** the attempt SHALL abort, the failure SHALL be retried with resume, and the user SHALL see the connection-stalled reason rather than a decoder error

### Requirement: Failures SHALL be reported in human-readable form
Download and install failures surfaced to the user SHALL be described by a human-readable cause (e.g. connection lost, server closed the stream early, timed out waiting for data, HTTP status with URL, disk full/write error, integrity mismatch) with the underlying transport detail appended for diagnosis. Raw transport-library error strings (such as `error decoding response body`) SHALL NOT be the primary user-facing message.

#### Scenario: Mid-stream abort message
- **WHEN** the server resets the connection partway through the body and all retries are exhausted
- **THEN** the error shown to the user SHALL lead with a readable cause like "download failed: connection lost after retries" and include the underlying detail for support, without an unexplained `error decoding response body` as the headline

#### Scenario: Non-JSON metadata response
- **WHEN** a repository-metadata request receives a non-JSON response (e.g. an HTML block or proxy error page)
- **THEN** the system SHALL report a descriptive error (unexpected response from Hugging Face API) rather than a body-decoding error

### Requirement: Install failure SHALL emit a terminal event
When an install fails for any reason (download failure after retries, integrity mismatch, verification failure), the backend SHALL emit the install-finished event for that install id with a failure flag and the readable error message, in addition to returning the error from the command. Success, cancellation, and failure SHALL each leave the UI with no stale "installing" or in-progress state for that id.

#### Scenario: Failed install clears UI state
- **WHEN** a model install fails after retries
- **THEN** an install-finished event with ok=false SHALL be emitted, and the model-manager and transcription settings progress state for that id SHALL be cleared so no phantom in-progress row or bar remains

#### Scenario: Cancelled install cleans up
- **WHEN** the user cancels a download
- **THEN** partial files SHALL be removed, no success SHALL be recorded, and UI progress state for that id SHALL be cleared

### Requirement: Concurrent duplicate installs SHALL be rejected
While an install for a given model identity (repo + revision + runtime, including pinned logical ids) is in flight, a second install request for the same identity SHALL be rejected with a clear "already downloading" error instead of starting a parallel download that interleaves progress under the same key.

#### Scenario: Second click while installing
- **WHEN** the user triggers download for a model that is currently downloading and clicks download again (from either the transcription settings or the HF model manager surface)
- **THEN** the second request SHALL fail fast with an "already in progress" error and SHALL NOT spawn a second concurrent download or reset the visible progress
