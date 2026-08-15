# Spec Delta: document-deletion-sync (removal)

## REMOVED Requirements

### Requirement: Document Deletion Sync via Tombstones
**Reason**: The real-time cross-device sync subsystem this requirement governed is removed entirely; deletions no longer propagate across devices.
**Migration**: Document deletion is now a purely local operation (delete from SQLite plus local file cleanup). Users who need to move deletions between devices use import/export or cloud backup.
