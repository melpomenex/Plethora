## ADDED Requirements

### Requirement: On-device results warm the shared cache

Clients that resolve a transcript on-device SHALL upload the resulting segments to the transcript service cache, so that clients which cannot fetch on-device — notably the mobile PWA — are served from cache instead of waking the Mac mini worker.

#### Scenario: Native client contributes to the shared cache

- **WHEN** a native mobile or desktop client resolves a transcript on-device for a video absent from the service cache, and a transcript service with credentials is configured
- **THEN** the client uploads the video ID, language, and segments to the service cache

#### Scenario: PWA benefits from the warm cache

- **WHEN** the mobile PWA requests a transcript for a video previously uploaded by a native client
- **THEN** the service returns the cached transcript without queueing a job for the home worker

#### Scenario: Upload never blocks the user

- **WHEN** the cache upload fails or is slow
- **THEN** the transcript is still displayed to the user and the failure is recorded in diagnostics only

#### Scenario: Uploads are rejected without credentials

- **WHEN** an upload arrives at the service without a valid API key
- **THEN** the service rejects it and does not write to the cache

### Requirement: Cache entries are validated before acceptance

The transcript service SHALL validate uploaded transcripts before caching them, rejecting payloads whose video ID is malformed, whose segment list is empty, or whose segments do not conform to the `{ text, start, duration }` shape.

#### Scenario: Malformed upload rejected

- **WHEN** an upload contains segments missing `start` or `duration`
- **THEN** the service rejects the upload with a client error and leaves any existing cache entry unchanged

#### Scenario: Existing entry not overwritten by a shorter one

- **WHEN** an upload arrives for a video already cached, and the uploaded transcript has fewer segments than the cached one
- **THEN** the cached entry is retained

### Requirement: Relay health is distinguishable from content failure

The hosted API SHALL report relay availability separately from per-video outcomes, and clients SHALL surface "the transcript service is unreachable" distinctly from "this video has no captions".

#### Scenario: Home worker is offline

- **WHEN** the VPS cannot reach the home worker and the video is not cached
- **THEN** the API responds with an error code identifying relay unavailability, not a no-captions code

#### Scenario: Client message reflects the cause

- **WHEN** the client receives a relay-unavailability code
- **THEN** the user sees a message stating the transcript service is temporarily unavailable and that they can retry, rather than a message claiming the video lacks captions

#### Scenario: Status endpoint reports worker liveness

- **WHEN** the transcript service status endpoint is queried
- **THEN** the response reports whether a home worker has polled within the liveness window, alongside the existing proxy and cache fields

### Requirement: Transcript diagnostics surface

Integration settings SHALL present a transcript diagnostics panel reporting: whether the on-device fetcher is available and enabled on this platform, the source and duration of the most recent transcript resolution, and the reachability of the configured transcript service.

#### Scenario: User inspects why a transcript failed

- **WHEN** a transcript request fails and the user opens the diagnostics panel
- **THEN** the panel lists each source attempted, in order, with its outcome

#### Scenario: User tests service connectivity

- **WHEN** the user triggers a connectivity test for the configured transcript service
- **THEN** the panel reports reachability, whether the API key was accepted, and whether a home worker is currently live

#### Scenario: Platform capability shown

- **WHEN** the diagnostics panel is opened in a browser PWA
- **THEN** it states that on-device fetching is unavailable in the browser and that requests are served by the transcript service
