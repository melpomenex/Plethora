## Context

See the proposal for the user-visible problem. `QueueScrollPage` resolves and commits priority only for documents and extracts; its flashcard path currently returns no priority control. Extract `priority_score` is a global ordering key produced by `priority_rank::key_for_slider`, but the queue currently treats it as a slider value and locally overwrites it with the raw slider. The shared `priorityCommit` service already dispatches documents, extracts, and learning items, while `usePriorityPopup` supports custom commits and learning-item IDs. The review queue's shortcut splits targets into documents and learning items; the bulk specification still asserts flashcards have no priority despite the learning-item priority command and storage. These observations identify gaps, not a proven single root cause for every reported symptom.

## Goals / Non-Goals

**Goals:** Establish stable typed identity and authoritative readback for all supported item kinds; make all priority entry points converge; preserve queue ranking and bulk transaction behavior.

**Non-Goals:** Redesigning the priority UI, changing scheduler algorithms or shortcut defaults, or rewriting existing priority values as raw slider values. Do not assume every displayed item type has an independent persisted entity without verifying its model.

## Decisions

1. **Inventory surfaces and resolve typed targets centrally.** Map Scroll Queue (including document, extract, flashcard, RSS and podcast variants), review queue, library layouts, readers, and any other priority entry points to their actual persistent item identities. Use a shared typed resolver and commit path where practical; use the current item's own ID, not its parent ID, for extracts and cards. For variants backed by a canonical document or learning item, resolve that identity explicitly. If a displayed type lacks one, add a durable per-item priority representation and migration rather than silently disabling it or changing a parent. Capture the target and initial value when opening an editor; guard completion and refresh against item changes. Alternative: independent surface-specific handlers, rejected because they have already diverged.

2. **Separate user priority from rank keys.** The 0–100 slider is user-facing; the global `priority_score` may be a rank key and must not be shown or patched as a slider. Inspect existing rank-to-slider/read APIs and use the canonical conversion with authoritative readback for extracts; if the representation cannot round-trip the intended value, add explicit persisted user-priority metadata with a migration/backfill strategy that preserves ordering and inheritance. Keep explicit zero distinguishable from unset. Documents and learning items should use their canonical explicit slider fields. Never globally recompute legacy rank keys merely to render the editor. Alternative: round the score or optimistically assign the slider to it, rejected because rank and slider have different meanings.

3. **Unify entry points and refresh from authoritative results.** The configured `doc.priority` shortcut and indicator open or commit through the same target-aware operation, including nested reader/iframe event forwarding. Refresh or patch the exact committed identity from an authoritative read model so overlay, list, and library views converge; ensure async results for an old item cannot overwrite the new one. Preserve error and retry behavior and do not report a failed mutation as saved. Alternative: reload only the document store, rejected because extracts and cards have distinct state owners.

4. **Treat mixed bulk changes as a single typed batch.** Extend the existing queue bulk command/target resolution to include learning items and any other independently persisted queue kinds. Preserve one IPC call, one transaction, per-item resolution failures, and existing rollback semantics; update all selected targets, including extracts, rather than silently dropping a type. Align the shortcut's mixed-selection path and post-commit refresh with that batch. Alternative: sequential per-type calls, rejected because it breaks the existing transactional guarantee.

5. **Apply priority within feed ordering.** RSS articles and podcast episodes have their own persistent identities but no existing global priority rank. Apply their priority within the corresponding feed ordering, retaining relevance, chronology, or episode order as the fallback. This was selected during implementation after the inventory exposed the missing ordering rule.

## Risks / Trade-offs

- **[Legacy score ambiguity]** Rank keys and inherited values may not encode an exact historical slider → inspect migration and use a documented deterministic fallback for legacy data; never reinterpret a rank key as the slider. Cover inheritance and explicit zero.
- **[Multiple queue representations]** A displayed entry may wrap a canonical document or lack a stable backing record → inventory each type and prove identity and persistence before wiring controls; migration may be needed for independently stored types.
- **[Concurrent navigation or failures]** Refresh or delayed completion can affect the wrong item or falsely show success → key state to captured target, retain failed drafts, and test deferred saves.
- **[Bulk changes and ordering]** Extending batch support may alter ordering or transaction guarantees → use existing rank logic and transaction boundary, test mixed and failed batches, and verify queue readback.

## Migration Plan

Prefer existing explicit priority columns and existing rank APIs. If an item needs durable slider metadata, add a versioned migration with a safe fallback for legacy rows, preserve existing rank keys and inherited relationships, and test existing databases and fresh installs. Roll back the code without destructive rewriting of existing scores; document any added schema compatibility constraints.
