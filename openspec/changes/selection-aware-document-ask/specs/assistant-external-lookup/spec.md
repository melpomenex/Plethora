## Purpose

Lets the Assistant answer selection questions from the document first and then expand beyond the fed text with model knowledge and optional live web search when the user explicitly asks for more.

## ADDED Requirements

### Requirement: Explicit expansion trigger goes beyond the document
When the user's question explicitly requests more than the document (phrases such as "what else", "look it up", "beyond this document", "find more about", or a chapter/topic-level question that the document alone cannot answer), the system SHALL answer from selection + document context first and then expand with broader knowledge rather than replying that only the fed text is available.

#### Scenario: User asks to look it up
- **WHEN** the user selects a paragraph and asks "What else can you tell me about this? Look it up"
- **THEN** the answer first explains the selection in document context and then adds broader background beyond the document

#### Scenario: Document-confined answer without trigger
- **WHEN** the user asks "What does this paragraph say?" with no expansion phrasing
- **THEN** the answer stays grounded in the selection and document without invoking web search

### Requirement: Optional Brave web search grounds expanded answers
When expansion is triggered and a Brave search key is configured, the system SHALL perform a web search for the selection topic, incorporate the results into the answer, and cite sources. When no Brave key is configured, the system SHALL answer from model knowledge and explicitly state that no live lookup was performed.

#### Scenario: Brave key present
- **WHEN** expansion is triggered and a Brave key is configured
- **THEN** the answer includes fresh web results with cited sources alongside model knowledge

#### Scenario: No Brave key configured
- **WHEN** expansion is triggered but no Brave key is configured
- **THEN** the answer uses model knowledge only and discloses that live web lookup was unavailable

#### Scenario: Search failure degrades gracefully
- **WHEN** the Brave request fails or returns no results
- **THEN** the system still answers from selection, document, and model knowledge and notes that live results were unavailable

### Requirement: Expanded answers distinguish sources
Expanded answers SHALL distinguish what came from the user's document/selection, what came from model knowledge, and what came from web results, so the user can tell document-grounded claims from external ones.

#### Scenario: Sources are labeled
- **WHEN** the user receives an expanded answer using both document and web sources
- **THEN** the answer identifies which parts are from the document versus external sources with citations for web claims
