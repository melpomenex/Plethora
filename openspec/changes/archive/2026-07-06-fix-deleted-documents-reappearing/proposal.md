## Why

When a document is deleted from the library, it is removed from the local SQLite database. However, because the document replication layer does not synchronize deletions or write tombstone markers to Yjs, the document remains in the shared Yjs `documents` map. On app restart, page refresh, or synchronization, Yjs replays the shared map, and the replication layer interprets the missing local row as a new remote document, causing it to be recreated in SQLite and reappear in the UI.

## What Changes

- Add a deletion synchronization mechanism to the document replication layer using tombstone markers.
- Write a tombstone marker to the Yjs `documents` map when a document is deleted via the document store or the undo/redo delete command.
- Update the Yjs observer in the document replication layer to process tombstones, deleting the document locally, unregistering it from the file transfer manager, and cleaning up the local file cache.
- Call `deleteDocumentSync` during document deletion in `documentStore.ts` and `DeleteDocumentCommand`.

## Capabilities

### New Capabilities
<!-- Capabilities being introduced. Replace <name> with kebab-case identifier (e.g., user-auth, data-export, api-rate-limiting). Each creates specs/<name>/spec.md -->
- `document-deletion-sync`: Synchronize document deletions across devices via Yjs tombstones.

### Modified Capabilities
<!-- Existing capabilities whose REQUIREMENTS are changing (not just implementation).
     Only list here if spec-level behavior changes. Each needs a delta spec file.
     Use existing spec names from openspec/specs/. Leave empty if no requirement changes. -->

## Impact

- `src/lib/documentReplication.ts`: Document replication observer, deleteSync function.
- `src/stores/documentStore.ts`: Calling deleteSync.
- `src/commands/undoableCommands.ts`: Calling deleteSync.
