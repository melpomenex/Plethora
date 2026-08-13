## Purpose

Defines how the transcription provider and model configured in Settings → Audio Transcription are resolved, routed to the execution engine, and reported back to the user, so that the engine actually running a transcription always matches the user's selection and is always named truthfully in the interface.

## ADDED Requirements

### Requirement: Single Effective Provider and Model Resolution

The system SHALL derive a single effective `{ provider, modelId }` pair from the persisted audio transcription settings and the current platform, and every transcription entry point SHALL use that pair. No entry point SHALL derive a provider or model by independent means.

Entry points covered: the audiobook transcript panel, the podcast transcript panel, the podcast manager episode list, the documents list context menu, and the Settings → "Transcribe All" action.

#### Scenario: Provider is local with an installed model

- **WHEN** the user has selected the local provider with `parakeet-tdt-ctc-110m` as the preferred model, that model is installed, and the user starts a transcription from any entry point
- **THEN** the effective provider SHALL be local and the effective model SHALL be `parakeet-tdt-ctc-110m`
- **AND** the transcription SHALL execute on the local engine using that model

#### Scenario: Two entry points agree on the same resolution

- **WHEN** the same document is transcribed from the documents list and from the audiobook transcript panel under identical settings
- **THEN** both SHALL resolve to the same provider and the same model id

#### Scenario: Provider is Groq

- **WHEN** the user has selected the Groq provider and a configured Groq model, and starts a transcription from any entry point
- **THEN** the effective provider SHALL be Groq and the effective model SHALL be the configured Groq model
- **AND** the request SHALL be routed to the cloud transcription path, never to the local transcription queue

### Requirement: Reported Engine Matches Executing Engine

Every user-visible string that names a transcription engine — in-progress status text, action button labels, tooltips, helper text, and toasts — SHALL name the provider and model resolved for that specific job. The system SHALL NOT display a fixed engine name independent of the resolved provider.

#### Scenario: Local Parakeet job reports Parakeet

- **WHEN** a transcription is running with the local provider and the `parakeet-tdt-ctc-110m` model
- **THEN** the in-progress panel SHALL name the local provider and the Parakeet model
- **AND** SHALL NOT mention Groq or any cloud provider

#### Scenario: Groq job reports Groq

- **WHEN** a transcription is running with the Groq provider
- **THEN** the in-progress panel SHALL name Groq and the configured Groq model
- **AND** SHALL NOT describe the work as local or offline

#### Scenario: Idle call-to-action names the configured engine

- **WHEN** no transcript exists for an audiobook or podcast episode and the transcribe action is offered
- **THEN** the action label and any accompanying helper text SHALL name the currently configured provider and model
- **AND** SHALL change to match if the user changes the setting and returns to the view

#### Scenario: Podcast episode row tooltip reflects settings

- **WHEN** the user hovers the transcribe control on a podcast episode row with the local provider and Parakeet selected
- **THEN** the tooltip SHALL name Parakeet
- **AND** SHALL NOT read "Transcribe with Whisper"

### Requirement: Groq Work Is Never Routed to the Local Queue

When the effective provider is Groq, the system SHALL route the request to the cloud transcription path. It SHALL NOT create an entry in the local auto-transcription queue, and SHALL NOT substitute a placeholder or cloud model id into a queue entry that the local worker will attempt to resolve as a local model file.

#### Scenario: Transcribing from the documents list with Groq selected

- **WHEN** the user has the Groq provider selected and triggers Transcribe on an audio document from the documents list
- **THEN** the request SHALL be handled by the cloud transcription path
- **AND** no local queue entry SHALL be created with a model id that does not correspond to an installed local model
- **AND** the user SHALL NOT see a "Transcription model not found" failure

#### Scenario: Transcribe All with Groq selected

- **WHEN** the user has the Groq provider selected and triggers "Transcribe All" from Settings → Audio Transcription
- **THEN** every enqueued item SHALL be routed to the cloud transcription path
- **AND** no item SHALL fail because a Groq model id was resolved as a local model file path

### Requirement: Local Queue Honors the Recorded Provider

