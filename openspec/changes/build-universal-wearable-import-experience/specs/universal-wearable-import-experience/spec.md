## ADDED Requirements

### Requirement: Unified Import Wearable Data workflow
The system SHALL provide a unified **Import Wearable Data** workflow in Learning Insights, Data Sources, and Settings → Integrations → Health & Wearables supporting `.zip`, `.xml`, `.csv`, and `.json` exports with automatic provider detection, preview, category selection, progress reporting, cancellation, and completion summaries.

#### Scenario: User imports a wearable archive without manual extraction
- **WHEN** a user selects a supported wearable `.zip` export via **Import Wearable Data**
- **THEN** the UI displays the detected provider, date range, and record counts in a preview, shows progress during ingestion, and offers a completion action to open Sleep Chart or Learning Insights

### Requirement: Truthful provider export instructions and readiness separation
The system SHALL separate local file import readiness from cloud OAuth readiness on provider cards and provide an integrated **How to export your data** guide per provider with verified instructions, supported formats, and honest limitations.

#### Scenario: Approval-gated cloud provider still supports local archive import
- **WHEN** Garmin cloud OAuth is `requires_developer_approval`
- **THEN** the Garmin card still allows **Import data** and **Export instructions** for Garmin account exports

### Requirement: Import history and batch deletion UI
The system SHALL display past import batches (file name, detected provider, import date, added/updated/skipped counts, date coverage, warnings) and allow users to delete an import batch with confirmation.

#### Scenario: Deleting an import batch refreshes analytics
- **WHEN** a user deletes an import batch from Import History
- **THEN** `useHealthStore.invalidate()` refreshes Sleep Chart and Learning Insights immediately
