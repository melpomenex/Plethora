## 1. Persisted candidate detection and typed execution

- [x] 1.1 Add a backend candidate read for the active collection and local date that returns persisted learning items, documents, text extracts, unsupported overdue video extracts, and compact upcoming workload data; verify collection and status cases in repository tests and null-date/date-boundary cases in planner tests.
- [x] 1.2 Add a typed batch apply command that conditionally updates planned due dates in one transaction, journals schedule changes, and returns per-item outcomes; re-read persisted candidates after commit to report the remaining overdue count. Verify CAS/idempotency, mixed entity routing, rollback, and unchanged FSRS/review fields in Rust database tests.
- [x] 1.3 Add TypeScript API types and a pure auto-postpone planner that reuses postpone eligibility rules, applies local date semantics, and distributes items across the next 30 days; verify no-date, invalid-date, timezone, month/year, and deterministic workload-distribution cases.

## 2. Session lifecycle and feedback

- [x] 2.1 Add a settings-hydration-aware, single-flight session-start coordinator scoped to the startup collection and invoke it from the main application shell; verify settings delay, disabled behavior, concurrent calls, tab reopen, background return, collection switch, and new-process retry.
- [x] 2.2 Make initial Schedule reads wait for the shared session operation and reconcile Queue state after a commit; verify direct Schedule entry and that the displayed overdue count matches persisted dates.
- [x] 2.3 Replace the legacy automatic prompt with a nonblocking result/error summary containing discovered, postponed, skipped, failed, remaining-overdue, and distribution information; verify manual postpone and review controls remain available.
- [x] 2.4 Update translated Auto-Postpone descriptions and relevant user documentation to state that enabled sessions automatically process eligible overdue content; verify locale keys remain consistent.

## 3. Regression coverage and validation

- [x] 3.1 Add frontend planner, coordinator, and active mobile/startup integration tests for the required 49-item, hydration, Schedule-first, repeat, and no-duplicate scenarios; verify them with the focused Vitest suites.
- [x] 3.2 Add Rust persistence tests for mixed scheduled entity types, excluded records, date boundaries, partial/stale outcomes, and state preservation; verify them with the focused Cargo test targets.
- [x] 3.3 Run OpenSpec validation, focused frontend tests, relevant Rust tests, formatting/type checks, and feasible Android build checks; record any device-level behavior that could not be executed.

Validation note: the universal release APK was built as an internal acceptance APK with `plethoraNativeBackEnabled=true`. No Android device was attached, so physical-device acceptance was not run.
