## Why

The reporter saw unreadable table/text layouts and repeated Assistant position loss. The current Assistant scroll fix has Chromium coverage, and native/device paths and reported reader layouts still require verification.

## What Changes

- Use the existing reader table containers and semantic theme tokens to repair reproduced layout and contrast defects.
- Qualify conversation anchors and follow-latest behavior across real app surfaces and only change the existing scroll implementation if a runtime gap is reproduced.

## Capabilities

### New Capabilities

- `assistant-and-reader-ux-continuity`.

### Modified Capabilities

This change carries one delta for the capability listed above.

## Impact

Reader surfaces, built-in themes and Assistant anchor behavior. AI response state is owned by the [AI reliability change](../harden-ai-learning-actions-and-card-quality/).

See the [closure plan](../../planning/issue-6-final-closure-plan.md) for issue ownership and dependencies.
