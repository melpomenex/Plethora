## Why

The Learning Agent and generated-card routes have partial parameter, context and retry handling. The current generic validator has no production consumer, and the baseline section-to-acceptance test does not reach its scripted provider.

## What Changes

- Normalize supported arguments and enforce exact source scope through provider requests and card acceptance.
- Represent Assistant terminal outcomes and recover from failures while preserving consent and prior receipts.
- Use a shared editable draft and validated acceptance contract for Assistant, selections, Learn This and Studio. Connect extract summaries to the authorized route.

## Capabilities

### New Capabilities

- `ai-learning-actions-and-card-quality`.

### Modified Capabilities

This change carries one delta for the capability listed above.

## Impact

Agent descriptors, Assistant/Document QA, provider task routing, generated card validation, existing learning-item IPC and browser persistence. Study Plans retains its assessment schemas.

See the [closure plan](../../planning/issue-6-final-closure-plan.md) for issue ownership and dependencies.
