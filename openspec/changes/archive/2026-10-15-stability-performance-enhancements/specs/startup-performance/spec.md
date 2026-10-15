## ADDED Requirements

### Requirement: Deferred non-critical startup work
The system SHALL defer non-critical background tasks (sync handshake, RSS polling, analytics, AI model preloading) until after the first idle frame using `requestIdleCallback` with a 3-second timeout fallback.

#### Scenario: App starts with deferred background work
- **WHEN** the application launches
- **THEN** the main UI SHALL render and become interactive before any sync, RSS, analytics, or AI initialization begins

#### Scenario: Deferred work completes within timeout
- **WHEN** the browser has no idle frames within 3 seconds of startup
- **THEN** the deferred tasks SHALL execute via the timeout fallback

### Requirement: SQLite hot-path indexes
The system SHALL maintain composite indexes on frequently-queried columns to ensure queue computation and document hydration queries use indexed lookups.

#### Scenario: Queue computation uses indexed queries
- **WHEN** `computeOptimalQueue` queries documents and learning_items by collection_id, state, due date, and item_type
- **THEN** the queries SHALL use the composite indexes `idx_documents_collection_state`, `idx_documents_due`, `idx_learning_items_document_state`, `idx_learning_items_due`, and `idx_learning_items_type`

#### Scenario: Review log queries use indexed lookups
- **WHEN** the system queries review_log by item_id and review_date
- **THEN** the query SHALL use the `idx_review_log_item` composite index

### Requirement: Zustand selector subscriptions
All Zustand store subscriptions in performance-critical components SHALL use selectors or `useShallow` to prevent cascade re-renders from unrelated state mutations.

#### Scenario: Queue store subscription uses selector
- **WHEN** a component subscribes to `queueStore` for the active queue items
- **THEN** it SHALL use a selector (e.g., `useQueueStore(s => s.items)`) and SHALL NOT use bare `useQueueStore()`

#### Scenario: Unrelated state mutation does not trigger re-render
- **WHEN** `documentStore.someUnrelatedField` is updated
- **THEN** components subscribed only to `documentStore.activeDocument` via selector SHALL NOT re-render
