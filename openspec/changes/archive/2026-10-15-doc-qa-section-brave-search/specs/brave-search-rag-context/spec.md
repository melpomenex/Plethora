## ADDED Requirements

### Requirement: Configure Brave Search API Key
The system SHALL provide a settings interface in the AI Settings section allowing the user to input and save their Brave Search API key.

#### Scenario: Storing Brave Search key
- **WHEN** the user inputs a Brave Search API key and clicks Save in the settings page
- **THEN** the system SHALL securely store the key in the keychain or configuration state and mask the display for security

### Requirement: Test Connection for Brave Search
The system SHALL allow testing the Brave Search API key configuration with a verification query.

#### Scenario: Testing connection with valid key
- **WHEN** the user clicks "Test" next to the Brave Search key input with a valid key configured
- **THEN** the system SHALL return a "Connection successful" message indicating the Brave API responded successfully

### Requirement: Triggering Web Search in Chat
The system SHALL allow users to enable web search in Document Q&A so that their queries trigger a Brave web search.

#### Scenario: Query with web search enabled
- **WHEN** the user submits a query in Document Q&A with web search enabled
- **THEN** the system SHALL call the Brave Search API to search the web using the query terms

### Requirement: Injecting Web Search Results to Chat Context
The system SHALL retrieve search results from Brave Search and format them into the LLM prompt context to inform the model's answer.

#### Scenario: Search results injected as context
- **WHEN** web search is triggered for a query
- **THEN** the system SHALL request the LLM to answer using a prompt context containing the retrieved web search results (title, snippet, URL) with citations
