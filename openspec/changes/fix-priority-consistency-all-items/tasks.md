## 1. Inventory and reproduction

- [x] 1.1 Inventory queue, library, reader, overlay, and priority shortcut entry points and map document, extract, flashcard, RSS, podcast, and any other displayed item types to their stable persistent priority identity; record the mapping and verify each type has a covered path.
- [x] 1.2 Reproduce Alt+P → change → Enter → reopen indicator for documents, extracts, and flashcards using representative fixtures; add regression tests that fail for the observed gaps.
- [x] 1.3 Trace extract rank-key generation, inheritance, explicit zero, and current read APIs; document whether exact slider readback is possible and verify with nontrivial rank fixtures.

## 2. Authoritative priority representation

- [x] 2.1 Implement or reuse a typed identity resolver for every inventoried item type and verify it targets each item's own canonical entity, including nested entries and same-ID collisions across types.
- [x] 2.2 Provide authoritative 0–100 readback separate from queue rank keys for extracts and all other item types; test saved values, inherited values, explicit zero, and differing ordering keys.
- [x] 2.3 If needed, add durable user-priority metadata and a versioned migration/backfill that preserves legacy ranking and inheritance; test upgrades, fresh databases, and safe legacy fallback.
- [x] 2.4 Route single-item writes through the appropriate shared typed commit operation and verify the correct entity changes while parent and sibling priorities remain unchanged.

## 3. Surface and bulk integration

- [x] 3.1 Wire Scroll Queue shortcut and overlay for all item types, including flashcards, to captured targets and authoritative readback; test keyboard Enter, indicator editing, and item navigation.
- [x] 3.2 Audit and align review queue, all library layouts, readers, nested viewers, and other inventoried priority entry points; test configured shortcut remapping and pointer/touch parity for their applicable types.
- [x] 3.3 Extend mixed-item bulk priority dispatch and backend transaction to cover documents, extracts, flashcards, and other independently persisted queue types; verify one IPC call, one transaction, accurate per-item outcomes, and rollback on transaction failure.
- [x] 3.4 Refresh or patch only the committed target from authoritative results and guard pending saves against navigation; test delayed completion, failed save, retry, cancellation, and absence of false success.

## 4. End-to-end verification

- [x] 4.1 Test round trips across queue and library/reader surfaces for each applicable type, including reload/restart, priorities 0 and 100, and a non-preset value; verify the indicator and persisted readback agree.
- [x] 4.2 Verify priority changes affect subsequent queue ordering under existing ordering rules without altering unrelated scheduling or item priorities; cover inherited and explicit extract priorities.
- [x] 4.3 Run focused frontend and backend priority, queue, migration, and bulk-action tests, appropriate lint/type checks, and `npm run bench:check`; record results and any pre-existing failures.
