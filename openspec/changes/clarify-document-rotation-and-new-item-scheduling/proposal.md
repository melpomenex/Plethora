## Why

Deck Manager marks cards overdue minutes after creation, while other screens apply different rules. The Review Settings rotation interval persists without changing the scheduler.

## What Changes

- Use one local-calendar due status policy on scheduling and review surfaces.
- Connect the existing default interval to explicit document revisits while preserving manual postpone, reading position and FSRS history.
- Document and qualify immediate first exposure under current queue eligibility.

## Capabilities

### New Capabilities

- `document-rotation-and-new-item-scheduling`.

### Modified Capabilities

This change carries one delta for the capability listed above.

## Impact

Review Settings, presentation helpers, reading commands and browser adapters. Coordinate due and candidate rules with Strict Manual.

See the [closure plan](../../planning/issue-6-final-closure-plan.md) for issue ownership and dependencies.
