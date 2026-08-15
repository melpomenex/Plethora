## ADDED Requirements

### Requirement: Adaptive Context Window for Passage Actions
The system SHALL dynamically scale the surrounding context attached to a selection based on the selection's character length to avoid unnecessary prefill latency for large selections.

#### Scenario: Long selection uses minimal or no extra surrounding context
- **WHEN** user selects text that is at least 150 characters long (e.g. a full paragraph or multiple sentences)
- **THEN** the system uses the selected text directly without prepending or appending 1,500 characters of surrounding text

#### Scenario: Short selection includes compact surrounding context
- **WHEN** user selects a short phrase or term under 150 characters
- **THEN** the system attaches a bounded surrounding context window (no more than 300 characters before and after) to provide grounding without bloating the prompt

### Requirement: Streaming On-Device Summarization
The system SHALL stream summarization output token-by-token using the on-device streaming Prompt API rather than waiting for batch completion.

#### Scenario: Summarization streams tokens progressively
- **WHEN** user triggers "Summarize" on selected text with on-device AI active
- **THEN** generated summary tokens stream into the UI incrementally via `onChunk` callbacks with Time-to-First-Token under 1 second

#### Scenario: Summarize fallback to cloud maintains unified interface
- **WHEN** on-device summarization is unavailable and fallback occurs
- **THEN** cloud summary is emitted uniformly to the stream consumer

### Requirement: Concise Passage AI Prompt Formats and Output Caps
The system SHALL use high-density prompt templates that prioritize conciseness and SHALL enforce strict output token ceilings (`maxOutputTokens` between 128 and 256 for standard passage operations) to minimize autoregressive generation time on mobile hardware.

#### Scenario: Explanation preset enforces concise output
- **WHEN** user requests a standard explanation for a selected passage
- **THEN** the prompt instructs a concise 1-to-2 sentence explanation or tight bulleted breakdown and limits output tokens to 192 tokens max

#### Scenario: Study note preset produces compact bullet points
- **WHEN** user requests a "study-note" preset
- **THEN** the prompt instructs a high-density 3-bullet takeaway without conversational filler or meta-preamble

### Requirement: Speculative Foreground AI Warmup
The system SHALL trigger background warmup of the on-device AI prompt model when the user makes a text selection or opens the selection action sheet, eliminating cold-start latency when an action is tapped.

#### Scenario: Selection action sheet triggers warmup
- **WHEN** the `SelectionActionsSheet` is opened
- **THEN** `warmUpOnDevicePrompt()` is invoked non-blockingly in the background if on-device Prompt capability is available

### Requirement: Low-Overhead Native Android Bridge Inferences
The Android GenAI plugin SHALL cache static model attributes (such as token limits) and bypass redundant synchronous token-counting IPC hops for inputs guaranteed to be within the model context window.

#### Scenario: Token limit caching
- **WHEN** multiple inference requests are executed in a session
- **THEN** `getTokenLimit()` is read once and cached rather than issuing blocking IPC on every inference invocation

#### Scenario: Fast-path execution for short inputs
- **WHEN** the input prompt is under 500 characters
- **THEN** the native bridge proceeds directly to streaming inference without blocking synchronously on pre-inference token measurement
