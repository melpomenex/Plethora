# Progressive sync rollout

1. Ship lifecycle telemetry, fixtures, scheduler, coverage registry, local-first startup, and bounded queue-file intents. The scheduler and queue horizon are enabled; journal, shards, dual-write, and compaction remain disabled. Older clients safely ignore the additive intent map.
2. Enable journaled projection for an internal cohort. Watch outbox/inbox depth, dead letters, projection hashes, long tasks, and first-use latency. Roll back by disabling `VITE_SYNC_JOURNALED_PROJECTION`; local SQLite remains authoritative.
3. Enable dual-write and shard-index shadow parity. Do not switch reads until parity and capability gates pass for the active device set.
4. Prefer verified shard reads with legacy fallback during the cutover window. Revert the per-domain marker if parity or catch-up budgets regress.
5. Enable compaction only after snapshot verification, acknowledgement/retention, mixed-version, and long-offline recovery drills pass. Disable the compaction flag to roll back; never delete local projections as a rollback action.

Each stage is independently observable and reversible. A failed domain or shard is quarantined while other domains and local application state continue to work.
