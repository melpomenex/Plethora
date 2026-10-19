## MODIFIED Requirements

### Requirement: Source scope is explicit and enforced

The workspace SHALL expose source scope adjacent to the composer, with an applicable whole-library choice and searchable document selection that does not require mention syntax. The workspace SHALL NOT display an isolated scope picker column or segmented control in the navigation rail or sidebar layout area. It SHALL identify a collection restriction when one applies. Explicit document mentions and section references SHALL visibly narrow or override that base scope according to the established targeting rules. Removing an override SHALL reveal the base scope. The submitted request SHALL use only eligible sources in the displayed scope and obey existing local-only and AI-excluded rules. A missing/ineligible selected source or an empty eligible set SHALL NOT silently broaden the request.

#### Scenario: Choose one document without syntax
- **WHEN** the user searches for and selects a document in the source control and asks an ordinary knowledge question
- **THEN** the selected title is visible beside the composer
- **AND** evidence retrieval is restricted to that eligible document

#### Scenario: No extraneous sidebar-adjacent scope column
- **WHEN** Document Q&A is opened on any desktop or mobile layout
- **THEN** no standalone scope selector or segmented pill control is rendered between the navigation rail and the conversation workspace
- **AND** the sidebar width is not extended by an extraneous middle-left column

#### Scenario: Advanced scope override
- **WHEN** the user adds a document mention or section reference that changes the effective source scope
- **THEN** the effective source is visibly identified before submission
- **WHEN** the user removes that override
- **THEN** the underlying source selection applies again

#### Scenario: Restricted collection or excluded document
- **WHEN** the active collection limits the available sources or contains AI-excluded documents
- **THEN** the scope label communicates the collection restriction
- **AND** the submitted source set excludes ineligible and out-of-collection documents

#### Scenario: Selected document becomes unavailable
- **WHEN** the chosen document is deleted or becomes ineligible before Ask is activated
- **THEN** the question is retained and the user is asked to choose an available source
- **AND** no broader library request is silently substituted
