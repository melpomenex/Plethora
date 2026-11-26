## ADDED Requirements

### Requirement: Streaming Apple Health XML and ZIP ingestion beyond 50 MB
The system SHALL stream Apple Health `export.xml` and `export.zip` archives directly from disk in Rust with bounded memory, XXE/DTD rejection, progress reporting, and cancellation support for exports substantially larger than 50 MB.

#### Scenario: Multi-year Apple Health export above 50 MB imports cleanly
- **WHEN** a user imports a valid Apple Health `export.xml` or `export.zip` larger than 50 MB
- **THEN** sleep sessions, stage intervals, and physiological records are streamed and ingested without loading the entire file into frontend memory

### Requirement: Expanded generic CSV and custom column mapping
The system SHALL parse RFC-4180 CSV files (including UTF-8 BOM, CRLF, multiline quoted fields, and alternate delimiters), support expanded sleep and biometric columns, and allow users to map unrecognized CSV columns via reusable `CsvMappingProfile` configurations.

#### Scenario: Unrecognized CSV routes to column mapping and saves reusable profile
- **WHEN** a user selects a CSV with custom column names and maps start, end, duration unit, and timezone in the wizard
- **THEN** the preview displays normalized records and the saved profile can be reused on subsequent imports
