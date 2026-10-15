## ADDED Requirements

### Requirement: Deterministic local intent classification
The Command Palette and search system SHALL classify incoming user queries into discrete intent categories locally without making remote LLM API calls:
1. `NavigationCommand`: Matches existing application commands, section navigation, or URL import.
2. `DirectDocumentationLookup`: High-confidence match for exact feature definitions, settings locations, or how-to queries resolvable via canonical summaries.
3. `ProductHelpQuestion`: Natural-language explanatory, troubleshooting, or multi-feature synthesis queries targeting Plethora functionality.
4. `DocumentContentAI`: Queries referencing the current document content, extracts, or external research (routed to Document QA / Library RAG).

#### Scenario: Instant command execution for navigation queries
- **WHEN** a user types "Open E-ink Settings" or "Go to Queue"
- **THEN** the intent classifier classifies the input as `NavigationCommand` and surfaces the direct action without LLM invocation.

#### Scenario: Direct answer for simple factual inquiries
- **WHEN** a user asks "What is Serendipity?" or "Where is TTS speed?"
- **THEN** the classifier routes to `DirectDocumentationLookup`, displaying the canonical feature summary, setting path, and deep link button with zero generative inference.

#### Scenario: Disambiguation between product help and document QA
- **WHEN** a user asks "How does highlighting work in Plethora?" vs "Summarize this paragraph"
- **THEN** the former is routed exclusively to the Plethora documentation knowledge base, and the latter is routed to the Document QA pipeline, preventing context mixing.

### Requirement: Optional explicit help mode prefix
The Command Palette SHALL support an optional explicit prefix (such as `? ` or `/help `) that forces `ProductHelpQuestion` mode, while maintaining automatic intent detection when no prefix is provided.

#### Scenario: Explicit help prefix forces help search
- **WHEN** a user enters `? import format options`
- **THEN** the Command Palette bypasses standard document search and filters exclusively against the canonical Plethora documentation corpus.
