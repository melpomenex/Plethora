## Context

The `documents` table in SQLite is local to each device. To replicate document metadata across devices, the app utilizes a shared Yjs `documents` map (`Y.Map<Document>`). When a document is deleted on a device, the local SQLite row is deleted, but the document remains in the Yjs map. Since the Yjs map acts as the source of truth for synced documents, any restart, page refresh, or device join replays the map. The missing local row is interpreted as a new remote document, causing it to be re-inserted into SQLite and reappear in the library.

## Goals / Non-Goals

**Goals:**
- Synchronize document deletions across all devices in a sync room.
- Prevent deleted documents from reappearing on refresh, restart, or synchronization.
- Clean up the corresponding files in the transfer manager and local cache when a document is deleted remotely.

**Non-Goals:**
- Deleting the source file from the peer's actual user directories (like Downloads/Documents) outside the app's managed imports storage.

## Decisions

- **Use Tombstone Markers in `documents` Y.Map:**
  - Instead of completely deleting the key from the Yjs map (which doesn't notify late joiners), we will write a tombstone object `{ _deleted: true, deletedAt: HLC, deletedBy: deviceId }` using the existing `writeTombstone` helper.
  - Rationale: Tombstones are the standard way in this codebase (proven by `replicatedMap.ts` for flashcards/RSS feeds) to handle deletes in Yjs to ensure late-joining devices also receive the delete event.

- **Intercept Tombstones in Yjs Observer:**
  - Update `handleRemoteDocument` in `documentReplication.ts` to check `isTombstone(remote)`.
  - If it's a tombstone, call the backend Tauri command `delete_document` to remove the row from SQLite, and unregister the file from the transfer manager and clean up the file cache.

## Risks / Trade-offs

- **Risk:** Tombstones bloat Yjs map over time.
  - **Mitigation:** Tombstones can be GC'd after 30 days using `gcTombstones` if a GC routine is called. Since documents are low-volume compared to flashcards/RSS items, the growth is negligible.
- **Risk:** Cyclic dependency between `fileSyncRegistration` and `documentReplication`.
  - **Mitigation:** Use dynamic imports for file-transfer and sync-management modules inside the deletion handler.