The local auto-transcription worker SHALL read the provider recorded on each queue entry before executing it. An entry whose provider the worker cannot execute SHALL be failed with an error message that names the provider mismatch, rather than being attempted as a local model lookup.

#### Scenario: Worker encounters a non-local entry

- **WHEN** the local transcription worker dequeues an entry whose recorded provider is not local
- **THEN** the worker SHALL fail that entry with an error naming the provider mismatch
- **AND** SHALL NOT attempt to resolve the entry's model id as a local model file
- **AND** SHALL continue processing subsequent entries in the queue

### Requirement: Configured Model Is Honored for Podcasts

Podcast transcription SHALL execute with the effective model resolved from settings. The backend SHALL NOT substitute a model chosen by installation order or an unconditional built-in default for a user-initiated podcast transcription.

#### Scenario: Podcast transcribed with the selected model

- **WHEN** the user has Parakeet selected and installed and transcribes a podcast episode
- **THEN** the transcription SHALL execute with Parakeet
- **AND** SHALL NOT fall back to a different installed model or to a built-in default

#### Scenario: Two models installed, one selected

- **WHEN** both a Whisper model and Parakeet are installed, Parakeet is the user's selection, and a podcast episode is transcribed
- **THEN** Parakeet SHALL be used regardless of which model appears first in the model catalog

### Requirement: Background Transcription Honors the Configured Settings

Automatic transcription started without direct user action — podcast feed auto-transcribe and the idle scanner — SHALL use the configured provider, model, and language rather than an independently chosen default or an internal model ranking.

#### Scenario: Feed auto-transcribe uses the configured model

- **WHEN** a podcast feed with auto-transcribe enabled refreshes and finds untranscribed episodes, and the user's configured model is Parakeet
- **THEN** those episodes SHALL be transcribed with Parakeet
- **AND** SHALL NOT be transcribed with an unconditional built-in default model

#### Scenario: Idle scanner uses the configured model

- **WHEN** the idle scanner enqueues untranscribed media and the user's configured model is installed
- **THEN** the enqueued entries SHALL carry the user's configured model
- **AND** SHALL NOT carry a model selected by the scanner's own preference ranking

#### Scenario: Configured model unavailable to a background flow

- **WHEN** a background flow runs and the user's configured model is not installed
- **THEN** the flow SHALL NOT silently substitute another model
- **AND** the affected item SHALL be recorded as failed with an error naming the missing model

### Requirement: Unrunnable Selection Fails Explicitly

When the effective provider or model cannot execute, the system SHALL fail the request with a message that names the specific blocker and the corrective action. The system SHALL NOT silently substitute a different provider or a different model.

#### Scenario: Groq selected without an API key

- **WHEN** the user has the Groq provider selected, no Groq API key is configured, and a transcription is started
- **THEN** the system SHALL report that a Groq API key is required and where to add it
- **AND** SHALL NOT fall back to local transcription

#### Scenario: Local model not downloaded

- **WHEN** the user has the local provider selected with Parakeet as the preferred model, Parakeet is not installed, and a transcription is started
- **THEN** the system SHALL report that the selected model is not downloaded, naming that model, and offer to download it
- **AND** SHALL NOT transcribe with a different installed model
- **AND** SHALL NOT fall back to the cloud provider

#### Scenario: Local model not downloaded and no model installed at all

- **WHEN** the user has the local provider selected and no local model is installed
- **THEN** the system SHALL report that the selected model is not downloaded and offer to download it
- **AND** SHALL NOT report a generic failure that omits which model is missing

### Requirement: Preferred Model Setting Reflects Installation State

The preferred model setting SHALL be reconciled against installed models, not merely against the catalog of known models. A preferred model that exists in the catalog but is not installed SHALL be surfaced to the user as not ready.

#### Scenario: Preferred model is in the catalog but not installed

- **WHEN** the preferred model is set to a catalog entry that has never been downloaded, and at least one other model is installed
- **THEN** the settings view SHALL indicate that the preferred model is not installed and SHALL offer to download it
- **AND** SHALL NOT present the selection as ready to use

### Requirement: Platform Substitution Is Disclosed

On platforms where the local transcription engine cannot run, the system MAY route to the cloud provider despite a local selection, and SHALL state in the interface that this substitution is in effect rather than presenting the cloud provider as the user's selection.

