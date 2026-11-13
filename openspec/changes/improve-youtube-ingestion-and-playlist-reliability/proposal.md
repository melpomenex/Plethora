## Why

Playlist defaults and runtime diagnostics exist, but require a real save/reopen/import qualification. The custom cookie path setter is process-local and the UI does not reapply its stored value on startup.

## What Changes

- Confirm global defaults seed new subscriptions and existing subscription overrides remain authoritative for imports.
- Use one runtime/authentication diagnostic contract across metadata, playlist and transcript paths. Persist validated authorized cookie settings without exposing credentials.

## Capabilities

### New Capabilities

- `youtube-ingestion-and-playlist-reliability`.

### Modified Capabilities

This change carries one delta for the capability listed above.

## Impact

Integrations Settings, YouTube command builder, subscription repository and native runtime. [Video lifecycle](../fix-video-extract-queue-and-review-lifecycle/) owns extract status, queue membership and rating.

See the [closure plan](../../planning/issue-6-final-closure-plan.md) for issue ownership and dependencies.
