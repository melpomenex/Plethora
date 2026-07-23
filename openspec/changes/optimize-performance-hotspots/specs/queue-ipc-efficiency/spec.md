# queue-ipc-efficiency

Queue listings transfer only listing-relevant fields, and queue mutations do not re-transfer the full queue.

## ADDED Requirements

### Requirement: Queue listing payload slimming is opt-in and off by default
Queue listing commands (`get_queue`, `get_queued_items`) SHALL support an opt-in `slim` flag that, when explicitly true, omits per-item card content fields (`question`, `answer`, `cloze_text`) and substitutes a bounded `learning_hint` preview. The flag SHALL default to false (full content retained) because the frontend stores a queue listing as shared state that backs content-dependent features (semantic-study focal-topic filtering, the semantic graph, and schedule titles), which read those fields. No caller that backs those features may request slim.

#### Scenario: Default load retains card content
- **WHEN** the queue view loads the queue with no `slim` argument
- **THEN** the transferred learning items retain their `question`/`answer`/`cloze_text`, and semantic-study filtering, the semantic graph, and schedule titles behave identically to before this change

#### Scenario: Explicit opt-in slims the payload
- **WHEN** a caller invokes a listing command with `slim: true`
- **THEN** the returned items carry no card content fields and each learning item carries a bounded `learning_hint` preview instead

### Requirement: Queue mutations apply as local deltas
Single-item queue mutations (postpone, dismiss, priority change, suspend) SHALL update the affected item in the frontend store from the mutation's own response and re-sort locally, without reloading the full queue listing. Bulk operations, initial load, explicit refresh, and collection switches MAY reload the full listing.

#### Scenario: Postpone without full reload
- **WHEN** the user postpones one queue item
- **THEN** exactly one mutation command is invoked, no full queue listing command is invoked as a consequence, and the item's new due state and position are reflected in the UI

#### Scenario: Unmappable mutation falls back safely
- **WHEN** a mutation response cannot be mapped onto a single known item
- **THEN** the store falls back to a full queue reload so displayed state never silently diverges

#### Scenario: Reconciliation on return
- **WHEN** the user returns focus to a queue view after mutations were applied as local deltas
- **THEN** the store reconciles with a fresh listing so any accumulated drift is corrected
