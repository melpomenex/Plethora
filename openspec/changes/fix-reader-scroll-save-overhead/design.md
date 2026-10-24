## Context

See `proposal.md` for motivation. The October 23 investigation established:

- HTML scroll capture is throttled at 500 ms, then `handleScrollPositionChange` updates reader state and parent callbacks; persistence uses another 500 ms timer (`src/components/viewer/DocumentViewer.tsx:2134,7152`). Its scheduled callback captures the earlier sample rather than always reading the newest sample.
- `persistScrollState` calls both `updateDocumentProgressAuto` and `saveDocumentPosition` (`DocumentViewer.tsx:2119`). The former returns a full `Document` and invokes `journal_document_fields`, which selects the complete row and serializes its content and metadata even with `sync_fields=["position"]` (`src-tauri/src/database/repository.rs:524,2186`; `src-tauri/src/sync/payload.rs:152`).
- Read-only queries against the pictured article found approximately 20,125 content characters and 296,963 metadata characters, 320,029-byte position-only full-document records, and a separate 311-byte compact record. The entire outbox contained 31,986 records totaling 4,213,862,271 payload bytes; this aggregate includes changes unrelated to scrolling.
- Both `DocumentViewerWrapper.tsx:386` and `QueueScrollPage.tsx:2481` prepare context following scroll updates. `src/utils/tokenizer.ts:42` encodes complete content and potentially its scroll suffix. These effects are not gated by Assistant visibility.
- The running AppImage selected hardware/NVIDIA/Wayland policy with WebKitGTK 2.54 and DMA-BUF disabling unset. The user reproduced lag with a plain theme and the Assistant closed. Neither observation measures frame cost or proves a graphics root cause.
- Sync v2 full-document records use field-group ordering. The existing compact schema-v1 decoder instead follows legacy entity ordering, omits `current_view_state`, and cannot construct a missing document (`src-tauri/src/sync/merge.rs:185,493`; `full_state.rs:41,960`). An absent field list defaults to all groups when journaling. Reusing the compact encoder without changing these boundaries is insufficient.

## Goals / Non-Goals

**Goals:** Bounded work independent of article size for position saves; latest-position durability; one save owner; correct field-group synchronization; fresh Assistant context without scroll-driven full-content preparation; measured packaged-Linux responsiveness.

**Non-Goals:** Rewrite sync globally, change graphics defaults, redesign the reader/theme, change prompt budgets, delete pending outbox records, automatically vacuum the live database, or publish/install a release. Shared persistence changes must retain PDF, EPUB, video/audio, browser-mode, and local-only document behavior.

## Decisions

### 1. One atomic position operation with a small response

Introduce a dedicated position-update request carrying document identity and only the current locator/view state. In one transaction, update unified and legacy position fields consistently and journal one compact position record. Read only position/identity/privacy information needed for validation and ordering, never article content or metadata. Return acknowledgement/position data, not a full document.

Audit all callers before changing any existing command signature. Migrate the reader to the dedicated operation and preserve existing full-document-return contracts for unrelated callers. Browser adapters must implement equivalent behavior. Existing helpers may delegate internally where this preserves their contract. A unified backend operation is preferred over deleting one frontend call because both resume representations are currently used.

For representative bounded locators, enforce a serialized sync record budget of 4 KiB and response budget of 1 KiB. A fixture with multi-megabyte article content/metadata must produce the same position payload size as a small article with the same locator. Validate excessively large locator inputs rather than silently truncating resume data.

### 2. Coalesce latest samples with bounded durability and lifecycle flushes

Use a document-scoped save coordinator shared by the reader's lifecycle handlers. Keep the latest sampled locator in a ref; permit at most one request in flight and one replaceable pending sample per document. Serialize completions so a slower older save cannot overwrite a newer one.

During continuous scrolling, start at most one periodic save every two seconds. After scrolling stops, flush the latest sample after a 250 ms quiet period unless that exact position is already durable. Initial position restoration must not schedule saves. Keep local resume checkpoints separately; compare meaningful locator changes rather than timestamps to suppress no-op writes.

Flush the outgoing document on tab/document changes, queue advance, visibility loss, and supported close/suspend boundaries. Capture outgoing identity before replacement, make duplicate cleanup paths idempotent, and preserve failed pending work for a bounded retry or later explicit flush. On close, flush before teardown where the host allows it; maintain a local checkpoint for abrupt termination where an asynchronous database acknowledgement cannot be guaranteed. Failed persistence must not freeze scrolling or create an unbounded retry queue.

### 3. Compact position sync with explicit field ownership

Extend the existing compact position wire shape additively with `sync_fields=["position"]` and the complete resume-field snapshot, including `current_view_state`. Keep it readable by the existing legacy compact decoder; do not relabel a sparse body as a full v2 document. New receivers identify the compact shape explicitly before generic document decoding, resolve aliases, honor tombstones, compare and record the position field-group HLC, and update only position fields. Missing unrelated properties are never interpreted as null/default replacements.

