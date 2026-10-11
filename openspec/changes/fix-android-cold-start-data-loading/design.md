## Context

See `proposal.md` for the reported behavior. The existing startup optimization already provides a bounded snapshot and a backend readiness gate. The current Android path has multiple timeout and retry owners: `src/lib/tauri.ts` retries backend readiness probes, `src/stores/startupStore.ts` races the startup request against an 8-second watchdog and releases its in-flight key on timeout, and mobile queue views schedule their own retries. The launch overlay treats a null snapshot as terminal for that overlay. This can leave the app shell running while the active surface is still empty, and may make the actual failing phase hard to identify.

The user reports the behavior on GrapheneOS and standard Android. The design applies to native Android generally and does not infer an OEM-specific cause. It preserves the existing database integrity/migration gate and bounded startup snapshot contract.

## Goals / Non-Goals

**Goals:**

- Identify whether cold-start delay or failure occurs in native readiness, IPC, the startup query, store hydration, or surface rendering.
- Keep a populated Android surface in a loading or recoverable-error state until successful data arrives; show an empty state only after a successful empty result.
- Recover from transient startup failures without requiring navigation or relaunch, while bounding retries and avoiding competing per-component retry loops.
- Preserve existing data while retrying and reject results for a collection that is no longer active.

**Non-Goals:**

- Loading the entire library before first paint; the first response remains bounded and later pages remain on demand.
- Changing SQLite schema, migrations, corruption recovery, or the backend-ready safety gate.
- Changing startup behavior on desktop, PWA, or iOS unless shared code must retain compatible behavior.
- Adding GrapheneOS-specific branches or assuming that GrapheneOS is the root cause.

## Decisions

### 1. Instrument each boundary before changing timeout values

Record Android startup phase timestamps and outcomes for backend readiness, startup-command dispatch/settlement, returned item counts, snapshot hydration, and first visible data. Include platform and collection identifiers only as needed for diagnosis; never log document content or titles. Distinguish timeout, transport rejection, database error, successful empty result, and successful populated result.

This makes device reports actionable and prevents masking an IPC stall by increasing the UI timeout. Alternative rejected: changing the watchdog duration based only on the observed wait; that can lengthen blank screens without showing whether the request eventually succeeds.

### 2. Give the startup coordinator ownership of Android retries

Use one coordinator state machine for each active collection and visible startup surface. It owns a single bounded retry policy with backoff, shares each attempt among callers, and transitions to a recoverable error after automatic attempts are exhausted. An explicit retry starts a new bounded sequence. Collection changes invalidate old attempts and their timers. Remove or route existing mobile per-view retry loops through this shared policy so retries cannot multiply across the shell, overlay, and queue view.

Keep the request result separate from its presentation watchdog: a timeout must not be represented as a successful empty result. Track late responses by request generation and apply them only when their collection is still active. The implementation must account for Tauri invokes that cannot be cancelled: retries remain bounded, and a late or stale completion cannot clear newer state.

Alternative rejected: a single larger timeout or independent retries in each component. A longer timeout leaves users without an explanation, while per-component loops can duplicate IPC work and have inconsistent recovery behavior.

### 3. Derive empty, loading, and error presentation from completed outcomes

The active mobile surface may render an empty state only after a successful query for its active collection returns zero items. Pending attempts render loading; exhausted attempts render a recoverable error with an explicit retry action. A pending or failed refresh must not clear items already loaded for the same collection. Successful snapshots continue to hydrate the existing document/queue stores and preserve their current page limits.

Alternative rejected: inferring “empty” from an empty array alone. Empty arrays are also the initial store value before the first request, so that representation cannot tell a valid empty database from work that has not completed.

### 4. Preserve native database safety and keep platform scope narrow

All Android startup reads continue to pass through the current backend-ready gate after database open, integrity handling, and migrations. The retry controller does not call repositories directly or mark the backend ready early. Apply the Android policy using the native platform signal, not device-brand detection; shared code keeps current non-Android behavior unless required for API compatibility.

## Risks / Trade-offs

- [Retries can add work while the Android bridge is stalled] → Use one shared retry owner, cap attempts/backoff, and measure command volume and completion before tuning.
- [A response may arrive after a UI watchdog or collection change] → Tag attempts with a generation and collection id; apply only current successful responses and preserve current data otherwise.
- [A slow but healthy device may exhaust the automatic retry budget] → Keep the explicit retry path available and use phase telemetry to tune the budget from device evidence.
- [Loading indicators could persist when a request is genuinely stuck] → Transition to a distinct recoverable error when the bounded budget ends rather than holding an indefinite spinner.

## Migration Plan

1. Add non-content Android startup phase diagnostics and a reproducible delayed/failing local-data fixture.
2. Implement the shared retry state and request-generation handling in the startup coordinator, retaining the existing backend safety gate.
3. Wire mobile surfaces to distinguish pending, successful-empty, populated, and exhausted-error states; replace per-view retry loops with coordinator calls.
4. Verify populated and empty databases, transient bridge failures, delayed responses, collection switching, and app resume on standard Android and GrapheneOS.
5. If device evidence identifies a native backend issue, fix it behind the same behavior contract and keep diagnostics to verify the result.

Rollback can restore the previous Android startup attempt behavior while keeping phase diagnostics. No database migration or data rewrite is required.

## Open Questions

None. The automatic retry budget can be tuned from Android measurements without changing the user-visible contract.
