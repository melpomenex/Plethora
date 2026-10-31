## Why

Setting priority with Alt+P and Enter does not reliably agree with the priority indicator for extracts and flashcards, while documents work. Priority must identify and update the same item consistently wherever a user encounters it, including queue and library surfaces.

## What Changes

- Make the configured priority shortcut and available pointer/touch priority controls work for documents, extracts, and flashcards across their applicable queue, library, and reader surfaces.
- Persist and display the committed user priority consistently on reopening controls, switching surfaces, and reloading; preserve the distinction between a slider value and a queue ranking key.
- Route mixed selections to the correct underlying items, report failures, and prevent stale asynchronous updates from affecting another item.
- Update the outdated bulk priority contract to include flashcards while preserving its transaction and outcome guarantees.

## Capabilities

### New Capabilities

- `item-priority-consistency`: Consistent priority editing, persistence, and display for individual items across application surfaces and input methods.

### Modified Capabilities

- `queue-bulk-actions`: Include flashcards in mixed-item bulk priority changes and revise the conflicting inapplicability scenario.

## Impact

Affected areas include Scroll Queue and its overlay, review queue and library/reader priority entry points, shared priority popup and commit service, and document, extract, and learning-item priority APIs and persistence. Priority read models and queue refresh/ordering need verification across item types; existing shortcut customization, scheduling semantics, and bulk transactional guarantees must remain intact. The related `finish-issue-40-priority-controls` change concerns document priority and does not cover this cross-item regression.
