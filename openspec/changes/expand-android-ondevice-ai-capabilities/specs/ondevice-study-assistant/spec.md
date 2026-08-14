## ADDED Requirements

### Requirement: Capability-aware study action routing
The system SHALL declare the on-device capability required by each study action and SHALL select on-device, cloud, or unavailable independently for that action.

#### Scenario: Prompt-backed action is available
- **WHEN** a study action requires Prompt, Prompt is available, and on-device inference is preferred
- **THEN** the action runs on-device even if Summarization is unavailable

#### Scenario: Summary action can use feature-specific API
- **WHEN** an article summary requests a supported bullet form and Summarization is available
- **THEN** the action uses the feature-specific Summarization API

#### Scenario: Cloud fallback is required
- **WHEN** the action's required capability is unavailable or fails according to fallback policy and a cloud provider exists
- **THEN** the existing cloud implementation runs and the surface reports the fallback

#### Scenario: Neither path exists
- **WHEN** neither the required on-device capability nor a cloud provider is usable
- **THEN** the surface presents a specific unavailable/download state without starting work

### Requirement: Bounded passage Q&A and explanation
The system SHALL answer or explain questions on selected text, selected sections, or bounded document context using Prompt without presenting Nano as whole-library RAG.

#### Scenario: Selected passage question
- **WHEN** a user asks a question with selected text that fits the measured Prompt budget
- **THEN** the system streams an answer grounded in that text on-device
- **AND** identifies the selected passage as the answer source

#### Scenario: Selected section question
- **WHEN** a user asks about one or more resolved document sections
- **THEN** the existing section resolver supplies bounded context to the on-device adapter
- **AND** section provenance is preserved on the response

#### Scenario: Repeated questions reuse context
- **WHEN** multiple questions are asked against unchanged passage context and prefix caching is available
- **THEN** the stable context is supplied as a reusable prompt prefix

#### Scenario: Context cannot fit safely
- **WHEN** the selected context cannot be reduced to a request that preserves the requested focus
- **THEN** the action offers the existing cloud path or asks the user to narrow the selection
- **AND** does not silently truncate unrelated text

#### Scenario: Whole-library question
- **WHEN** Document Q&A has no selected or mentioned bounded source and requests library search
- **THEN** the existing RAG path remains authoritative
- **AND** Nano does not claim to have searched the library

#### Scenario: Web-grounded or tool-creating question
- **WHEN** web search or database tool execution is requested
- **THEN** the action remains on its existing cloud/tool path

### Requirement: On-device extract analysis
The system SHALL provide summary, key-point, and study-question analysis for an extract using available on-device capabilities.

#### Scenario: Analyze extract without cloud credentials
- **WHEN** Prompt is available and a user analyzes a bounded extract without a cloud provider
- **THEN** summary, key points, and study questions are produced on-device where their required capabilities are available

#### Scenario: One extract subtask fails
- **WHEN** one analysis subtask fails validation
- **THEN** successful subtasks remain visible
- **AND** the failed subtask reports its own retry/fallback state

#### Scenario: Key points are structured
- **WHEN** structured output is available
- **THEN** key points are returned as a bounded typed list
- **AND** blank or duplicate points are discarded

#### Scenario: Study questions are reviewable
- **WHEN** study questions are generated from an extract
- **THEN** they remain suggestions until the user explicitly creates learning items

### Requirement: On-device article summaries
The system SHALL route RSS and article-summary controls through the capability-aware AI layer while preserving length/focus semantics as closely as the selected native path supports.

#### Scenario: Focused article summary
- **WHEN** a user requests key-points, actionable, or background focus on an article
- **THEN** the on-device adapter includes that focus in a bounded summary request

#### Scenario: Summary length is requested
- **WHEN** the selected native API cannot honor an exact word count
- **THEN** the UI does not claim an exact length guarantee
- **AND** Prompt may be selected when a customized length is more important than the feature-specific Summarization adapter

