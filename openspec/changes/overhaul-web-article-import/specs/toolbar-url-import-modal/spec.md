## ADDED Requirements

### Requirement: Dialog imports through the article pipeline
A URL imported via the `WebArticleImportDialog` SHALL be processed by the Web Article Import Pipeline, producing an extracted, sanitized article document rather than a flattened page capture; existing dialog behaviors (open on toolbar action/shortcut, open result in a new tab, cancel without side effects) remain unchanged.

#### Scenario: Dialog import produces an article
- **WHEN** the user submits an article URL in the `WebArticleImportDialog`
- **THEN** the document created is the extracted article and opens in a new tab on success

### Requirement: Pipeline-aware progress and error states
The dialog SHALL expose pipeline progress states (fetching, extracting, rendered fallback in progress) and typed failure states with the failure reason, and SHALL offer a retry action that re-runs the import.

#### Scenario: Failure shown with reason and retry
- **WHEN** an import fails with `low_confidence` or `auth_required`
- **THEN** the dialog shows the typed reason and a working retry action instead of a generic error

### Requirement: Explicit raw-page fallback escape hatch
When extraction fails, the dialog SHALL offer an explicitly labeled "import full page anyway" action that stores the sanitized full page with a raw-fallback marker (extractor `raw-fallback` plus a visible in-document notice), never presented as a clean article import; this escape hatch SHALL NOT be auto-invoked.

#### Scenario: User opts into raw import
- **WHEN** extraction fails and the user chooses "Import full page anyway"
- **THEN** a document is created from the sanitized full page, marked and visually labeled as a raw fallback

#### Scenario: No silent raw fallback
- **WHEN** extraction fails and the user dismisses the dialog
- **THEN** no document is created