Apply legacy compact records through the same position-only arbitration on upgraded receivers; continue accepting existing full v1/v2 records. Compact records for unknown documents must remain replayable until a full record materializes the document, without advancing state so far that the full record is suppressed. Use the existing recoverable sync mechanism or a durable deferred entry; no silent acknowledgement-and-loss is acceptable. Test duplicate delivery, both delivery orders, offline content edits, aliases, privacy, tombstones, and stale positions.

Older receivers can read their known compact fields and ignore additive fields, but retain their older entity-ordering limitations. Record this mixed-version limit explicitly; do not claim that upgrading the sender alone repairs older receivers. No new wire schema is necessary for this additive shape, but interoperability tests must use the previous decoder behavior.

### 4. Keep context resolution and broad renders out of scrolling

Keep position data in a stable latest-position channel; only narrow progress consumers should subscribe to visual updates. Stable callbacks must prevent every position notification from invalidating the full reader, wrapper, queue, and Assistant trees.

Give the active reader one context resolver that snapshots the current document revision, selection, locator, model, and effective provider budget when the user sends a prompt or explicitly requests a context preview. Remove the duplicate eager wrapper/queue pipelines. Hidden Assistant surfaces perform no tokenization solely because position changed. Cancel/discard stale results after document/model/selection changes.

Reuse tokenization for an unchanged source revision and encoding through a bounded cache owned by the active reader; release it on source replacement/unmount. Do not hash or encode the whole article on each scroll to look up the cache. Resolve the viewport window from cached information when needed. Preserve selection precedence, citations, full-document versus window coverage, video/PDF context, untrusted-source containment, and provider-aware budgets. Request-time freshness is preferred over merely adding another debounce because the latter still performs unnecessary repeated work.

### 5. Establish a packaged-Linux acceptance gate

Capture the current AppImage baseline before implementation, then run the same workload against a separately built artifact. Record artifact hash/source revision, WebKit version, backend/GPU policy, viewport/zoom, display refresh, article fixture size, library/outbox size, external load, and theme/Assistant state. Use a deterministic local article fixture; keep user content and payload bodies out of committed evidence.

Collect three warm 60-second scroll runs per condition: plain theme with Assistant closed, then the screenshot's paper theme with Assistant open. Measure frame-interval p50/p95/max, main-thread tasks over 50 ms, position command count/latency, new journal bytes, and process memory. On the controlled target host, require p95 frame intervals within two display refresh periods and no main-thread task over 50 ms attributable to position bookkeeping or context preparation. Fixture position payloads must meet the byte budget and continuous scrolling must meet the two-second save bound, allowing the final lifecycle flush separately. Record a 15-minute reading/navigation soak and compare memory after warmup for sustained growth.

Unit tests protect scheduling, sizes, merge semantics, and no-work invariants. Existing Node benchmarks alone cannot establish rendering performance. Run `npm run bench:check` and required focused tests; update performance/bundle baselines only for intentional measured changes with justification. If the packaged frame gate still fails, retain the failure and use the profile to locate the remaining cost before claiming the user-visible issue resolved.

## Risks / Trade-offs

- [Risk] Coalescing increases the interval between durable samples. → Two-second maximum during continuous input, quiet-period/lifecycle flushes, local checkpoints, and explicit error-path tests.
- [Risk] Shared commands have non-reader consumers. → Inventory callers and retain compatibility wrappers instead of silently changing return values.
- [Risk] Compact records interact with full-record creation, privacy, aliases, and HLC state. → Explicit position-only decoding, recoverable out-of-order delivery, and transaction-level convergence tests.
- [Risk] A new token cache retains large buffers or uses the wrong encoding. → Bound cache lifetime/entries and key by source revision plus actual encoding; invalidate on relevant configuration changes.
- [Risk] The existing 4.21 GB outbox remains costly after new writes are fixed. → Report old backlog separately and assess safe compaction as follow-up; never delete history based only on age or assume all rows are obsolete.
- [Risk] Graphics or unrelated work still dominates scroll latency. → Require packaged frame measurements and attribute remaining stalls from traces; keep graphics policy outside this change unless evidence warrants a separately scoped decision.

## Migration Plan

1. Record the baseline without modifying the user's database or replacing the installed AppImage.
2. Add compatible compact decode/apply behavior and atomic persistence, then migrate frontend callers and context work.
3. Run behavioral/merge tests, local gates, and a separate AppImage build and measurement session. Record exact failures and unverified physical-host checks in `verification.md`; keep their tasks unchecked.
4. Existing full-document outbox records remain readable. New saves produce compact records; no blanket backlog rewrite or database vacuum runs at startup.
5. Rollback restores previous application code without deleting existing data. Additive compact fields remain readable by the older compact decoder, subject to its documented ordering limitations.
