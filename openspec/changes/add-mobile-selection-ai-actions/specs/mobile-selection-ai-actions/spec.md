## ADDED Requirements

### Requirement: Selection opens a bottom sheet of actions on mobile

On the mobile shell, completing a text selection inside readable content SHALL open a bottom sheet listing the actions available for that selection, replacing the single floating extract button. The sheet SHALL be dismissible by tapping the scrim, pressing Escape, or clearing the selection.

#### Scenario: Selection opens the sheet
- **WHEN** the user finishes selecting non-empty text inside document content on the mobile shell
- **THEN** a bottom sheet opens showing the selected text (truncated to a preview) and the action rows

#### Scenario: Extract action preserved
- **WHEN** the sheet is open and the user taps "Create extract"
- **THEN** the sheet closes and the extract dialog opens with the same selection the floating lightbulb button would have passed

#### Scenario: Dismissing the sheet
- **WHEN** the user taps the scrim, presses Escape, or the selection is cleared
- **THEN** the sheet closes, no AI request is started, and the selection handling returns to its idle state

#### Scenario: Desktop unchanged
- **WHEN** the user selects text on a non-mobile shell
- **THEN** the existing desktop selection popup is shown and no bottom sheet appears

### Requirement: AI actions on the selection

When an AI path is available, the sheet SHALL offer Explain, Summarize, Simplify, Key terms, and Ask a question, each operating on the selected text. Asking a question SHALL accept free-text input within the sheet before running.

#### Scenario: Explain a passage
- **WHEN** the user taps "Explain"
- **THEN** the sheet switches to a result view and renders the explanation produced for the selected text

#### Scenario: Ask a question about the selection
- **WHEN** the user taps "Ask a question", types a question, and submits it
- **THEN** the answer is generated using the selected text as the grounding passage and rendered in the result view

#### Scenario: Streaming output
- **WHEN** the active path supports streaming
- **THEN** partial output is rendered as it arrives rather than only after completion

#### Scenario: Oversized selection
- **WHEN** the selected text exceeds the active model's input budget
- **THEN** the request is chunked or truncated to fit and the user is told the input was shortened

### Requirement: Actions route through the shared AI path resolver

Every AI action in the sheet SHALL resolve its execution path with the existing resolver: on-device inference when the platform supports it, the model is ready, and the user prefers it; otherwise the configured cloud provider. A failed on-device attempt SHALL fall back to the cloud provider when one is configured.

#### Scenario: On-device path used
- **WHEN** the device supports on-device AI, the model is available, and the on-device preference is enabled
- **THEN** the action runs on-device and no request is sent to a cloud provider

#### Scenario: Cloud path used
- **WHEN** on-device AI is unavailable or the preference is disabled and a cloud provider is configured
- **THEN** the action runs against the configured cloud provider

#### Scenario: On-device failure falls back
- **WHEN** an on-device request fails after starting and a cloud provider is configured
- **THEN** the action is retried against the cloud provider and the user is informed of the fallback

#### Scenario: Cancellation is not a fallback
- **WHEN** the user cancels a running request or closes the sheet mid-request
- **THEN** the request is aborted and no fallback request is issued

### Requirement: Graceful degradation without AI

When no AI path is available, the sheet SHALL hide the AI actions and present only the non-AI actions. The sheet SHALL NOT present an AI action that cannot run.

#### Scenario: No provider and no on-device model
- **WHEN** no cloud provider is configured and on-device AI is unavailable
- **THEN** the sheet shows only the non-AI rows and no AI rows are rendered

#### Scenario: Model needs downloading
- **WHEN** on-device AI reports the model as downloadable or downloading and no cloud provider is configured
- **THEN** the sheet surfaces that state with the action to start or await the download instead of failing an inference request

#### Scenario: Request error
- **WHEN** an AI request fails on every available path
- **THEN** the result view shows the failure with a retry action and the selection is preserved

### Requirement: Results can be reused

The result view SHALL offer copying the result, retrying the action, and creating an extract from the result. An extract created from a result SHALL be attached to the same document and position as an extract created from the selection itself.

#### Scenario: Copy the result
- **WHEN** the user taps "Copy" in the result view
- **THEN** the result text is placed on the clipboard

#### Scenario: Create an extract from a result
- **WHEN** the user taps "Create extract" in the result view
- **THEN** the extract dialog opens pre-filled with the result text, carrying the same document, page, and selection context as the original selection

#### Scenario: Retry
- **WHEN** the user taps "Retry"
- **THEN** the same action is re-run on the same selection and the previous result is replaced

### Requirement: Available across reading surfaces

The selection sheet SHALL be available wherever mobile reading surfaces produce a text selection — documents (PDF, EPUB, HTML, Markdown), transcripts, and queue/RSS article reading — using the same action set and routing.

#### Scenario: Transcript selection
- **WHEN** the user selects text in a transcript on the mobile shell
- **THEN** the same sheet opens with the same AI actions operating on the selected transcript text

#### Scenario: Queue article selection
- **WHEN** the user selects text in a queue/RSS article on the mobile shell
- **THEN** the same sheet opens and extract creation uses that surface's existing extract path
