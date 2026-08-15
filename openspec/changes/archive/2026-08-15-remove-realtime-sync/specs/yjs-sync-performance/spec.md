# Spec Delta: yjs-sync-performance (removal)

## REMOVED Requirements

### Requirement: Batched Sync Replay on Boot
**Reason**: The Yjs sync subsystem no longer exists; there is no startup replay to batch.
**Migration**: None — startup no longer performs any sync processing.

### Requirement: Batched Review Projections
**Reason**: Inbound remote review replay is gone; reviews are written only by the local domain path.
**Migration**: None — local review writes were never gated on this requirement.

### Requirement: Sync Telemetry Long Task Warning Throttling
**Reason**: The sync telemetry PerformanceObserver is deleted along with the subsystem.
**Migration**: None.

### Requirement: Target-Gated GPU Acceleration Configuration
**Reason**: Orphaned by this removal — the requirement lived under the sync-performance spec but concerns GPU rendering workarounds, not sync.
**Migration**: If still needed, re-home into its own spec before this change is archived; otherwise it is superseded by the current renderer configuration in `main.tsx`.
