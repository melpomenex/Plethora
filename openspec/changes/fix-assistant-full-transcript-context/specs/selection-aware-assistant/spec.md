## MODIFIED Requirements

### Requirement: Selection takes precedence as Assistant context
When the user asks the Assistant a question from a document or video reader while an active text selection or pinned selection snapshot exists across `Chat`, `Document`, or `Library` scopes, the system SHALL place the selected text first as the primary question context and keep surrounding document, transcript, or library context as secondary grounding. The Assistant SHALL interpret ambiguous references such as "this", "it", or "this paragraph" as referring to the selection, while allowing broader conceptual expansion when in `Chat` scope. When no explicit user text selection or pinned snapshot exists, the system SHALL NOT invent or infer a localized selection from playback position or whole-document context targets.

#### Scenario: Selected paragraph is the question subject
- **WHEN** the user selects a paragraph and asks "What else can you tell me about this?" in `Chat` scope
- **THEN** the Assistant answer addresses the selected paragraph first before adding wider context

#### Scenario: Selection disambiguates pronouns
- **WHEN** a selection exists and the user asks "Explain it simply"
- **THEN** the explanation targets the selected text, not an arbitrary document section

#### Scenario: Empty selection falls back to document context
- **WHEN** the user asks a question with no active selection
- **THEN** the system uses the whole-document or video transcript context behavior without bounding coverage to an arbitrary passage

## ADDED Requirements

### Requirement: Whole-source action targets must not be treated as bounded selections
The Assistant system SHALL distinguish between an explicitly bounded user selection (`kind: 'selection'`, pinned excerpt, or section chip) and a whole-source document or transcript target (`kind: 'document'`). Whole-source targets SHALL NOT be flagged as `explicitSourceContent: true` in the orchestrator request when loaded for whole-source actions, and SHALL NOT bypass downstream video context planning or whole-transcript hierarchical processing.

#### Scenario: Whole-source action preserves full planning pathway
- **WHEN** the user invokes a context action targeting the full document/transcript (such as "Outline document", "Key points", or "Summarize")
- **THEN** the orchestrator treats the source as a complete canonical entity eligible for full direct inclusion or hierarchical map-reduce
- **AND** does NOT treat it as a pre-truncated explicit selection

#### Scenario: Genuine user selection remains bounded
- **WHEN** the user highlights two sentences in the video transcript and clicks "Explain" or "Make flashcards"
- **THEN** the orchestrator treats the selected excerpt as a bounded source target with `coverage: "window"`
- **AND** answers strictly from the chosen sentences