#### Scenario: Summary is cached
- **WHEN** an on-device article summary completes
- **THEN** it uses the existing article summary cache and favorites persistence behavior
- **AND** records its on-device provenance without storing the prompt

### Requirement: On-device tag suggestions
The system SHALL generate bounded, normalized, reviewable tag suggestions on-device during document or content import.

#### Scenario: Tags are generated with structured output
- **WHEN** structured output is available
- **THEN** tags contain a normalized tag, allowed category, and validated confidence class or validation score

#### Scenario: Fallback tag format is parsed
- **WHEN** structured output is unavailable
- **THEN** a strict delimited fallback parser accepts only valid tag/category records

#### Scenario: Suggested tags are not auto-applied
- **WHEN** Nano returns tag suggestions
- **THEN** the existing tag-suggestion UI presents them for explicit selection

#### Scenario: AI is unavailable
- **WHEN** neither on-device Prompt nor cloud AI is available
- **THEN** deterministic basic tag suggestions remain available

### Requirement: Review-time assistance
The system SHALL offer short on-device hints and alternate explanations for the current review item without changing its schedule or answer.

#### Scenario: Hint before reveal
- **WHEN** a reviewer requests a hint for a Q&A or cloze card
- **THEN** Nano returns a concise clue that does not directly reveal the full answer when validation succeeds

#### Scenario: Alternate explanation after reveal
- **WHEN** a reviewer requests another explanation after revealing the answer
- **THEN** Nano generates a bounded explanation from the card and available source context

#### Scenario: Assistance is cancelled
- **WHEN** the reviewer advances, closes the review surface, or cancels the run
- **THEN** queued or active native work is cancelled and no stale response appears on the next card

#### Scenario: Review state remains unchanged
- **WHEN** hint or explanation generation completes or fails
- **THEN** ratings, due dates, review history, and stored card content are unchanged

### Requirement: Flashcard instruction fidelity and grounding
The system SHALL honor user card-generation instructions and SHALL validate on-device cards against their source before accepting them as drafts.

#### Scenario: Card type constraint
- **WHEN** the user requests only Q&A, cloze, or another supported card type
- **THEN** the task adapter requests and retains only that type

#### Scenario: Focus or difficulty constraint
- **WHEN** the user requests a topic focus or difficulty level
- **THEN** that instruction is included separately from source text and reflected in generated drafts

#### Scenario: Evidence is grounded
- **WHEN** a generated card includes its evidence quote
- **THEN** the validator confirms that normalized evidence occurs in the source chunk before accepting the draft

#### Scenario: Duplicate cards cross chunk boundaries
- **WHEN** normalized question/answer or cloze content duplicates an already accepted card
- **THEN** the duplicate is discarded before applying the requested count

#### Scenario: Output lacks a defensible validation score
- **WHEN** an on-device card cannot be grounded or validated sufficiently for automatic acceptance
- **THEN** it cannot bypass approval based on a missing or self-reported confidence value

#### Scenario: Cards are accepted
- **WHEN** valid on-device cards are returned
- **THEN** they enter the existing draft/pending-card flow with on-device and source provenance
- **AND** are saved only through the user's existing approval/save action unless an already-configured automatic flow has a valid acceptance score

### Requirement: Task-specific evaluation and diagnostics
The system SHALL evaluate on-device study adapters against deterministic fixtures and record privacy-preserving runtime metrics by base model version.

#### Scenario: Evaluation corpus runs
- **WHEN** the on-device evaluation workflow is run on a supported device
- **THEN** it measures parse rate, grounding pass rate, duplicate rate, time to first token, total latency, and cancellation latency per task

#### Scenario: Model versions differ
- **WHEN** evaluation results come from different `baseModelName` values
- **THEN** results remain partitioned by model rather than being merged into one quality claim

#### Scenario: Production diagnostics are stored
- **WHEN** a production task records diagnostics
- **THEN** it stores only task kind, model/capability metadata, counts, timing, finish reason, and error code
- **AND** excludes source content, prompts, completions, and image data

