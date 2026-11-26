## ADDED Requirements

### Requirement: Idempotent re-imports and safe batch deletion
The system SHALL prevent duplicate records across repeated or overlapping imports and SHALL only delete raw records during import batch deletion when no other active import batch or sync source supports those records.

#### Scenario: Deleting an overlapping import batch preserves shared records
- **WHEN** Batch 1 and Batch 2 both import record R, and the user deletes Batch 1
- **THEN** record R remains in `health.db` because Batch 2 still references it, and deleting Batch 2 removes record R and updates canonical episodes

### Requirement: Aggregate-only stage totals are preserved without fabricating timelines
The system SHALL preserve aggregate stage duration totals (`light_mins`, `deep_mins`, `rem_mins`, `awake_mins`) on `CanonicalSleepEpisode` when `stages` is empty, and the Sleep Chart SHALL display those totals without generating synthetic stage timeline bars.

#### Scenario: WHOOP aggregate stages appear in Sleep Chart inspector without fake intervals
- **WHEN** a WHOOP sleep session with aggregate stage totals and no stage intervals is displayed in Sleep Chart
- **THEN** the day inspector shows Light, Deep (SWS), REM, and Awake totals while clearly indicating no timeline intervals were exported
