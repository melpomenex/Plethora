# smart-tagging-core Specification

## ADDED Requirements

### Requirement: Smart Tagging operates out of the box without an LLM (Tier 1 Baseline)
The system SHALL provide a local, deterministic, non-LLM classification engine (Tier 1 Baseline) that analyzes imported documents and items to extract high-quality subject tags. Tier 1 classification SHALL execute completely offline, require zero API keys or external services, and produce meaningful tags on a fresh installation.

#### Scenario: Document imported on fresh installation without AI configuration
- **GIVEN** a fresh Plethora installation with no AI provider or API keys configured
- **WHEN** a user imports a document (e.g. an article on Linux memory management)
- **THEN** the Tier 1 baseline tagger analyzes the document locally
- **AND** assigns relevant semantic tags (e.g. `Operating Systems`, `Linux`, `Memory Management`)
- **AND** no onboarding prompts or errors demanding AI configuration are displayed

#### Scenario: Substring and token collision prevention
- **GIVEN** a document containing words like "software", "hardware", "warning", "forward", "award", or "reward"
- **WHEN** Tier 1 baseline tagging executes
- **THEN** the system tokenizes text on word boundaries
- **AND** does NOT trigger a `History` tag due to substring matches on "war"

#### Scenario: Word-boundary and polysemous word rejection
- **GIVEN** a programming document discussing mathematical functions, data tables, or average runtimes
- **WHEN** words such as "function", "table", "mean", "average", "set", "vector", or "model" appear in a non-mathematics context
- **THEN** the system SHALL NOT assign a `Math` tag unless multi-term domain evidence (e.g. calculus, differential equations, linear algebra terms, theorem proofs) reaches the high-confidence domain threshold

#### Scenario: Insufficient evidence produces zero semantic tags
- **GIVEN** a short note or unstructured document with no clear subject matter
- **WHEN** baseline classification computes confidence scores for all candidate topics
- **THEN** all candidates score below the acceptance threshold
- **AND** the system assigns 0 semantic tags rather than inventing low-confidence guesses

### Requirement: Tier 2 LLM-enhanced semantic refinement
When the user has configured an active LLM provider (local Ollama, Android on-device Gemini Nano, or user-selected cloud model), the system SHALL use the configured provider to refine candidate tags and identify nuanced topics.

#### Scenario: LLM refines semantic tags using structured task
- **GIVEN** an active LLM provider is configured and available
- **WHEN** a document is processed by Smart Tagging
- **THEN** the system extracts representative document context (title, headings, TOC, introduction, and top extracted keywords)
- **AND** executes the `SmartTaggingTask` via the standard AI task layer
- **AND** parses and validates the structured response against the strict Smart Tagging schema

#### Scenario: LLM failure gracefully falls back to Tier 1 baseline
- **GIVEN** an active cloud LLM provider is configured
- **WHEN** the provider request times out, fails with a rate limit, or returns invalid output
- **THEN** document import succeeds without delay or error
- **AND** the system falls back to the Tier 1 baseline tag suggestions
- **AND** no error dialog blocks the user interface

### Requirement: Representative content sampling for long documents
The system SHALL NOT pass entire large documents (such as 500-page PDFs or EPUBs) into LLM context for tagging. The system SHALL construct a compact semantic summary representation under a bounded token budget (≤ 3,000 tokens).

#### Scenario: Long document context assembly
- **GIVEN** a 600-page textbook
- **WHEN** Smart Tagging prepares the LLM prompt input
- **THEN** it includes the title, author, table of contents/chapter titles, preface/introduction excerpt, and locally extracted top TF-IDF keywords
- **AND** the payload remains strictly within the token ceiling

### Requirement: Strict prompt-injection containment and structured validation
All document text passed to LLMs for Smart Tagging SHALL be wrapped in delimited `<untrusted_source>` blocks carrying the system instruction containment clause. Model responses SHALL be strictly validated, with JSON repair salvage applied before rejection.

#### Scenario: Malformed LLM output is repaired or discarded safely
- **GIVEN** an LLM produces truncated or malformed JSON
- **WHEN** the validation pipeline processes the response
- **THEN** `jsonRepair` attempts programmatic salvage of complete entries
- **AND** invalid tag objects or unauthorized database fields are rejected
- **AND** the user's tag database is never corrupted

### Requirement: AI privacy and provider adherence
Smart Tagging SHALL respect Plethora's AI privacy model. If the user configured an on-device model or local Ollama endpoint, Smart Tagging data SHALL NOT leave the local device. If a cloud provider is selected, Smart Tagging SHALL use only the user-authorized provider.

#### Scenario: Local-only privacy guarantee
- **GIVEN** the user has enabled on-device AI or local Ollama with `allowCloudFallback: false`
- **WHEN** Smart Tagging runs
- **THEN** inference executes strictly on the local machine
- **AND** no telemetry or document text is transmitted to external cloud APIs
