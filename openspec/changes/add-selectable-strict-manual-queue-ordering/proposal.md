## Why

Strict Manual is exposed in Review Settings but currently never reaches the active queue rankers. The reporter needs manual priority to govern the displayed order of eligible material across ordinary and composed sessions.

## What Changes

- Wire the existing Adaptive and Strict Manual choices into native and browser queue builders and keep the final eligible order stable.
- Preserve explicitly set priority zero, distinguish inherited/unset from assigned, and use the same durable mutation path for keyboard and pointer.
- Make automatic capacity recovery respect strict order and explain the active policy.

## Capabilities

### New Capabilities

- `strict-manual-queue-ordering` governs the persisted mode, effective manual priority and strict selection.

### Modified Capabilities

- `scroll-mode-queue-order` makes Optimal Session presentation conditional on the active queue mode.

## Impact

Settings, queue APIs and candidate producers, DAQE, browser persistence, Scroll/Optimal, saved queues and automatic postponement. See the [program](../../planning/issue-6-final-closure-plan.md) for integration order. Document rotation owns due policy.
