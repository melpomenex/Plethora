## Why

Review already has inline editing and shared card content, but equivalent behavior for persisted cards across Review, Queue sessions, Deck Manager and document-associated lists remains unqualified.

## What Changes

- Exercise and repair inline/Studio routing, legacy cloze and occlusion rendering and durable card edits.
- Verify deletion advances once, with no rating, and supported undo restores the card. Prove tag persistence and Answer focus.

## Capabilities

### New Capabilities

- `review-editing-and-session-consistency`.

### Modified Capabilities

This change carries one delta for the capability listed above.

## Impact

Card renderers, edit routes, session caches, and existing learning-item and tag mutation APIs.

See the [closure plan](../../planning/issue-6-final-closure-plan.md) for issue ownership and dependencies.
