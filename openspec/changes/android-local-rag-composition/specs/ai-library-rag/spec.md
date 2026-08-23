## MODIFIED Requirements

### Requirement: Retriever and generator are independent
Ask Library SHALL retrieve using a SemanticRetriever implementation and SHALL generate using the existing task/provider router. Either side MAY be unavailable independently.

#### Scenario: Nano generator + SQLite retriever
- **GIVEN** on-device Prompt ready and `ai_learning` index has chunks
- **WHEN** the user asks “What did I read about page replacement algorithms?”
- **THEN** the answer is grounded in retrieved library chunks
- **AND** `sourceRefs` navigate to canonical documents
- **AND** help-documentation chunks are not included

#### Scenario: Retrieval without generator
- **GIVEN** no generative provider is ready and cloud fallback is off
- **WHEN** the user asks a library question
- **THEN** Plethora still shows retrieved sources
- **AND** does not call OpenRouter

#### Scenario: Help corpus isolation
- **WHEN** Ask Plethora (product help) runs
- **THEN** it does not retrieve private library chunks
