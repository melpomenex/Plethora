## ADDED Requirements

### Requirement: Capability-aware composer dictation
Selection Ask and the global mobile Assistant SHALL provide a microphone control using a shared capability-aware dictation behavior. App-controlled microphone capture SHALL use supported native recognition on native mobile; browser recognition SHALL be a disclosed capability-gated web fallback. Keyboard dictation SHALL remain ordinary text input and SHALL NOT be represented as an app invocation of a specific installed keyboard's dictation service. Opening a composer SHALL NOT start recording or request microphone permission. Unsupported capture SHALL retain typing and readable recovery guidance.

#### Scenario: Explicit microphone action
- **GIVEN** native dictation is available
- **WHEN** the user explicitly taps the composer microphone
- **THEN** any necessary permissions are requested and a visible listening/stop state appears
- **AND** no question is automatically submitted

#### Scenario: Insert without destroying draft
- **GIVEN** an existing draft and saved text selection
- **WHEN** the user stops dictation and a final result arrives
- **THEN** it is inserted once at that selection while surrounding text remains intact

#### Scenario: Cancel or edit during capture
- **WHEN** the sheet closes/collapses, Back is committed, the app backgrounds, or the user edits the draft during capture
- **THEN** capture is cancelled, the original draft plus explicit user edits remain, and late speech results cannot overwrite it

#### Scenario: Unsupported or denied
- **WHEN** native or web capture is unavailable or permission is denied
- **THEN** the microphone shows an explanatory unavailable/error state, no retry loop runs, and typing remains available

#### Scenario: Keyboard dictation
- **WHEN** the user dictates through the installed keyboard into the composer
- **THEN** resulting text is handled as normal editable input without starting a separate app capture session

#### Scenario: Browser processing privacy
- **WHEN** browser recognition may process audio remotely
- **THEN** capture requires explicit disclosure/consent and remains disabled if local-only requirements cannot be satisfied

### Requirement: Selection workflow compatibility with global Assistant
Selection Ask SHALL keep its request-scoped session, editable/removable passage chip, visible-page entry, docked answer cards, citations and existing answer actions. Global conversation reopening SHALL NOT reset or merge selection history, and selection invocation SHALL NOT clear the global conversation. The global pill SHALL be suspended while selection Ask owns interaction.

#### Scenario: Fresh selection and preserved global thread
- **GIVEN** an existing global conversation and a new selected passage
- **WHEN** the user invokes selection Ask
- **THEN** its composer uses that passage in an isolated session, the global thread remains saved, and no competing global pill is active

#### Scenario: Existing answer actions
- **WHEN** a selection answer is produced
- **THEN** the document remains readable/scrollable above its docked card and existing follow-up, flashcard, read-aloud, copy and citation actions remain usable