#### Scenario: Native mobile with local selected

- **WHEN** the app runs on native mobile, the user's stored provider is local, and a transcription is started
- **THEN** the request SHALL be routed to the cloud provider
- **AND** the interface SHALL state that local transcription is unavailable on this platform and that the cloud provider is being used instead

#### Scenario: Native mobile without an API key

- **WHEN** the app runs on native mobile with a local provider selected and no Groq API key configured
- **THEN** the system SHALL report that a Groq API key is required because local transcription is unavailable on mobile
- **AND** SHALL direct the user to where the key is configured

### Requirement: Interrupted Audiobook Transcription Is Resumable

The system SHALL persist audiobook transcription checkpoints and the job metadata needed to continue an incomplete transcript after the app restarts. Resuming SHALL preserve all previously persisted segments and SHALL continue at the last persisted transcript timestamp rather than restarting from the beginning.

#### Scenario: App restarts during a long local transcription

- **WHEN** a local audiobook transcription has persisted segments through 2 hours 30 minutes and the app restarts
- **THEN** the interrupted queue entry SHALL become runnable again on startup
- **AND** transcription SHALL continue at the last persisted timestamp
- **AND** the previously persisted 2 hours 30 minutes of transcript SHALL remain available
- **AND** completed audio before that checkpoint SHALL NOT be transcribed again

#### Scenario: Existing partial transcript came from the legacy in-memory queue

- **WHEN** transcript segments exist with a non-completed status but no persisted queue entry exists
- **THEN** the viewer SHALL identify the transcript as partial
- **AND** SHALL offer a "Continue transcription" action
- **AND** activating it SHALL enqueue the same document and chapter while preserving the existing segments

#### Scenario: Partial transcript is visible

- **WHEN** an audiobook has one or more transcript segments and its transcript status is not `completed`
- **THEN** the transcript text SHALL remain readable
- **AND** the viewer SHALL display that the transcript is incomplete
- **AND** the continue action SHALL name the configured provider and model

#### Scenario: Cloud audiobook transcription is resumed

- **WHEN** Groq audiobook transcription is started again for a transcript with persisted segments
- **THEN** chunks entirely before the last persisted timestamp SHALL be skipped
- **AND** final document text SHALL be assembled from both the old and newly persisted segments

### Requirement: Assistant Can Focus Transcript-Backed Media Sections

When an audiobook or podcast provides chapter metadata and timestamped transcript segments, the system SHALL expose transcript-backed chapters through the Assistant's `#` section picker. Selecting a chapter SHALL scope the LLM context to transcript text overlapping that chapter's time range, and SHALL preserve access to the Assistant's normal question answering and flashcard tools.

#### Scenario: Audiobook chapter appears in the section picker

- **WHEN** an audiobook has a chapter named "The First Principle" from 30:00 to 52:00 and transcript segments overlap that range
- **AND** the user types `#` in the Assistant while viewing the audiobook
- **THEN** "The First Principle" SHALL appear in the section picker
- **AND** its preview SHALL be derived from the transcript in that time range

#### Scenario: User asks a chapter-scoped question

- **WHEN** the user selects `#The First Principle` and asks a question
- **THEN** the LLM request context SHALL contain the transcript segments overlapping that chapter
- **AND** SHALL NOT include transcript text exclusively belonging to other chapters, except bounded neighboring context explicitly allowed by the context budget

#### Scenario: User creates flashcards from a chapter

- **WHEN** the user selects a transcript-backed chapter and asks the Assistant to create flashcards
- **THEN** the normal flashcard tool flow SHALL remain available
- **AND** generated cards SHALL be grounded in the selected chapter transcript context

#### Scenario: Chapter has not been transcribed yet

- **WHEN** a partial transcript contains no segment overlapping a later chapter
- **THEN** that chapter SHALL NOT be offered as an attachable transcript section
- **AND** the Assistant SHALL NOT claim to have context for it

#### Scenario: Podcast exposes chapter metadata

- **WHEN** a podcast episode provides chapters and timestamped transcript segments
- **THEN** its transcript-backed chapters SHALL use the same `#` picker and scoped-context behavior as audiobook chapters
