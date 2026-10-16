## MODIFIED Requirements

### Requirement: Explicit expansion trigger goes beyond the document
In `Chat` scope, the Assistant SHALL naturally combine active selection and document/video context with broader model knowledge whenever a question extends beyond the source text, without requiring the user to utter specific expansion trigger phrases. In `Document` scope, the Assistant SHALL remain strictly grounded in the selection and source text unless the user explicitly switches to `Chat` scope or enables web search. Fragile keyword triggers (such as matching the word `"chapter"` as an external lookup signal) SHALL NOT be used to trigger web searches or override the selected conversation scope.

#### Scenario: User asks to look it up
- **WHEN** the user selects a paragraph and asks "What else can you tell me about this? Look it up"
- **THEN** the answer first explains the selection in document context and then adds broader background beyond the document

#### Scenario: Document-confined answer without trigger
- **WHEN** the user asks "What does this paragraph say?" in `Document` scope with no expansion phrasing
- **THEN** the answer stays grounded in the selection and document without invoking external model knowledge or web search

#### Scenario: User asks a broader question in Chat scope without special phrasing
- **WHEN** the user selects a paragraph or reads a document in `Chat` scope and asks "How does this compare to biological attention?"
- **THEN** the Assistant explains the connection using both the document context and broader domain knowledge on the first turn without requiring a trigger phrase

#### Scenario: Chapter-related question does not trigger false-positive web search
- **WHEN** the user asks "Summarize chapter 2" or "What is the main argument in this chapter?"
- **THEN** the Assistant answers using the chapter/document context without treating the word "chapter" as an external web-search trigger

### Requirement: Optional Brave web search grounds expanded answers
When live web search is explicitly enabled by the user or requested via an unambiguous web-lookup intent (e.g., "search the web for...", "look up recent papers on...") and a Brave search key is configured, the system SHALL construct the search query from the user's actual question (disambiguated by selection topic when needed, rather than sending the raw selected passage verbatim), incorporate the results into the answer, and cite web sources. When no Brave key is configured or the request fails, the system SHALL answer from source and model knowledge (in `Chat` scope) and explicitly state that no live lookup was performed.

#### Scenario: Brave key present
- **WHEN** live web lookup is requested while a passage is selected and a Brave key is configured
- **THEN** the system queries Brave using the user's question and topic rather than the raw verbatim selection text
- **AND** the answer includes fresh web results with cited sources alongside model knowledge

#### Scenario: No Brave key configured
- **WHEN** expansion is triggered in `Chat` scope but no Brave key is configured
- **THEN** the answer uses model knowledge only and discloses that live web lookup was unavailable

#### Scenario: Search failure degrades gracefully
- **WHEN** the Brave request fails or returns no results
- **THEN** the system still answers from selection, document, and model knowledge and notes that live results were unavailable
