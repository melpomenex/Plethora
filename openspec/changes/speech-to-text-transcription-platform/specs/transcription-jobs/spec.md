## ADDED Requirements

### Requirement: Resumable long-form transcription jobs
The system SHALL persist transcription job state including status, provider, processed duration, total duration, segment completion count, and timestamps so jobs can resume after interruption.

#### Scenario: App closes during lecture transcription
- **WHEN** the application closes while a two-hour transcription job is 40% complete
- **THEN** reopening the application SHALL resume transcription near the last persisted checkpoint without restarting from the beginning

#### Scenario: Network disconnect during cloud job
- **WHEN** internet connectivity is lost during an in-progress cloud transcription job
- **THEN** the job SHALL pause or retry rather than discard completed segments

### Requirement: Chunked processing without unbounded memory
The system SHALL process long audio using streamed or chunked decode and transcription so multi-hour recordings are never fully loaded into memory at once.

#### Scenario: Ten-hour audiobook transcription
- **WHEN** the user transcribes a ten-hour audio file
- **THEN** the system SHALL process the file in chunks, persist completed segments, and maintain bounded memory usage throughout

### Requirement: Job progress reporting
Long-running transcription jobs SHALL expose meaningful progress including elapsed/total duration, percentage complete, and optional estimated cost for BYOK users.

#### Scenario: User views in-progress lecture job
- **WHEN** a transcription job is processing
- **THEN** the UI SHALL display progress such as elapsed time, total duration, and percentage complete

### Requirement: Background job survival
Transcription jobs SHALL continue while the user navigates elsewhere in the application and SHALL survive navigation and application restart where platform policy permits.

#### Scenario: User navigates away during transcription
- **WHEN** a desktop user starts transcription and opens another document
- **THEN** the transcription job SHALL continue in the background and update progress until completion or failure

### Requirement: Job cancellation
Users SHALL be able to cancel in-progress transcription jobs, and cancelled jobs SHALL not leave partial durable transcript state marked as completed.

#### Scenario: User cancels long job
- **WHEN** the user cancels an in-progress transcription job
- **THEN** the job status SHALL become cancelled and further provider requests for that job SHALL stop
