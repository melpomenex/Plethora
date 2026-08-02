## ADDED Requirements

### Requirement: Skip Republishing Unchanged Documents
The system SHALL skip publishing a document to the shared Yjs `documents` map when the document's sync clock (`dateModified` or `dateAdded`) has not changed since the last successful publish of that document, using the existing sync clock cache used by the remote-replay path.

#### Scenario: Re-opening the Documents tab republishes nothing unchanged
- **WHEN** the user switches to the Documents tab and none of the 272 library documents have changed since the last publish
- **THEN** the system SHALL NOT write to the shared Yjs `documents` map for any of those documents

#### Scenario: A genuinely modified document is still published
- **WHEN** a document's `dateModified` has advanced since its last recorded publish clock
- **THEN** the system SHALL publish the updated document to the shared Yjs `documents` map as before

### Requirement: Constant-Time Manifest Membership Checks
The system SHALL check whether a document's file is already present in the file manifest using an amortized O(1) lookup (e.g. an index or Set built once per sync pass) rather than scanning the full manifest list for every document.

#### Scenario: Registering existing files for a large library
- **WHEN** the system verifies manifest membership for 272 documents that already have a `fileId`
- **THEN** the total manifest-lookup cost SHALL scale linearly with the number of documents and manifest entries combined, not with their product

### Requirement: Full Sync Registration Runs Once Per Session, Not Per Tab Activation
The system SHALL run the full existing-files sync registration pass (hashing, manifest registration, and publish for every document with a synced file) at most once per application session by default, rather than re-running it in full every time the Documents view is loaded or the Documents tab is activated. Subsequent document-list loads SHALL only perform sync registration work for documents that are new or whose sync-relevant fields have changed since the last pass.

#### Scenario: Switching tabs repeatedly does not re-scan the whole library
- **WHEN** the user switches away from and back to the Documents tab multiple times in a session without importing or modifying any documents
- **THEN** the system SHALL NOT repeat the full per-document manifest/publish pass for documents already registered in this session

#### Scenario: Newly imported document is still registered
- **WHEN** a new document is imported during the current session
- **THEN** the system SHALL still perform file-sync registration (hashing, manifest entry, publish) for that new document
