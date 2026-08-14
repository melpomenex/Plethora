## Why

NotebookLM shows a green "Connected" badge after a successful credential login, then renders zero notebooks and offers no way to recover. The root cause is twofold: the CLI provider's notebook-listing call swallows every failure (including auth failures) into an empty list (`src-tauri/src/notebooklm.rs:1429-1453`), and the health check reports a persisted `auth.connected` flag rather than a live session check (`notebooklm.rs:1391-1427`). The frontend therefore cannot tell a genuinely empty account from a broken or expired session, so it renders "Connected" over an empty workspace with no re-authenticate path. This is the unresolved NotebookLM report from issue #44; the earlier `fix-issue-44-bugs` change only added empty-state messaging without fixing detection, because detection is impossible while the backend converts failures into empty lists.

## What Changes

- **Backend: stop swallowing listing errors.** `CliNotebookLMProvider::list_notebooks` returns a typed not-authenticated error for auth-shaped failures and propagates other failures, instead of converting them all to `Ok(vec![])`. A genuine empty account still returns an empty list.
- **Backend: honest health.** `health` reports the connection state from the live verification result, not the persisted `auth.connected` flag, so a stale or expired session is no longer reported as connected.
- **Frontend: distinct needs-reauthentication state.** `NotebookLMPage` distinguishes three outcomes from a connection check: connected-with-notebooks, connected-but-empty (a healthy new account), and needs-reauthentication (listing failed due to auth). The misleading green badge no longer renders over a needs-reauth condition.
- **Frontend: Re-authenticate CLI action.** A prominent "Re-authenticate CLI" button appears in the needs-reauth state and on any listing failure, invoking the existing `notebooklmCLILogin` flow so recovery is a single click.
- **Tests.** Add coverage for the error-recovery states: the backend list returns a not-authenticated error (not an empty list) on auth failure, returns an empty list only for a genuine empty account, the frontend moves to needs-reauth on an auth failure, and the Re-authenticate action is reachable.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `notebooklm-status-handling`: Strengthen the status contract so listing and auth failures surface as distinct, typed states instead of a silent empty list, require a reachable Re-authenticate action, and add test coverage of the error-recovery states. (Introduced by the `fix-issue-44-bugs` change; this change makes its requirements actually enforceable.)

## Impact

- **Backend (Rust)**: `src-tauri/src/notebooklm.rs` — `CliNotebookLMProvider::list_notebooks` (error propagation and a typed not-authenticated error), `CliNotebookLMProvider::health` (live result vs persisted flag), and the error variant carried through the provider trait and `NotebookLMHealth`. Auth-detection helpers (`is_auth_error`, `json_reports_authenticated`) are reused or extended.
- **Frontend (TS/React)**: `src/pages/NotebookLMPage.tsx` (`checkConnection` state machine, header badge, needs-reauth UI and Re-authenticate action), and likely `src/api/integrations.ts` (typed handling of list failures) and `src/components/notebooklm/NotebookLMLoginPanel.tsx`.
- **Tests**: new or updated tests under `src/components/notebooklm/__tests__/` plus a Rust unit test for the provider listing behavior.
- **Compatibility**: No breaking API changes. The list command's failure mode changes from silent-empty to a surfaced error, which only affects how the frontend reacts; its existing error branch simply becomes reachable.
