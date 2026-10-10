## Context

See `proposal.md` for the user-facing problem. The active shell already coordinates startup snapshots and the active collection. Current auto-postpone behavior is attached to one Queue loader and current batch persistence is split into per-item calls. The new path must use the persisted collection data and existing synchronization journal without touching learning history.

## Goals / Non-Goals

**Goals:**
- Run one cold-start operation after backend, settings, and collection scope are ready, independent of visible surfaces.
- Reuse the existing pure TypeScript postpone rules for eligibility, and keep database reads and writes behind typed APIs.
- Make recovery dates future-facing, evenly distributed, retry-safe, and auditable by outcome.
- Keep the visible local Learning Settings toggle as the sole setting for this behavior.

**Non-Goals:**
- Change manual single-item postpone semantics or the FSRS review algorithm.
- Automatically run again on tab changes, foreground events, or collection changes within a process.
- Add automatic postponement for RSS, playlist, or other unscheduled feed content.

## Decisions

1. **Use a main-shell session coordinator.** A module-level single-flight operation is started from the application shell after the startup snapshot resolves the active collection, the backend is ready, and settings persistence reports hydration complete. The operation is scoped to that collection and process. The shell does not listen for tab focus or visibility changes. Schedule's initial data read waits on the same coordinator promise so a direct Schedule launch does not display a stale pre-operation snapshot. Queue state is reconciled after the backend commit. A new process gets a new run; reopening views in the same process reuses the completed promise.

   Alternatives considered: invoking from Queue components (misses Schedule and bypass loaders), invoking from each loader (repeats on refresh and tab activation), and adding foreground callbacks (turns normal Android resume into an unexpected new scheduling run). The shell boundary is the smallest common lifecycle point.

2. **Separate authoritative detection, pure planning, and execution.** A Rust read API returns compact persisted schedule candidates for the active collection, plus the existing scheduled workload in the upcoming planning window. TypeScript maps supported rows into the existing `PostponeInput` model and runs `postponeElement` without writes. A second Rust API applies a typed plan containing entity kind, expected original date, and target local date. This keeps the postpone formula in one place while ensuring candidate discovery does not depend on UI cache state.

   Learning items, documents, and text extracts have type-specific schedule fields and synchronization payloads and are eligible for the automated path. Video extracts are inspected and surfaced as skipped with an explicit unsupported-sync reason until they have a first-class sync entity. Unscheduled RSS and playlist content is outside the scheduled candidate set.

   Alternatives considered: planning from `filteredItems` (misses hidden rows and can be stale), writing one IPC request per item (slow and partially ambiguous), and duplicating the priority-weighted algorithm in Rust (creates two policy implementations).

3. **Recover dates from today and distribute by workload.** The planner normalizes persisted dates with the same local-calendar rules as Schedule. It considers a candidate overdue only when the local date key is valid and earlier than today's key. New-item rows with no schedule, today's workload, future dates, suspended cards, archived/dismissed records, and invalid dates do not receive mutations. For each eligible result, the postpone engine's calculated increase supplies a preferred offset, clamped into the next 30-day window. The planner places items on the least-loaded valid day in that window using the persisted workload counts, then preferred-offset proximity, then date and ID as stable tie-breaks. This makes even a large backlog future-dated without treating a historic due date as a base or collapsing every item onto tomorrow.

   Alternatives considered: adding the calculated increase to the old due date (can remain overdue), assigning the entire backlog to tomorrow (moves rather than resolves the burden), and modifying interval or memory state to force the Schedule count down (corrupts the review model).

4. **Commit conditional date-only changes in one transaction.** The batch command compares each row's persisted due date to the plan's expected date and updates only if that value is unchanged. It writes the type-specific schedule field and ordinary modification metadata, journals each successful entity through existing sync payload helpers, and commits once. Rows that changed or disappeared are skipped with a reason; operation-level database failures roll back the transaction and are returned as failures. After commit, the session coordinator re-reads persisted candidates in the same collection to report the remaining overdue count. A retry sees already-future dates and cannot move them again.

   This conditional write is the concurrency guard: overlapping plans can both be computed, but only the first matching due-date update succeeds. A durable session-run table is unnecessary because updated items leave the strict-overdue candidate set; failures remain overdue and can be retried.

5. **Use one persisted setting and nonblocking feedback.** The local `LearningSettings.learning.postpone.autoPostponeEnabled` value remains authoritative and is read only after Zustand hydration. The unused native `auto_postpone_config` decision API is removed or retired so its independent default cannot disagree with the visible setting. After a nonempty or partially unsuccessful operation, a global toast reports discovered, postponed, skipped, failed, remaining-overdue counts, and the date distribution. The legacy prompt is removed from automatic flow; manual controls remain.

## Risks / Trade-offs

- **[Some entity types do not participate in sync]** → Keep them unchanged, report an explicit skip reason, and document the missing sync contract instead of mutating unsynchronized state.
- **[A process can close between planning and commit]** → No write occurs before the batch transaction; retries rediscover only rows that remain overdue.
- **[A collection can change during startup]** → Freeze the active collection ID after the startup snapshot and include it in candidate and apply requests; reject stale scope responses.
- **[Local timezone differs from UTC storage dates]** → Pass and use Schedule's local date key for eligibility and target planning; test date-only, offset-crossing, DST, month, and year boundaries.
- **[Large backlogs can exceed available date slots at existing workloads]** → The planning horizon is bounded to 30 days and always selects the least-loaded day within it; target dates remain distributed even if some days are already busy, and the result exposes that distribution.

## Migration Plan

No database migration is required. Keep existing `autoPostponeEnabled` values and default false. Existing items' review history and memory fields are untouched. Remove the obsolete independent auto-postpone setting/decision command after confirming there are no callers; no persisted setting needs migration because the active toggle already lives in Learning Settings. If an operation fails, the app remains usable and overdue rows are available for retry in the next new process session or through manual controls.
