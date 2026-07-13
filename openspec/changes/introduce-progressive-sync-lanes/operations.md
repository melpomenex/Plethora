# Sync operations and recovery

The app is local-first. A relay outage, key setup failure, malformed shard, or paused scheduler must never prevent navigation or delete local SQLite data.

User-visible states are:

- **Up to date** — no queued work and no quarantined domains.
- **Catching up** — work is progressing in background lanes.
- **Paused to keep the app responsive** — input, background, memory, or power pressure deferred lower lanes.
- **Needs attention** — a domain/shard is quarantined; the retry action resets that circuit only.

Diagnostics contain phase timings, queue depth, operation counts, payload sizes, projection hashes, shard names/epochs, and error classes. They do not contain credentials, room keys, raw file bytes, article HTML, or local machine paths.

Schema compatibility is additive. Older clients preserve unknown fields and ignore unsupported domains. Legacy reads remain available through the cutover window. Recovery rebuilds one verified shard or replays one journal domain; it does not clear unrelated Yjs persistence.

The durable journal uses operation IDs for idempotency. Mutable records coalesce; deletes and review events remain durable. Applied-operation markers are written after successful projection. A crash between projection and acknowledgement is safe to replay.

Queue file readiness is intent-based. Each device publishes at most three file IDs (the current queue document plus the next two), keyed by requesting device and renewed for two hours. A receiver downloads only when its local file policy permits it; `manual` remains manual. Intent expiry or tombstoning never deletes an already-downloaded file, and one device leaving its queue horizon cannot cancel another device's intent.
